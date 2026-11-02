-- Cash is independent of settlement. No existing receipt/bill/payment is rewritten.
-- Local kernel only: complete report/UI integration is required before activation.
create table public.billing_cash_configs(
 business_id uuid not null,demo boolean not null,cutover_date date not null,currency text not null,
 cash_account uuid not null,receivable_account uuid not null,payable_account uuid not null,customer_advance_account uuid not null,vendor_advance_account uuid not null,
 actor_id uuid not null references auth.users(id),primary key(business_id,demo),
 foreign key(business_id,demo) references public.billing_ledger_configs(business_id,demo),
 foreign key(cash_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(receivable_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(payable_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(customer_advance_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(vendor_advance_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo)
);
create table public.billing_cash_events(
 id uuid primary key,business_id uuid not null,demo boolean not null,direction text not null check(direction in ('incoming','outgoing')),
 kind text not null check(kind in ('cash','reversal')),reverses_id uuid unique,party_id uuid not null,date date not null,currency text not null,
 amount numeric(18,2) not null check(amount>0 and amount<=10000000000),number text not null,snapshot jsonb not null,batch_id uuid not null unique,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(id,business_id,demo),unique(business_id,demo,number),check((kind='reversal')=(reverses_id is not null)),
 foreign key(party_id,business_id,demo) references public.billing_records(id,business_id,demo),
 foreign key(reverses_id,business_id,demo) references public.billing_cash_events(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create table public.billing_cash_allocations(
 id uuid primary key,business_id uuid not null,demo boolean not null,cash_id uuid not null,target_id uuid not null,
 kind text not null check(kind in ('allocate','release')),releases_id uuid,date date not null,
 amount numeric(18,2) not null check(amount>0 and amount<=10000000000),snapshot jsonb not null,batch_id uuid not null unique,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo),
 check((kind='release')=(releases_id is not null)),
 foreign key(cash_id,business_id,demo) references public.billing_cash_events(id,business_id,demo),
 foreign key(releases_id,business_id,demo) references public.billing_cash_allocations(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create index cash_scope on public.billing_cash_events(business_id,demo,party_id,date,id);
create index cash_allocation_target on public.billing_cash_allocations(business_id,demo,target_id,date,id);
create index cash_allocation_source on public.billing_cash_allocations(cash_id,date,id);
create table public.billing_cash_commands(
 business_id uuid not null,demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,
 primary key(business_id,demo,command_id),foreign key(business_id,demo) references public.billing_cash_configs(business_id,demo)
);
create table public.billing_cash_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_cash_commands(business_id,demo,command_id)
);
alter table public.billing_cash_configs enable row level security;
alter table public.billing_cash_events enable row level security;
alter table public.billing_cash_allocations enable row level security;
alter table public.billing_cash_commands enable row level security;
alter table public.billing_cash_outbox enable row level security;
revoke all on public.billing_cash_configs,public.billing_cash_events,public.billing_cash_allocations,public.billing_cash_commands,public.billing_cash_outbox from public,anon,authenticated;
grant select on public.billing_cash_configs,public.billing_cash_events,public.billing_cash_allocations to authenticated;
create policy cash_config_read on public.billing_cash_configs for select to authenticated using(public.billing_can_access(business_id));
create policy cash_event_read on public.billing_cash_events for select to authenticated using(public.billing_can_access(business_id));
create policy cash_allocation_read on public.billing_cash_allocations for select to authenticated using(public.billing_can_access(business_id));
create trigger cash_config_immutable before update or delete on public.billing_cash_configs for each row execute function public.billing_ledger_immutable();
create trigger cash_event_immutable before update or delete on public.billing_cash_events for each row execute function public.billing_ledger_immutable();
create trigger cash_allocation_immutable before update or delete on public.billing_cash_allocations for each row execute function public.billing_ledger_immutable();
create trigger cash_command_immutable before update or delete on public.billing_cash_commands for each row execute function public.billing_ledger_immutable();
create trigger cash_outbox_immutable before update or delete on public.billing_cash_outbox for each row execute function public.billing_ledger_immutable();

create function public.billing_cash_setup(business uuid,data_mode boolean,cutover date,accounts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ledger public.billing_ledger_configs;auto_config public.billing_auto_posting_configs;config public.billing_cash_configs;key text;expected text;account uuid;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can configure advances and allocations';end if;
 perform public.billing_ledger_writer_lock(business,true);
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into auto_config from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 if ledger.business_id is null or auto_config.business_id is null then raise exception 'Configure the ledger and automatic document posting first';end if;
 if data_mode is null or cutover is null or not isfinite(cutover) then raise exception 'Choose a finite cash cutover and data mode';end if;
 if jsonb_typeof(accounts) is distinct from 'object' or accounts-array['cash','receivable','payable','customerAdvance','vendorAdvance']<>'{}'::jsonb then raise exception 'Review the five cash and allocation accounts';end if;
 foreach key in array array['cash','receivable','payable','customerAdvance','vendorAdvance'] loop
  if coalesce(accounts->>key,'')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose every cash and allocation account';end if;
  expected=case when key in ('payable','customerAdvance') then 'liability' else 'asset' end;
  select id into account from public.billing_ledger_accounts a where a.id=(accounts->>key)::uuid and a.business_id=business and a.demo=data_mode and a.type=expected and (key not in ('payable','customerAdvance','vendorAdvance') or a.code=case key when 'payable' then '2000' when 'customerAdvance' then '2200' else '1400' end);
  if account is null then raise exception 'Cash/advance account classification or scope needs review (AP 2000, customer advances 2200, vendor advances 1400)';end if;
 end loop;
 if auto_config.tax_account in ((accounts->>'payable')::uuid,(accounts->>'customerAdvance')::uuid) or auto_config.receivable_account in ((accounts->>'vendorAdvance')::uuid) or auto_config.cash_account in ((accounts->>'vendorAdvance')::uuid) then raise exception 'Advance/AP controls must be separate from automatic source tax, AR and cash mappings';end if;
 if (accounts->>'cash')::uuid<>auto_config.cash_account or (accounts->>'receivable')::uuid<>auto_config.receivable_account or (select count(distinct value) from jsonb_each_text(accounts))<>5 then raise exception 'Cash and AR must match source mappings; all five controls must be distinct';end if;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;
 if config.business_id is not null then
  if config.cutover_date<>cutover or config.cash_account<>(accounts->>'cash')::uuid or config.receivable_account<>(accounts->>'receivable')::uuid or config.payable_account<>(accounts->>'payable')::uuid or config.customer_advance_account<>(accounts->>'customerAdvance')::uuid or config.vendor_advance_account<>(accounts->>'vendorAdvance')::uuid then raise exception 'Cash cutover and mappings are immutable';end if;
  return to_jsonb(config);
 end if;
 if data_mode is null or cutover is null or not isfinite(cutover) or cutover<auto_config.cutover_date or cutover<=coalesce(ledger.closed_through,cutover-1) or cutover>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Choose a cash cutover in the open period on or after source cutover and on or before today';end if;
 insert into public.billing_cash_configs(business_id,demo,cutover_date,currency,cash_account,receivable_account,payable_account,customer_advance_account,vendor_advance_account,actor_id)
 values(business,data_mode,cutover,ledger.currency,(accounts->>'cash')::uuid,(accounts->>'receivable')::uuid,(accounts->>'payable')::uuid,(accounts->>'customerAdvance')::uuid,(accounts->>'vendorAdvance')::uuid,auth.uid()) returning * into config;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'cash.configured',jsonb_build_object('cutover',cutover,'accounts',accounts));return to_jsonb(config);
end$$;

-- Private dated timelines. Aggregate by effective date: input array order cannot alter money.
create function public.billing_cash_movements(cash uuid) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select c.date,case when c.kind='cash' then c.amount else -c.amount end from public.billing_cash_events c where c.id=cash or c.reverses_id=cash
 union all select a.date,case when a.kind='allocate' then -a.amount else a.amount end from public.billing_cash_allocations a where a.cash_id=cash
$$;
create function public.billing_settlement_movements(target uuid,direction text) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
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
$$;
create function public.billing_validate_cash_history(cash uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from(select sum(sum(delta)) over(order by date) balance from public.billing_cash_movements(cash) group by date)x where balance<0) then raise exception 'Cash allocation/reversal exceeds available funds at an effective date; review the complete dated history';end if;
end$$;
create function public.billing_validate_settlement_history(target uuid,direction text) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from(select sum(sum(delta)) over(order by date) balance from public.billing_settlement_movements(target,direction) group by date)x where balance<0) then raise exception 'Settlement exceeds a document balance at an effective date; review payments, allocations and corrections';end if;
end$$;

create function public.billing_cash_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_cash_configs;prior public.billing_cash_commands;cash public.billing_cash_events;party public.billing_records;document public.billing_records;bill public.billing_vendor_bills;original public.billing_cash_allocations;
 request jsonb;result jsonb;payload jsonb;journal jsonb;entries jsonb;item jsonb;rows jsonb='[]';snapshot jsonb;event_id uuid;requested_cash uuid;target_id uuid;day date;amount numeric(18,2);direction text;control uuid;debit_account uuid;credit_account uuid;target_version integer;reason text;allocated numeric;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot record cash or change allocations';end if;
 if business is null or data_mode is null or command_id is null or action is null or action not in ('record','allocate','release','reverse') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid cash command';end if;
 request=jsonb_build_object('action',action,'data',command_data);
 select * into prior from public.billing_cash_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_cash_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different cash command';end if;return prior.result||jsonb_build_object('replayed',true);
 end if;
 if action='record' then
  if command_data-array['partyId','direction','date','currency','amount','method','reference','notes','paidConfirmed']<>'{}'::jsonb or command_data->'paidConfirmed' is distinct from 'true'::jsonb then raise exception 'Confirm this payment occurred outside Folio; this command does not move money';end if;
  direction=command_data->>'direction';if direction is null or direction not in ('incoming','outgoing') or coalesce(command_data->>'partyId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a saved customer or vendor and cash direction';end if;
 else
  if coalesce(command_data->>'cashId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an original cash event';end if;requested_cash=(command_data->>'cashId')::uuid;
  select * into cash from public.billing_cash_events c where c.id=requested_cash and c.business_id=business and c.demo=data_mode and c.kind='cash';
  if cash.id is null then raise exception 'Cash event unavailable in this business and data mode';end if;direction=cash.direction;
  if action='allocate' then
   if command_data-array['cashId','date','targets']<>'{}'::jsonb or jsonb_typeof(command_data->'targets') is distinct from 'array' or jsonb_array_length(command_data->'targets') not between 1 and 50 then raise exception 'Choose 1 to 50 distinct document allocations';end if;
   for item in select value from jsonb_array_elements(command_data->'targets') loop
    if jsonb_typeof(item) is distinct from 'object' or item-array['id','version','amount']<>'{}'::jsonb or coalesce(item->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(item->>'version','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Each allocation needs a versioned target and exact amount';end if;
   end loop;
   if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(command_data->'targets'))<>jsonb_array_length(command_data->'targets') then raise exception 'Choose distinct allocation targets';end if;
   if direction='incoming' then
    -- Lock targets in canonical order BEFORE the business/numbering lock.
    perform 1 from public.billing_records r where r.id in(select (value->>'id')::uuid from jsonb_array_elements(command_data->'targets')) and r.business_id=business and r.demo=data_mode and r.collection='documents' order by r.id for update;
   end if;
  elsif action='release' then
   if command_data-array['cashId','allocationId','date','amount','reason']<>'{}'::jsonb or coalesce(command_data->>'allocationId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an allocation and release amount/date/reason';end if;
   select * into original from public.billing_cash_allocations a where a.id=(command_data->>'allocationId')::uuid and a.cash_id=cash.id and a.business_id=business and a.demo=data_mode and a.kind='allocate';
   if original.id is null then raise exception 'Original allocation unavailable';end if;
   if direction='incoming' then perform 1 from public.billing_records where id=original.target_id for update;end if;
  elsif command_data-array['cashId','date','reason']<>'{}'::jsonb then raise exception 'Cash reversal needs a date and reason';end if;
 end if;
 perform public.billing_ledger_writer_lock(business,false);
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;
 if config.business_id is null then raise exception 'Configure reviewed cash/advance controls first';end if;
 select * into prior from public.billing_cash_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_cash_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different cash command';end if;return prior.result||jsonb_build_object('replayed',true);
 end if;
 day=public.billing_payment_date(command_data->'date');
 if day<config.cutover_date then raise exception 'Cash event/allocation predates cash cutover; review opening treatment';end if;
 control=case when direction='incoming' then config.customer_advance_account else config.vendor_advance_account end;
 if action='record' then
  if command_data->>'currency' is distinct from config.currency then raise exception 'Cash currency must match ledger base; review FX separately';end if;
  select * into party from public.billing_records r where r.id=(command_data->>'partyId')::uuid and r.business_id=business and r.demo=data_mode and r.collection=case when direction='incoming' then 'clients' else 'vendors' end and not r.archived;
  if party.id is null or length(btrim(coalesce(party.data->>'name',''))) not between 1 and 5000 then raise exception 'Choose a saved party in this business and data mode';end if;
  if jsonb_typeof(command_data->'method') is distinct from 'string' or length(btrim(command_data->>'method')) not between 1 and 100 or jsonb_typeof(command_data->'reference') is distinct from 'string' or length(command_data->>'reference')>500 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(command_data->>'notes')>5000 then raise exception 'Review cash method, reference and notes';end if;
  amount=public.billing_payment_amount(command_data->'amount');event_id=gen_random_uuid();
  debit_account=case when direction='incoming' then config.cash_account else control end;credit_account=case when direction='incoming' then control else config.cash_account end;
  journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description',case when direction='incoming' then 'Customer cash receipt' else 'Vendor disbursement / advance' end,'entries',jsonb_build_array(jsonb_build_object('account_id',debit_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit_account,'debit','0','credit',amount::text)))))->'batch';
  snapshot=command_data||jsonb_build_object('business',(select jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'email',b.email,'phone',b.phone,'gstin',b.gstin) from public.billing_businesses b where b.id=business),'party',party.data,'partyId',party.id,'currency',config.currency,'providerMode','manual-external','fundsMovedByFolio',false);
  insert into public.billing_cash_events(id,business_id,demo,direction,kind,party_id,date,currency,amount,number,snapshot,batch_id,actor_id)
  values(event_id,business,data_mode,direction,'cash',party.id,day,config.currency,amount,(case when direction='incoming' then 'CASH-' else 'DISB-' end)||(journal->>'number'),snapshot,(journal->>'id')::uuid,auth.uid()) returning * into cash;
  result=jsonb_build_object('cash',to_jsonb(cash)||jsonb_build_object('amount',cash.amount::text),'journal',journal,'allocations','[]'::jsonb,'replayed',false);
 elsif action='allocate' then
  if exists(select 1 from public.billing_cash_events where reverses_id=cash.id) then raise exception 'Reversed cash cannot receive new allocations';end if;
  if day<cash.date then raise exception 'Allocation cannot predate its cash';end if;
  for item in select value from jsonb_array_elements(command_data->'targets') order by (value->>'id')::uuid loop
   target_id=(item->>'id')::uuid;target_version=(item->>'version')::integer;amount=public.billing_payment_amount(item->'amount');
   if direction='incoming' then
    select * into document from public.billing_records r where r.id=target_id and r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived;
    if document.id is null or document.data->>'clientId' is distinct from cash.party_id::text or document.data->>'currency' is distinct from config.currency or document.data->>'type' not in ('invoice','gst-invoice','commercial-invoice') or not exists(select 1 from public.billing_source_postings where source_id=target_id and kind='document.issue') or exists(select 1 from public.billing_document_cancellations where document_id=target_id) then raise exception 'Choose an active posted invoice for this saved customer, currency and data mode';end if;
    if document.version<>target_version then raise exception using errcode='40001',message='Invoice changed; reload allocation targets';end if;
    if day<(document.data->>'date')::date then raise exception 'Allocation cannot predate its invoice';end if;snapshot=document.data;
    debit_account=control;credit_account=config.receivable_account;
   else
    select * into bill from public.billing_vendor_bills b where b.id=target_id and b.business_id=business and b.demo=data_mode and b.status='issued';
    if bill.id is null or bill.data->>'vendorId' is distinct from cash.party_id::text or bill.data->>'currency' is distinct from config.currency or exists(select 1 from public.billing_ledger_batches where reverses_id=bill.issued_batch) then raise exception 'Choose an active issued bill for this saved vendor, currency and data mode';end if;
    if bill.version<>target_version then raise exception using errcode='40001',message='Vendor bill changed; reload allocation targets';end if;
    if day<(bill.data->>'date')::date then raise exception 'Allocation cannot predate its bill';end if;snapshot=bill.data;
    debit_account=config.payable_account;credit_account=control;
   end if;
   event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request||jsonb_build_object('targetId',target_id),jsonb_build_object('date',day,'kind','manual','description','Cash allocation '||(snapshot->>'number'),'entries',jsonb_build_array(jsonb_build_object('account_id',debit_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit_account,'debit','0','credit',amount::text)))))->'batch';
   insert into public.billing_cash_allocations(id,business_id,demo,cash_id,target_id,kind,date,amount,snapshot,batch_id,actor_id) values(event_id,business,data_mode,cash.id,target_id,'allocate',day,amount,jsonb_build_object('target',snapshot,'cashNumber',cash.number,'currency',config.currency,'direction',direction),(journal->>'id')::uuid,auth.uid());
   perform public.billing_validate_settlement_history(target_id,direction);
   rows=rows||jsonb_build_array(jsonb_build_object('id',event_id,'cashId',cash.id,'targetId',target_id,'kind','allocate','date',day,'amount',amount::text,'journal',journal));
  end loop;
  perform public.billing_validate_cash_history(cash.id);result=jsonb_build_object('cashId',cash.id,'allocations',rows,'replayed',false);
 else
  reason=btrim(command_data->>'reason');if jsonb_typeof(command_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Enter the dated correction reason';end if;
  if action='release' then
   amount=public.billing_payment_amount(command_data->'amount');
   if day<original.date then raise exception 'Release cannot predate its allocation';end if;
   select coalesce(sum(a.amount),0) into allocated from public.billing_cash_allocations a where a.releases_id=original.id;
   if amount>original.amount-allocated then raise exception 'Release exceeds the remaining original allocation';end if;
   debit_account=case when direction='incoming' then config.receivable_account else control end;credit_account=case when direction='incoming' then control else config.payable_account end;
   event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description','Release cash allocation: '||left(reason,900),'entries',jsonb_build_array(jsonb_build_object('account_id',debit_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit_account,'debit','0','credit',amount::text)))))->'batch';
   insert into public.billing_cash_allocations(id,business_id,demo,cash_id,target_id,kind,releases_id,date,amount,snapshot,batch_id,actor_id) values(event_id,business,data_mode,cash.id,original.target_id,'release',original.id,day,amount,original.snapshot||jsonb_build_object('reason',reason),(journal->>'id')::uuid,auth.uid());
   perform public.billing_validate_cash_history(cash.id);perform public.billing_validate_settlement_history(original.target_id,direction);
   result=jsonb_build_object('cashId',cash.id,'allocations',jsonb_build_array(jsonb_build_object('id',event_id,'cashId',cash.id,'targetId',original.target_id,'kind','release','releasesId',original.id,'date',day,'amount',amount::text,'journal',journal)),'replayed',false);
  else
   if exists(select 1 from public.billing_cash_events where reverses_id=cash.id) then raise exception 'Cash is already reversed';end if;
   if day<cash.date then raise exception 'Reversal cannot predate original cash';end if;
   if exists(select 1 from public.billing_cash_allocations a where a.cash_id=cash.id and a.kind='allocate' and a.amount>coalesce((select sum(r.amount) from public.billing_cash_allocations r where r.releases_id=a.id and r.date<=day),0)) or exists(select 1 from public.billing_cash_allocations where cash_id=cash.id and date>day) then raise exception 'Release every allocation first; cash reversal cannot predate allocation corrections';end if;
   event_id=gen_random_uuid();insert into public.billing_cash_reversal_authority(event_id,business_id,demo,cash_id,date) values(event_id,business,data_mode,cash.id,day);journal=(public.billing_ledger_reverse(business,data_mode,event_id,cash.batch_id,day,reason))->'batch';
   insert into public.billing_cash_events(id,business_id,demo,direction,kind,reverses_id,party_id,date,currency,amount,number,snapshot,batch_id,actor_id) values(event_id,business,data_mode,direction,'reversal',cash.id,cash.party_id,day,cash.currency,cash.amount,'REV-'||(journal->>'number'),cash.snapshot||jsonb_build_object('reason',reason),(journal->>'id')::uuid,auth.uid()) returning * into cash;
   perform public.billing_validate_cash_history(cash.reverses_id);result=jsonb_build_object('cash',to_jsonb(cash)||jsonb_build_object('amount',cash.amount::text),'journal',journal,'allocations','[]'::jsonb,'replayed',false);
  end if;
 end if;
 insert into public.billing_cash_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'cash.'||action,jsonb_build_object('commandId',command_id,'cashId',cash.id,'eventId',event_id));
 insert into public.billing_cash_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'cash.'||action,result);
 return result;
end$$;

-- Private authority exists before the ledger reversal; all writes roll back together.
-- A general GL reversal cannot invent this authority or release an allocation.
create table public.billing_cash_reversal_authority(
 event_id uuid primary key,business_id uuid not null,demo boolean not null,cash_id uuid not null,date date not null,
 foreign key(cash_id,business_id,demo) references public.billing_cash_events(id,business_id,demo)
);
alter table public.billing_cash_reversal_authority enable row level security;
revoke all on public.billing_cash_reversal_authority from public,anon,authenticated;
create trigger cash_reversal_authority_immutable before update or delete on public.billing_cash_reversal_authority for each row execute function public.billing_ledger_immutable();
create function public.billing_cash_journal_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare original public.billing_cash_events;
begin
 if new.reverses_id is null then return new;end if;
 if exists(select 1 from public.billing_cash_allocations where batch_id=new.reverses_id) then raise exception 'Release the source allocation through its cash command';end if;
 select * into original from public.billing_cash_events where batch_id=new.reverses_id;
 if original.id is not null and not exists(select 1 from public.billing_cash_reversal_authority a where a.event_id=new.command_id and a.business_id=new.business_id and a.demo=new.demo and a.cash_id=original.id and a.date=new.date) then raise exception 'Reverse cash through its source command';end if;
 return new;
end$$;
create trigger cash_journal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_cash_journal_guard();

-- Existing direct settlements and source cancellations must respect allocations.
create function public.billing_cash_compatibility_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;direction text;
begin
 if tg_table_name='billing_payment_events' then target=new.document_id;direction='incoming';
 elsif tg_table_name='billing_vendor_payments' then target=new.bill_id;direction='outgoing';
 elsif tg_table_name='billing_ledger_batches' then
  select id into target from public.billing_vendor_bills where issued_batch=new.reverses_id;direction='outgoing';
 elsif tg_table_name='billing_document_cancellations' then
  select case when i.type in ('credit-note','debit-note') then (i.snapshot->>'originalDocumentId')::uuid else i.document_id end into target from public.billing_issued_documents i where i.document_id=new.document_id;direction='incoming';
 elsif tg_table_name='billing_issued_documents' then
  if new.type in ('credit-note','debit-note') then target=(new.snapshot->>'originalDocumentId')::uuid;else target=new.document_id;end if;direction='incoming';
 end if;
 if target is not null and exists(select 1 from public.billing_cash_allocations where target_id=target) then perform public.billing_validate_settlement_history(target,direction);end if;
 return new;
end$$;
create trigger cash_compat_payment after insert on public.billing_payment_events for each row execute function public.billing_cash_compatibility_guard();
create trigger cash_compat_vendor_payment after insert on public.billing_vendor_payments for each row execute function public.billing_cash_compatibility_guard();
create trigger cash_compat_bill_reversal after insert on public.billing_ledger_batches for each row execute function public.billing_cash_compatibility_guard();
create trigger cash_compat_document_cancel after insert on public.billing_document_cancellations for each row execute function public.billing_cash_compatibility_guard();
create trigger cash_compat_document_issue after insert on public.billing_issued_documents for each row execute function public.billing_cash_compatibility_guard();

revoke all on function public.billing_cash_setup(uuid,boolean,date,jsonb),public.billing_cash_movements(uuid),public.billing_settlement_movements(uuid,text),public.billing_validate_cash_history(uuid),public.billing_validate_settlement_history(uuid,text),public.billing_cash_command(uuid,boolean,uuid,text,jsonb),public.billing_cash_journal_guard(),public.billing_cash_compatibility_guard() from public,anon,authenticated;
grant execute on function public.billing_cash_setup(uuid,boolean,date,jsonb),public.billing_cash_command(uuid,boolean,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
