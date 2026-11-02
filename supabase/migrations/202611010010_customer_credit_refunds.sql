-- Explicit refunds of posted customer credit notes. No Paid status becomes cash.
-- This migration is additive and does not replay or modify existing records.
alter table public.billing_refund_events drop constraint billing_refund_events_source_kind_check;
alter table public.billing_refund_events add constraint billing_refund_events_source_kind_check check(source_kind in ('cash','vendor-credit','customer-credit-note'));
create index refund_customer_parent on public.billing_refund_events(business_id,demo,(snapshot->>'parentDocumentId'),date,id) where source_kind='customer-credit-note';

create function public.billing_customer_credit_refund_movements(note_id uuid) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select f.date,case when f.kind='refund' then -f.amount else f.amount end from public.billing_refund_events f where f.source_kind='customer-credit-note' and f.source_id=note_id
$$;

-- A source note has its own lifetime cap. AR credit is additionally required at
-- every effective refund date; future new debit charges remain normal obligations.
create function public.billing_validate_customer_refund_history(parent_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(
  with notes as(select i.* from public.billing_issued_documents i where i.type='credit-note' and i.snapshot->>'originalDocumentId'=parent_id::text),
  movements as(
   select n.document_id,n.date,(n.snapshot->'totals'->>'total')::numeric delta from notes n
   union all select n.document_id,c.date,-(n.snapshot->'totals'->>'total')::numeric from notes n join public.billing_document_cancellations c on c.document_id=n.document_id
   union all select f.source_id,f.date,case when f.kind='refund' then -f.amount else f.amount end from public.billing_refund_events f join notes n on n.document_id=f.source_id where f.source_kind='customer-credit-note'
  ),running as(select document_id,date,sum(sum(delta)) over(partition by document_id order by date) balance from movements group by document_id,date)
  select 1 from running where balance<0
 ) then raise exception 'Customer credit-note refunds exceed the dated source credit or its correction';end if;
 if exists(
  with refund_days as(select f.date,sum(case when f.kind='refund' then f.amount else -f.amount end) amount from public.billing_refund_events f join public.billing_issued_documents i on i.document_id=f.source_id where f.source_kind='customer-credit-note' and i.snapshot->>'originalDocumentId'=parent_id::text group by f.date),
  running as(select date,sum(sum(delta)) over(order by date) balance from public.billing_settlement_movements(parent_id,'incoming') group by date)
  select 1 from refund_days r join running b on b.date=r.date where r.amount>0 and b.balance>0
 ) then raise exception 'Customer refund exceeds the negative receivable credit available at an effective refund date';end if;
end$$;

-- Existing source-history negatives from legitimate credit notes are allowed.
-- A new typed receipt/allocation must not create or deepen a negative obligation
-- at any affected date; unchanged earlier credit intervals are irrelevant.
create function public.billing_validate_customer_settlement(parent_id uuid,from_day date) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from(select date,sum(sum(delta)) over(order by date) balance from public.billing_settlement_movements(parent_id,'incoming') group by date)x where date>=from_day and balance<0) then raise exception 'Settlement exceeds the dated invoice obligation; record excess customer cash through the explicit cash/advance workflow';end if;
end$$;
create or replace function public.billing_validate_settlement_history(target uuid,direction text) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Incoming settlement authority is checked per insert below; validating old
 -- credit-note intervals as if they were overpayments would erase valid credit.
 if direction='incoming' then return;end if;
 if exists(select 1 from(select sum(sum(delta)) over(order by date) balance from public.billing_settlement_movements(target,direction) group by date)x where balance<0) then raise exception 'Settlement exceeds a document balance at an effective date; review payments, allocations and corrections';end if;
end$$;

create function public.billing_customer_refund_corrections_before(parent_id uuid,correction_date date) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.billing_refund_events f join public.billing_issued_documents i on i.document_id=f.source_id where f.source_kind='customer-credit-note' and i.snapshot->>'originalDocumentId'=parent_id::text and (f.date>correction_date or f.kind='refund' and not exists(select 1 from public.billing_refund_events r where r.reverses_id=f.id and r.date<=correction_date))) then raise exception 'Correct customer credit-note refunds first; receipt/allocation correction cannot predate refund corrections';end if;
end$$;

create function public.billing_customer_refund_compatibility_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_id uuid;note public.billing_issued_documents;cash public.billing_cash_events;
begin
 if tg_table_name='billing_payment_events' then
  parent_id=new.document_id;
  if new.kind='receipt' and exists(select 1 from public.billing_cash_configs where business_id=new.business_id and demo=new.demo) and exists(select 1 from public.billing_source_postings where source_id=parent_id and kind='document.issue') then perform public.billing_validate_customer_settlement(parent_id,new.transaction_date);end if;
  if new.kind='reversal' then perform public.billing_customer_refund_corrections_before(parent_id,new.transaction_date);end if;
 elsif tg_table_name='billing_cash_allocations' then
  select * into cash from public.billing_cash_events where id=new.cash_id;
  if cash.direction<>'incoming' then return new;end if;parent_id=new.target_id;
  if new.kind='allocate' then perform public.billing_validate_customer_settlement(parent_id,new.date);else perform public.billing_customer_refund_corrections_before(parent_id,new.date);end if;
 elsif tg_table_name='billing_issued_documents' then
  if new.type in ('credit-note','debit-note') then parent_id=(new.snapshot->>'originalDocumentId')::uuid;else parent_id=new.document_id;end if;
 else
  select * into note from public.billing_issued_documents where document_id=new.document_id;
  parent_id=case when note.type in ('credit-note','debit-note') then (note.snapshot->>'originalDocumentId')::uuid else note.document_id end;
  if note.type in ('invoice','gst-invoice','commercial-invoice') and exists(select 1 from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id where a.target_id=parent_id and c.direction='incoming' and (a.date>new.date or a.kind='allocate' and a.amount>coalesce((select sum(r.amount) from public.billing_cash_allocations r where r.releases_id=a.id and r.date<=new.date),0))) then raise exception 'Settlement exceeds cancelled invoice obligations; release every allocation first and do not predate its corrections';end if;
  if note.type='credit-note' then perform public.billing_customer_refund_corrections_before(parent_id,new.date);end if;
  if note.type='credit-note' and exists(select 1 from public.billing_refund_events f where f.source_kind='customer-credit-note' and f.source_id=note.document_id and (f.date>new.date or f.kind='refund' and not exists(select 1 from public.billing_refund_events r where r.reverses_id=f.id and r.date<=new.date))) then raise exception 'Correct every refund of this customer credit note first; note cancellation cannot predate refund corrections';end if;
 end if;
 if parent_id is not null and exists(select 1 from public.billing_refund_events f join public.billing_issued_documents i on i.document_id=f.source_id where f.source_kind='customer-credit-note' and i.snapshot->>'originalDocumentId'=parent_id::text) then perform public.billing_validate_customer_refund_history(parent_id);end if;
 return new;
end$$;
create trigger customer_refund_payment_guard after insert on public.billing_payment_events for each row execute function public.billing_customer_refund_compatibility_guard();
create trigger customer_refund_allocation_guard after insert on public.billing_cash_allocations for each row execute function public.billing_customer_refund_compatibility_guard();
create trigger customer_refund_document_guard after insert on public.billing_issued_documents for each row execute function public.billing_customer_refund_compatibility_guard();
create trigger customer_refund_cancel_guard after insert on public.billing_document_cancellations for each row execute function public.billing_customer_refund_compatibility_guard();

create or replace function public.billing_settlement_movements(target uuid,direction text) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select i.date,(i.snapshot->'totals'->>'total')::numeric from public.billing_issued_documents i where $2='incoming' and i.document_id=target
 union all select c.date,-(i.snapshot->'totals'->>'total')::numeric from public.billing_document_cancellations c join public.billing_issued_documents i on i.document_id=c.document_id where $2='incoming' and c.document_id=target
 union all select i.date,(i.snapshot->'totals'->>'total')::numeric*case when i.type='credit-note' then -1 else 1 end from public.billing_issued_documents i where $2='incoming' and i.snapshot->>'originalDocumentId'=target::text and i.type in ('credit-note','debit-note')
 union all select c.date,(i.snapshot->'totals'->>'total')::numeric*case when i.type='credit-note' then 1 else -1 end from public.billing_document_cancellations c join public.billing_issued_documents i on i.document_id=c.document_id where $2='incoming' and i.snapshot->>'originalDocumentId'=target::text and i.type in ('credit-note','debit-note')
 union all select p.transaction_date,p.amount*case when p.kind='receipt' then -1 else 1 end from public.billing_payment_events p where $2='incoming' and p.document_id=target
 -- Retain old recorded cash effects; no synthetic backfill or status inference.
 union all select (r.data->>'date')::date,(r.data->>'amount')::numeric*case when coalesce(r.data->>'kind','receipt')='receipt' then -1 else 1 end from public.billing_records r where $2='incoming' and r.collection='payments' and not r.archived and r.data->>'documentId'=target::text and coalesce(r.data->>'direction','incoming')='incoming' and coalesce(r.data->>'kind','receipt') in ('receipt','reversal') and not exists(select 1 from public.billing_payment_events e where e.id=r.id)
 union all select (b.data->>'date')::date,(b.data->>'total')::numeric from public.billing_vendor_bills b where $2='outgoing' and b.id=target and b.status='issued'
 union all select r.date,-(b.data->>'total')::numeric from public.billing_vendor_bills b join public.billing_ledger_batches r on r.reverses_id=b.issued_batch where $2='outgoing' and b.id=target
 union all select p.date,-p.amount from public.billing_vendor_payments p where $2='outgoing' and p.bill_id=target
 union all select r.date,p.amount from public.billing_vendor_payments p join public.billing_ledger_batches r on r.reverses_id=p.batch_id where $2='outgoing' and p.bill_id=target
 union all select a.date,a.amount*case when a.kind='allocate' then -1 else 1 end from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id where a.target_id=target and c.direction=$2

 union all select a.date,a.amount*case when a.kind='allocate' then -1 else 1 end from public.billing_vendor_credit_allocations a where $2='outgoing' and a.bill_id=target

 union all select f.date,f.amount*case when f.kind='refund' then 1 else -1 end from public.billing_refund_events f join public.billing_issued_documents i on i.document_id=f.source_id where $2='incoming' and f.source_kind='customer-credit-note' and i.snapshot->>'originalDocumentId'=target::text
$$;

create or replace function public.billing_refund_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare customer_note public.billing_issued_documents;parent_note public.billing_issued_documents;parent_document uuid;parent_record public.billing_records;config public.billing_cash_configs;prior public.billing_credit_refund_commands;cash public.billing_cash_events;credit public.billing_vendor_credits;refund public.billing_refund_events;original public.billing_refund_events;
 request jsonb;result jsonb;journal jsonb;snapshot jsonb;source_kind text;source_id uuid;party uuid;direction text;control uuid;debit_account uuid;credit_account uuid;event_id uuid;day date;amount numeric(18,2);reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot record or correct refunds';end if;
 if data_mode is null or command_id is null or action is null or action not in ('record','reverse') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid refund command';end if;
 request=jsonb_build_object('domain','refund','action',action,'data',command_data);
 select * into prior from public.billing_credit_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_refund_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different credit/refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 -- Resolve immutable source identity without taking a note row lock. Parent
 -- invoice is locked before business/config, preserving v14 payment ordering.
 if action='record' and command_data->>'sourceKind'='customer-credit-note' and coalesce(command_data->>'sourceId','')~'^[0-9a-fA-F-]{36}$' then
  select * into customer_note from public.billing_issued_documents i where i.document_id=(command_data->>'sourceId')::uuid and i.business_id=business and i.demo=data_mode and i.type='credit-note';
  if customer_note.document_id is not null then parent_document=(customer_note.snapshot->>'originalDocumentId')::uuid;end if;
 elsif action='reverse' and coalesce(command_data->>'refundId','')~'^[0-9a-fA-F-]{36}$' then
  select * into original from public.billing_refund_events f where f.id=(command_data->>'refundId')::uuid and f.business_id=business and f.demo=data_mode and f.kind='refund';
  if original.source_kind='customer-credit-note' then parent_document=(original.snapshot->>'parentDocumentId')::uuid;end if;
 end if;
 if parent_document is not null then
  select * into parent_record from public.billing_records r where r.id=parent_document and r.business_id=business and r.demo=data_mode and r.collection='documents' for update;
  if parent_record.id is null or parent_record.archived then raise exception 'Customer refund parent invoice unavailable in this business and data mode';end if;
 end if;
 perform public.billing_ledger_writer_lock(business,false);perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;if config.business_id is null then raise exception 'Configure reviewed cash and advance controls first';end if;
 select * into prior from public.billing_credit_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_refund_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different credit/refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 day=public.billing_payment_date(command_data->'date');if day<config.cutover_date then raise exception 'Refund date predates cash/source cutover';end if;
 if action='record' then
  if command_data-array['sourceKind','sourceId','date','amount','currency','method','reference','notes','paidConfirmed']<>'{}'::jsonb or command_data->'paidConfirmed' is distinct from 'true'::jsonb or coalesce(command_data->>'sourceId','')!~'^[0-9a-fA-F-]{36}$' or command_data->>'currency' is distinct from config.currency then raise exception 'Confirm the refund happened outside Folio and review source, amount and currency';end if;
  source_kind=command_data->>'sourceKind';source_id=(command_data->>'sourceId')::uuid;amount=public.billing_payment_amount(command_data->'amount');
  if source_kind='cash' then
   select * into cash from public.billing_cash_events c where c.id=source_id and c.business_id=business and c.demo=data_mode and c.kind='cash';
   if cash.id is null or exists(select 1 from public.billing_cash_events where reverses_id=cash.id) or day<cash.date then raise exception 'Choose active original cash on or before the refund date';end if;
   party=cash.party_id;direction=case when cash.direction='incoming' then 'outgoing' else 'incoming' end;control=case when cash.direction='incoming' then config.customer_advance_account else config.vendor_advance_account end;snapshot=cash.snapshot;
  elsif source_kind='vendor-credit' then
   select * into credit from public.billing_vendor_credits c where c.id=source_id and c.business_id=business and c.demo=data_mode;
   if credit.id is null or exists(select 1 from public.billing_vendor_credit_reversals where credit_id=credit.id) or day<credit.date then raise exception 'Choose active vendor credit on or before the refund date';end if;
   party=credit.vendor_id;direction='incoming';control=credit.account_id;snapshot=jsonb_build_object('business',credit.snapshot->'business','party',credit.snapshot->'vendor');
  elsif source_kind='customer-credit-note' then
   select * into customer_note from public.billing_issued_documents i where i.document_id=source_id and i.business_id=business and i.demo=data_mode and i.type='credit-note';
   select * into parent_note from public.billing_issued_documents i where i.document_id=parent_document and i.business_id=business and i.demo=data_mode and i.type in ('invoice','gst-invoice','commercial-invoice');
   if customer_note.document_id is null or parent_note.document_id is null or parent_record.id is null or parent_record.archived or exists(select 1 from public.billing_document_cancellations where document_id in (customer_note.document_id,parent_note.document_id)) then raise exception 'Choose an active frozen customer credit note and parent invoice';end if;
   if customer_note.snapshot->>'currency' is distinct from config.currency or parent_note.snapshot->>'currency' is distinct from config.currency or day<customer_note.date then raise exception 'Customer refund date/currency must match its issued credit note and ledger base';end if;
   if coalesce(parent_note.snapshot->>'clientId','')!~'^[0-9a-fA-F-]{36}$' or customer_note.snapshot->'buyer' is distinct from parent_note.snapshot->'buyer' or (customer_note.snapshot?'clientId' and customer_note.snapshot->>'clientId' is distinct from parent_note.snapshot->>'clientId') or not exists(select 1 from public.billing_source_postings p where p.source_id=customer_note.document_id and kind='document.issue') or not exists(select 1 from public.billing_source_postings p where p.source_id=parent_note.document_id and kind='document.issue') then raise exception 'Customer credit refund needs posted frozen sources and an explicit matching saved client link';end if;
   party=(parent_note.snapshot->>'clientId')::uuid;
   if not exists(select 1 from public.billing_records r where r.id=party and r.business_id=business and r.demo=data_mode and r.collection='clients') then raise exception 'Customer credit refund party is unavailable in this business and data mode';end if;
   if (customer_note.snapshot->'totals'->>'total')::numeric<=0 then raise exception 'A zero-value credit note cannot fund a refund';end if;
   direction='outgoing';control=config.receivable_account;
   snapshot=jsonb_build_object('business',customer_note.snapshot->'seller'||jsonb_build_object('id',business),'party',parent_note.snapshot->'buyer','parentDocumentId',parent_document,'documentId',parent_document,'parentNumber',parent_note.number,'creditNoteId',customer_note.document_id,'creditNoteNumber',customer_note.number,'creditNoteDate',customer_note.date,'sourceTotal',((customer_note.snapshot->'totals'->>'total')::numeric(18,2))::text,'sourceCurrency',config.currency);
  else raise exception 'Choose a cash advance, supplier credit or posted customer credit-note refund source';end if;
  if jsonb_typeof(command_data->'method') is distinct from 'string' or length(btrim(command_data->>'method')) not between 1 and 100 or jsonb_typeof(command_data->'reference') is distinct from 'string' or length(command_data->>'reference')>500 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(command_data->>'notes')>5000 then raise exception 'Review refund method, reference and notes';end if;
  debit_account=case when direction='incoming' then config.cash_account else control end;credit_account=case when direction='incoming' then control else config.cash_account end;
  event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description','External refund record','entries',jsonb_build_array(jsonb_build_object('account_id',debit_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit_account,'debit','0','credit',amount::text)))))->'batch';
  snapshot=(case when source_kind='customer-credit-note' then snapshot else '{}'::jsonb end)||jsonb_build_object('business',snapshot->'business','party',snapshot->'party','partyId',party,'sourceKind',source_kind,'sourceId',source_id,'direction',direction,'currency',config.currency,'amount',amount::text,'date',day,'method',command_data->>'method','reference',command_data->>'reference','notes',command_data->>'notes','paidConfirmed',true,'providerMode','manual-external','fundsMovedByFolio',false);
  insert into public.billing_refund_events(id,business_id,demo,kind,source_kind,source_id,party_id,direction,date,currency,amount,number,batch_id,snapshot,actor_id) values(event_id,business,data_mode,'refund',source_kind,source_id,party,direction,day,config.currency,amount,'REF-'||(journal->>'number'),(journal->>'id')::uuid,snapshot,auth.uid()) returning * into refund;
 else
  if command_data-array['refundId','date','reason']<>'{}'::jsonb or coalesce(command_data->>'refundId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an original refund and dated correction reason';end if;
  select * into original from public.billing_refund_events f where f.id=(command_data->>'refundId')::uuid and f.business_id=business and f.demo=data_mode and f.kind='refund';reason=btrim(command_data->>'reason');
  if original.id is null or day<original.date or jsonb_typeof(command_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Refund correction needs the original refund on or before its date and a reason';end if;
  if exists(select 1 from public.billing_refund_events where reverses_id=original.id) then raise exception 'This refund record is already reversed';end if;
  event_id=gen_random_uuid();insert into public.billing_credit_refund_authority(id,business_id,demo,source_kind,source_id,date) values(event_id,business,data_mode,'refund',original.id,day);
  journal=(public.billing_ledger_reverse(business,data_mode,event_id,original.batch_id,day,reason))->'batch';
  insert into public.billing_refund_events(id,business_id,demo,kind,reverses_id,source_kind,source_id,party_id,direction,date,currency,amount,number,batch_id,snapshot,actor_id) values(event_id,business,data_mode,'reversal',original.id,original.source_kind,original.source_id,original.party_id,original.direction,day,original.currency,original.amount,'REV-'||(journal->>'number'),(journal->>'id')::uuid,original.snapshot||jsonb_build_object('reason',reason),auth.uid()) returning * into refund;
 end if;
 if refund.source_kind='cash' then perform public.billing_validate_cash_history(refund.source_id);elsif refund.source_kind='vendor-credit' then perform public.billing_validate_vendor_credit_history(refund.source_id);else perform public.billing_validate_customer_refund_history((refund.snapshot->>'parentDocumentId')::uuid);end if;
 result=jsonb_build_object('refund',to_jsonb(refund)||jsonb_build_object('amount',refund.amount::text),'journal',journal,'replayed',false);
 insert into public.billing_credit_refund_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'refund.'||action,jsonb_build_object('refundId',refund.id,'sourceKind',refund.source_kind,'sourceId',refund.source_id));
 insert into public.billing_credit_refund_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'refund.'||action,result);return result;
end$$;


create function public.billing_customer_credit_refund_read(business uuid,data_mode boolean,as_of date,credit_note_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare note public.billing_issued_documents;parent public.billing_issued_documents;config public.billing_cash_configs;refund_rows jsonb;balance numeric(30,2);remaining numeric(30,2);available numeric(30,2);cancelled date;parent_cancelled date;write_allowed boolean;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Customer credit refunds unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) or credit_note_id is null then raise exception 'Choose a valid customer credit note, data mode and review date';end if;
 select * into note from public.billing_issued_documents i where i.document_id=credit_note_id and i.business_id=business and i.demo=data_mode and i.type='credit-note';
 if note.document_id is null then raise exception using errcode='P0002',message='Frozen customer credit note unavailable in this business and data mode';end if;
 select * into parent from public.billing_issued_documents i where i.document_id=(note.snapshot->>'originalDocumentId')::uuid and i.business_id=business and i.demo=data_mode and i.type in ('invoice','gst-invoice','commercial-invoice');
 if parent.document_id is null or coalesce(parent.snapshot->>'clientId','')!~'^[0-9a-fA-F-]{36}$' or note.snapshot->'buyer' is distinct from parent.snapshot->'buyer' or (note.snapshot?'clientId' and note.snapshot->>'clientId' is distinct from parent.snapshot->>'clientId') then raise exception 'Customer credit refund requires a frozen parent invoice and matching explicit client link';end if;
 if (select count(*) from public.billing_refund_events f where f.source_kind='customer-credit-note' and f.source_id=note.document_id)>1000 then raise exception 'Customer credit detail exceeds 1,000 refund movements; no partial history is shown';end if;
 select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('amount',f.amount::text) order by f.date,f.created_at,f.id),'[]'::jsonb) into refund_rows from public.billing_refund_events f where f.source_kind='customer-credit-note' and f.source_id=note.document_id;
 select coalesce(sum(m.delta),0) into balance from public.billing_settlement_movements(parent.document_id,'incoming')m where m.date<=as_of;
 select (note.snapshot->'totals'->>'total')::numeric+coalesce(sum(m.delta),0) into remaining from public.billing_customer_credit_refund_movements(note.document_id)m where m.date<=as_of;
 select date into cancelled from public.billing_document_cancellations where document_id=note.document_id;
 select date into parent_cancelled from public.billing_document_cancellations where document_id=parent.document_id;
 available=case when note.date>as_of or cancelled<=as_of or parent_cancelled<=as_of then 0 else least(remaining,greatest(0,-balance)) end;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;
 write_allowed=public.billing_can_access(business,true) and config.business_id is not null and config.currency=note.snapshot->>'currency' and cancelled is null and parent_cancelled is null and exists(select 1 from public.billing_source_postings where source_id=note.document_id and kind='document.issue') and exists(select 1 from public.billing_source_postings where source_id=parent.document_id and kind='document.issue') and exists(select 1 from public.billing_records r where r.id=(parent.snapshot->>'clientId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='clients');
 return jsonb_build_object('businessId',business,'demo',data_mode,'asOf',as_of,'currency',note.snapshot->>'currency','canWrite',coalesce(write_allowed,false),'creditNote',jsonb_build_object('id',note.document_id,'number',note.number,'date',note.date,'total',((note.snapshot->'totals'->>'total')::numeric(18,2))::text,'currency',note.snapshot->>'currency','clientId',parent.snapshot->>'clientId','parentDocumentId',parent.document_id,'parentNumber',parent.number,'parentDate',parent.date,'seller',note.snapshot->'seller','buyer',parent.snapshot->'buyer','cancelledOn',cancelled),'parentBalance',balance::text,'noteRemaining',remaining::text,'available',available::text,'refunds',refund_rows,'fundsMovedByFolio',false);
end$$;

revoke all on function public.billing_customer_credit_refund_movements(uuid),public.billing_validate_customer_refund_history(uuid),public.billing_validate_customer_settlement(uuid,date),public.billing_customer_refund_corrections_before(uuid,date),public.billing_customer_refund_compatibility_guard(),public.billing_customer_credit_refund_read(uuid,boolean,date,uuid) from public,anon,authenticated;
grant execute on function public.billing_customer_credit_refund_read(uuid,boolean,date,uuid) to authenticated;

create or replace function public.billing_source_reconciliation(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer_refund_ar numeric(30,2)=0;credit_expected numeric(30,2)=0;credit_actual numeric(30,2)=0;refund_cash numeric(30,2)=0;credit_tax numeric(30,2)=0;advance_in_expected numeric(30,2)=0;advance_out_expected numeric(30,2)=0;advance_in_actual numeric(30,2)=0;advance_out_actual numeric(30,2)=0;cash_new numeric(30,2)=0;ar_allocated numeric(30,2)=0;config public.billing_auto_posting_configs;ledger public.billing_ledger_configs;accounts jsonb;
 ar_expected numeric(30,2)=0;ar_actual numeric(30,2)=0;ap_expected numeric(30,2)=0;ap_actual numeric(30,2)=0;cash_expected numeric(30,2)=0;cash_actual numeric(30,2)=0;tax_expected numeric(30,2)=0;tax_actual numeric(30,2)=0;
 itc_expected numeric(30,2)=0;itc_actual numeric(30,2)=0;itc_account uuid;expense_cash numeric(30,2)=0;unposted_expenses bigint=0;
 cash_vendor numeric(30,2)=0;unposted bigint=0;legacy bigint=0;foreign_docs bigint=0;ap_account uuid;row_count bigint;result jsonb;source_rows bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Source reconciliation unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid reconciliation date';end if;
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select * into config from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode;
 if config.business_id is null then return jsonb_build_object('businessId',business,'demo',data_mode,'configured',false,'ledgerConfigured',ledger.business_id is not null,'canManage',public.billing_is_owner(business),'accounts',accounts,'currency',ledger.currency,'ledgerStart',ledger.start_date,'asOf',as_of,'reviewStatus','unreviewed');end if;
 with documents as(
  select i.*,case when i.type='credit-note' then -1 else 1 end as sign,c.date as cancelled_on from public.billing_issued_documents i left join public.billing_document_cancellations c on c.document_id=i.document_id
  where i.business_id=business and i.demo=data_mode and i.date>=config.cutover_date and i.date<=as_of and i.snapshot->>'currency'=config.currency and i.type in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note')
 ) select coalesce(sum((snapshot->'totals'->>'total')::numeric*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),coalesce(sum(((snapshot->'totals'->>'tax')::numeric+(snapshot->'totals'->>'cess')::numeric)*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),count(*) into ar_expected,tax_expected,source_rows from documents;
 select ar_expected-coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0),coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0) into ar_expected,cash_expected
 from public.billing_payment_events p join public.billing_issued_documents i on i.document_id=p.document_id
 where p.business_id=business and p.demo=data_mode and p.transaction_date between config.cutover_date and as_of and p.currency=config.currency and i.date>=config.cutover_date;
 select coalesce(sum(e.charge-e.credit),0) into ap_expected from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.date<=as_of;
 select coalesce(sum(p.amount) filter(where p.date<=as_of),0)-coalesce(sum(p.amount) filter(where r.date<=as_of),0) into cash_vendor from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.business_id=business and p.demo=data_mode and p.account_id=config.cash_account;
 cash_expected=cash_expected-cash_vendor;
 select coalesce(sum(p.gross_amount) filter(where p.cash_account=config.cash_account),0),coalesce(sum(p.input_tax),0) into expense_cash,itc_expected from public.billing_posted_expenses p left join public.billing_expense_reversals r on r.expense_id=p.expense_id where p.business_id=business and p.demo=data_mode and p.date<=as_of and (r.id is null or r.date>as_of);
 cash_expected=cash_expected-expense_cash;
 select itc_expected+coalesce(sum((b.data->>'taxAmount')::numeric),0) into itc_expected from public.billing_vendor_bills b where b.business_id=business and b.demo=data_mode and b.status='issued' and (b.data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of);
 select id into itc_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1300' and type='asset';
 select coalesce(sum(e.debit-e.credit),0) into itc_actual from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and e.account_id=itc_account and b.date<=as_of;
 select count(*) into unposted_expenses from public.billing_records r where r.business_id=business and r.demo=data_mode and r.collection='expenses' and not r.archived and r.data->>'date'<=as_of::text and not exists(select 1 from public.billing_posted_expenses p where p.expense_id=r.id);

 select id into ap_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 select coalesce(sum(c.amount*case when c.direction='incoming' then 1 else -1 end*case when c.kind='cash' then 1 else -1 end),0) into cash_new from public.billing_cash_events c where c.business_id=business and c.demo=data_mode and c.date<=as_of;
 cash_expected=cash_expected+cash_new;
 select coalesce(sum(f.amount*case when f.direction='incoming' then 1 else -1 end*case when f.kind='refund' then 1 else -1 end),0) into refund_cash from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.date<=as_of;
 cash_expected=cash_expected+refund_cash;
 select coalesce(sum(c.tax_amount),0) into credit_tax from public.billing_vendor_credits c where c.business_id=business and c.demo=data_mode and c.date<=as_of and not exists(select 1 from public.billing_vendor_credit_reversals r where r.credit_id=c.id and r.date<=as_of);
 itc_expected=itc_expected-credit_tax;
 select coalesce(sum(coalesce((select sum(m.delta) from public.billing_vendor_credit_movements(c.id)m where m.date<=as_of),0)),0) into credit_expected from public.billing_vendor_credits c where c.business_id=business and c.demo=data_mode;
 select coalesce(sum(e.debit-e.credit),0) into credit_actual from public.billing_ledger_entries e join public.billing_ledger_accounts a on a.id=e.account_id join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and a.code='1450' and b.date<=as_of;

 select coalesce(sum(a.amount*case when a.kind='allocate' then 1 else -1 end),0) into ar_allocated from public.billing_cash_allocations a join public.billing_cash_events c on c.id=a.cash_id where a.business_id=business and a.demo=data_mode and a.date<=as_of and c.direction='incoming';
 ar_expected=ar_expected-ar_allocated;
 select coalesce(sum(f.amount*case when f.kind='refund' then 1 else -1 end),0) into customer_refund_ar from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.source_kind='customer-credit-note' and f.date<=as_of;
 ar_expected=ar_expected+customer_refund_ar;
 with funds as(select c.id,c.direction,coalesce((select sum(m.delta) from public.billing_cash_movements(c.id)m where m.date<=as_of),0) amount from public.billing_cash_events c where c.business_id=business and c.demo=data_mode and c.kind='cash')
 select coalesce(sum(amount) filter(where direction='incoming'),0),coalesce(sum(amount) filter(where direction='outgoing'),0) into advance_in_expected,advance_out_expected from funds;
 select coalesce(sum(e.credit-e.debit) filter(where a.code='2200'),0),coalesce(sum(e.debit-e.credit) filter(where a.code='1400'),0) into advance_in_actual,advance_out_actual from public.billing_ledger_entries e join public.billing_ledger_accounts a on a.id=e.account_id join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.receivable_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=ap_account),0),coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.cash_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=config.tax_account),0) into ar_actual,ap_actual,cash_actual,tax_actual
 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select count(*) filter(where i.document_id is null),count(*) filter(where i.document_id is not null and not exists(select 1 from public.billing_source_postings p where p.source_id=r.id and p.kind='document.issue')),count(*) filter(where r.data->>'currency'<>config.currency)
 into legacy,unposted,foreign_docs from public.billing_records r left join public.billing_issued_documents i on i.document_id=r.id
 where r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note') and (r.data->>'status' in ('sent','paid') or r.data->>'status'='cancelled' and i.document_id is not null) and (r.data->>'date')::date<=as_of;
 return jsonb_build_object('businessId',business,'demo',data_mode,'configured',true,'ledgerConfigured',true,'canManage',public.billing_is_owner(business),'config',to_jsonb(config),'currency',config.currency,'asOf',as_of,'accounts',accounts,'controls',jsonb_build_array(
 jsonb_build_object('code','AR','name','Accounts receivable','expected',ar_expected::text,'ledger',ar_actual::text,'difference',(ar_actual-ar_expected)::text),
 jsonb_build_object('code','AP','name','Accounts payable','expected',ap_expected::text,'ledger',ap_actual::text,'difference',(ap_actual-ap_expected)::text),
 jsonb_build_object('code','CASH','name','Cash / bank','expected',cash_expected::text,'ledger',cash_actual::text,'difference',(cash_actual-cash_expected)::text),
 jsonb_build_object('code','TAX','name','Output tax payable','expected',tax_expected::text,'ledger',tax_actual::text,'difference',(tax_actual-tax_expected)::text),jsonb_build_object('code','ITC','name','Reviewed input tax receivable','expected',itc_expected::text,'ledger',itc_actual::text,'difference',(itc_actual-itc_expected)::text),
 jsonb_build_object('code','CUSTOMER_ADVANCE','name','Unapplied customer cash','expected',advance_in_expected::text,'ledger',advance_in_actual::text,'difference',(advance_in_actual-advance_in_expected)::text),
 jsonb_build_object('code','VENDOR_ADVANCE','name','Unapplied vendor disbursements','expected',advance_out_expected::text,'ledger',advance_out_actual::text,'difference',(advance_out_actual-advance_out_expected)::text),jsonb_build_object('code','VENDOR_CREDIT','name','Unapplied supplier credits','expected',credit_expected::text,'ledger',credit_actual::text,'difference',(credit_actual-credit_expected)::text)),
 'unpostedExpenses',unposted_expenses,'unpostedManagedDocuments',unposted,'legacyDocumentsNeedingOpeningReview',legacy,'foreignDocumentsNeedingFxReview',foreign_docs,'managedDocumentsThroughDate',source_rows,'arithmeticAgrees',ar_actual=ar_expected and ap_actual=ap_expected and cash_actual=cash_expected and tax_actual=tax_expected and itc_actual=itc_expected and advance_in_actual=advance_in_expected and advance_out_actual=advance_out_expected and credit_actual=credit_expected and unposted_expenses=0 and unposted=0 and legacy=0 and foreign_docs=0,'reviewStatus','unreviewed',
 'limitations',jsonb_build_array('Mechanical control-account comparison only; personal review decisions are recorded separately and this result does not assert sign-off. Supplier credit tax amounts are user-reviewed corrections, not completed GST filings.','Expected AR/output tax uses frozen managed documents and dated receipt/cancellation events after cutover. No paid flag becomes cash. Customer credit-note refund records debit AR separately from advance refunds; record corrections remain dated.','Expected AP uses explicit Folio vendor bills/payments/reversals. Cash allocations/releases are included once; unapplied advances are independent controls. Supplier credit allocations/releases reduce AP; supplier credit issues/refunds stay separate from bill aging. Manual journals are not invented.','Expected cash also includes explicit paid expense snapshots/reversals; reviewed input tax includes expense and vendor bill snapshots. Unposted expenses require opening/source review.','Manual/opening control-account entries can cause differences and need reviewed mappings. FX, inventory and additional expense sources remain separate work.'));
end$$;

notify pgrst,'reload schema';
