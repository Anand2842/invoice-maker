-- Immutable issue/cancel commands and explicit forward-only source posting cutover.
-- No historic paid flag, invoice, receipt or expense is replayed automatically.
create table public.billing_issued_documents(
 document_id uuid primary key,issue_id uuid not null unique,business_id uuid not null,demo boolean not null,
 source_version integer not null,origin text not null check(origin in ('issue','legacy-snapshot')),
 number text not null,type text not null,date date not null,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(document_id,business_id,demo) references public.billing_records(id,business_id,demo),
 unique(business_id,demo,type,number)
);
create table public.billing_document_cancellations(
 id uuid primary key,document_id uuid not null unique references public.billing_issued_documents(document_id),
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,date date not null,
 reason text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.billing_document_lifecycle_commands(
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,
 actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,
 primary key(business_id,demo,command_id)
);
create table public.billing_document_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,
 document_id uuid not null references public.billing_records(id),topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_document_lifecycle_commands(business_id,demo,command_id)
);
alter table public.billing_document_outbox enable row level security;
revoke all on public.billing_document_outbox from public,anon,authenticated;
create trigger document_outbox_immutable before update or delete on public.billing_document_outbox for each row execute function public.billing_ledger_immutable();
create table public.billing_auto_posting_configs(
 business_id uuid not null,demo boolean not null,cutover_date date not null,currency text not null,
 receivable_account uuid not null,income_account uuid not null,tax_account uuid not null,cash_account uuid not null,rounding_account uuid not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(business_id,demo),
 foreign key(business_id,demo) references public.billing_ledger_configs(business_id,demo),
 foreign key(receivable_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(income_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(tax_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(cash_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(rounding_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo)
);
create table public.billing_source_postings(
 event_id uuid primary key,business_id uuid not null,demo boolean not null,source_id uuid not null,
 kind text not null check(kind in ('document.issue','document.cancel','payment.receipt','payment.reversal')),
 batch_id uuid unique,snapshot jsonb not null,created_at timestamptz not null default now(),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),
 check(batch_id is not null or kind in ('document.issue','document.cancel'))
);
alter table public.billing_issued_documents enable row level security;
alter table public.billing_document_cancellations enable row level security;
alter table public.billing_document_lifecycle_commands enable row level security;
alter table public.billing_auto_posting_configs enable row level security;
alter table public.billing_source_postings enable row level security;
revoke all on public.billing_issued_documents,public.billing_document_cancellations,public.billing_document_lifecycle_commands,public.billing_auto_posting_configs,public.billing_source_postings from public,anon,authenticated;
grant select on public.billing_issued_documents,public.billing_document_cancellations,public.billing_auto_posting_configs,public.billing_source_postings to authenticated;
create policy issued_document_read on public.billing_issued_documents for select to authenticated using(public.billing_can_access(business_id));
create policy document_cancel_read on public.billing_document_cancellations for select to authenticated using(public.billing_can_access(business_id));
create policy auto_posting_read on public.billing_auto_posting_configs for select to authenticated using(public.billing_can_access(business_id));
create policy source_posting_read on public.billing_source_postings for select to authenticated using(public.billing_can_access(business_id));
create trigger issued_document_immutable before update or delete on public.billing_issued_documents for each row execute function public.billing_ledger_immutable();
create trigger document_cancel_immutable before update or delete on public.billing_document_cancellations for each row execute function public.billing_ledger_immutable();
create trigger document_command_immutable before update or delete on public.billing_document_lifecycle_commands for each row execute function public.billing_ledger_immutable();
create trigger auto_posting_config_immutable before update or delete on public.billing_auto_posting_configs for each row execute function public.billing_ledger_immutable();
create trigger source_posting_immutable before update or delete on public.billing_source_postings for each row execute function public.billing_ledger_immutable();
create index source_posting_scope on public.billing_source_postings(business_id,demo,source_id,kind);

create function public.billing_document_projection(document uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare issued public.billing_issued_documents;cancel public.billing_document_cancellations;result jsonb;
begin
 select * into issued from public.billing_issued_documents where document_id=document;if issued.document_id is null then return null;end if;
 result=issued.snapshot;
 select * into cancel from public.billing_document_cancellations where document_id=document;
 if cancel.id is not null then result=result||jsonb_build_object('status','cancelled','lifecycle',(result->'lifecycle')||jsonb_build_object('cancelledOn',cancel.date,'cancellationId',cancel.id,'reason',cancel.reason));end if;
 return result;
end$$;
create function public.billing_managed_document_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare projection jsonb;
begin
 if new.collection<>'documents' then return new;end if;
 projection=public.billing_document_projection(new.id);
 if projection is not null then
  if new.archived or new.data is distinct from projection then raise exception 'Issued document snapshots cannot be edited or archived; use lifecycle commands or an adjustment';end if;
 elsif new.data?'lifecycle' then raise exception 'Document lifecycle metadata can only be written by its command';
 elsif exists(select 1 from public.billing_auto_posting_configs where business_id=new.business_id and demo=new.demo) then
  if tg_op='INSERT' and new.data->>'status' is distinct from 'draft' then raise exception 'Save a draft and use the issue command before posting this document';end if;
  if tg_op='UPDATE' and (new.data->>'status' is distinct from 'draft' or old.data->>'status' is distinct from 'draft') and new.data is distinct from old.data then raise exception 'Freeze this legacy issued document before changing its lifecycle';end if;
 end if;
 return new;
end$$;
-- Money/adjustment/payment guards retain their established order and error semantics.
create trigger billing_90_managed_document before insert or update on public.billing_records for each row execute function public.billing_managed_document_guard();

create function public.billing_auto_posting_setup(business uuid,data_mode boolean,cutover date,accounts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_ledger_configs;existing public.billing_auto_posting_configs;account_role text;expected_type text;account uuid;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can enable automatic source postings';end if;
 perform public.billing_ledger_writer_lock(business,true);
 if cutover is null or not isfinite(cutover) then raise exception 'Choose a finite source cutover date';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if config.business_id is null then raise exception 'Configure the ledger before enabling source postings';end if;
 if jsonb_typeof(accounts) is distinct from 'object' or accounts-array['receivable','income','tax','cash','rounding']<>'{}'::jsonb then raise exception 'Review the five source posting accounts';end if;
 foreach account_role in array array['receivable','income','tax','cash','rounding'] loop
  if coalesce(accounts->>account_role,'')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose every source posting account';end if;
  expected_type=case account_role when 'receivable' then 'asset' when 'cash' then 'asset' when 'tax' then 'liability' else 'income' end;
  select id into account from public.billing_ledger_accounts where id=(accounts->>account_role)::uuid and business_id=business and demo=data_mode and type=expected_type;
  if account is null then raise exception 'Source posting account classification or scope is invalid';end if;
 end loop;
 if (accounts->>'receivable')::uuid=(accounts->>'cash')::uuid then raise exception 'Receivables and cash need separate accounts';end if;
 select * into existing from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 if existing.business_id is not null then
  if existing.cutover_date<>cutover or existing.receivable_account<>(accounts->>'receivable')::uuid or existing.income_account<>(accounts->>'income')::uuid or existing.tax_account<>(accounts->>'tax')::uuid or existing.cash_account<>(accounts->>'cash')::uuid or existing.rounding_account<>(accounts->>'rounding')::uuid then raise exception 'Source cutover and account mappings are immutable after activation';end if;
  return to_jsonb(existing);
 end if;
 if data_mode is null or cutover is null or not isfinite(cutover) or cutover<config.start_date or cutover<=coalesce(config.closed_through,cutover-1) or cutover>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Choose a source cutover date in the open ledger period on or before today';end if;
 insert into public.billing_auto_posting_configs(business_id,demo,cutover_date,currency,receivable_account,income_account,tax_account,cash_account,rounding_account,actor_id)
 values(business,data_mode,cutover,config.currency,(accounts->>'receivable')::uuid,(accounts->>'income')::uuid,(accounts->>'tax')::uuid,(accounts->>'cash')::uuid,(accounts->>'rounding')::uuid,auth.uid()) returning * into existing;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'source-postings.enabled',jsonb_build_object('cutover',cutover,'accounts',accounts));
 return to_jsonb(existing);
end$$;

-- Called only with document/parent -> business -> ledger config locks held.
create function public.billing_post_document_source(issued public.billing_issued_documents) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_auto_posting_configs;totals jsonb;entries jsonb='[]';result jsonb;total numeric(18,2);revenue numeric(18,2);tax numeric(18,2);rounding numeric(18,2);credit_note boolean;line jsonb;
begin
 select * into config from public.billing_auto_posting_configs where business_id=issued.business_id and demo=issued.demo;
 if config.business_id is null or issued.type not in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note') then return null;end if;
 if issued.date<config.cutover_date then raise exception 'This document predates source cutover; review opening balances instead of replaying historic income';end if;
 if issued.snapshot->>'currency'<>config.currency then raise exception 'Automatic source postings require the ledger base currency; FX posting is not configured';end if;
 if issued.type in ('credit-note','debit-note') and not exists(select 1 from public.billing_source_postings where business_id=issued.business_id and demo=issued.demo and source_id=(issued.snapshot->>'originalDocumentId')::uuid and kind='document.issue') then raise exception 'Post the parent invoice snapshot before posting its adjustment';end if;
 perform 1 from public.billing_ledger_configs where business_id=issued.business_id and demo=issued.demo for update;
 totals=(public.billing_document_totals(issued.snapshot))->'totals';total=(totals->>'total')::numeric;revenue=(totals->>'taxable')::numeric+(totals->>'shipping')::numeric;tax=(totals->>'tax')::numeric+(totals->>'cess')::numeric;rounding=(totals->>'roundOff')::numeric;credit_note=issued.type='credit-note';
 if total<0 then raise exception 'A source document total cannot be negative';end if;
 if total>0 then entries=jsonb_build_array(jsonb_build_object('account_id',config.receivable_account,'debit',case when credit_note then '0' else total::text end,'credit',case when credit_note then total::text else '0' end));end if;
 if revenue>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',config.income_account,'debit',case when credit_note then revenue::text else '0' end,'credit',case when credit_note then '0' else revenue::text end));end if;
 if tax>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',config.tax_account,'debit',case when credit_note then tax::text else '0' end,'credit',case when credit_note then '0' else tax::text end));end if;
 if rounding<>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',config.rounding_account,'debit',case when (rounding<0)<>credit_note then abs(rounding)::text else '0' end,'credit',case when (rounding<0)<>credit_note then '0' else abs(rounding)::text end));end if;
 if jsonb_array_length(entries)=0 then insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(issued.issue_id,issued.business_id,issued.demo,issued.document_id,'document.issue',null,issued.snapshot);return null;end if;
 result=public.billing_ledger_commit(issued.business_id,issued.demo,issued.issue_id,jsonb_build_object('source','document.issue','documentId',issued.document_id,'snapshot',issued.snapshot),jsonb_build_object('date',issued.date,'description','Issued '||issued.type||' '||issued.number,'kind','manual','entries',entries));
 insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(issued.issue_id,issued.business_id,issued.demo,issued.document_id,'document.issue',(result->'batch'->>'id')::uuid,issued.snapshot);
 return result->'batch';
end$$;

create function public.billing_document_command(business uuid,data_mode boolean,document_id uuid,expected_version integer,command_id uuid,action text,command_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records;issued public.billing_issued_documents;prior public.billing_document_lifecycle_commands;
 request jsonb;result jsonb;projection jsonb;journal jsonb;event_id uuid;day date;reason text;posting public.billing_source_postings;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot change this document lifecycle';end if;
 if data_mode is null or document_id is null or command_id is null or expected_version is null or expected_version<1 or action is null or action not in ('issue','adopt','cancel','post') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid document lifecycle command';end if;
 request=jsonb_build_object('documentId',document_id,'version',expected_version,'action',action,'data',command_data);
 select * into prior from public.billing_document_lifecycle_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_document_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different document lifecycle command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into source from public.billing_records r where r.id=billing_document_command.document_id and r.business_id=business and r.demo=data_mode and r.collection='documents' for update;
 if source.id is null or source.archived then raise exception 'Document unavailable in this business and data mode';end if;
 -- Existing document writers lock the note, its parent, then business numbering.
 if source.data->>'type' in ('credit-note','debit-note') then perform 1 from public.billing_records where id=(source.data->>'originalDocumentId')::uuid for update;end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_document_lifecycle_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_document_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different document lifecycle command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='Document changed; reload before changing its lifecycle';end if;
 select * into issued from public.billing_issued_documents d where d.document_id=source.id;
 if action in ('issue','adopt') then
  if command_data<>'{}'::jsonb then raise exception 'Issuance does not accept caller-supplied snapshots or totals';end if;
  if issued.document_id is not null then raise exception 'This document already has a frozen issued snapshot';end if;
  if action='issue' and source.data->>'status' is distinct from 'draft' or action='adopt' and not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'Issue a saved draft or explicitly freeze a legacy issued document';end if;
  perform public.billing_document_totals(source.data);day=public.billing_payment_date(source.data->'date');
  if coalesce(source.data->>'dueDate','')<>'' and public.billing_payment_date(source.data->'dueDate')<day then raise exception 'Document due date cannot precede its date';end if;
  if jsonb_typeof(source.data->'number') is distinct from 'string' or length(btrim(source.data->>'number')) not between 1 and 256 then raise exception 'Enter the issued document number';end if;
  if jsonb_typeof(source.data->'seller'->'name') is distinct from 'string' or length(btrim(source.data->'seller'->>'name')) not between 1 and 1024 or jsonb_typeof(source.data->'buyer'->'name') is distinct from 'string' or length(btrim(source.data->'buyer'->>'name')) not between 1 and 1024 then raise exception 'Review both document parties before issuing';end if;
  event_id=gen_random_uuid();projection=source.data||public.billing_document_totals(source.data)||jsonb_build_object('status',case when action='adopt' then source.data->>'status' else 'sent' end,'lifecycle',jsonb_build_object('version',1,'issueId',event_id,'origin',case when action='adopt' then 'legacy-snapshot' else 'issue' end,'issuedStatus',case when action='adopt' then source.data->>'status' else 'sent' end,'issuedOn',day,'recordedAt',now()));
  insert into public.billing_issued_documents(document_id,issue_id,business_id,demo,source_version,origin,number,type,date,snapshot,actor_id)
  values(source.id,event_id,business,data_mode,source.version,case when action='adopt' then 'legacy-snapshot' else 'issue' end,projection->>'number',projection->>'type',day,projection,auth.uid()) returning * into issued;
  journal=public.billing_post_document_source(issued);
  update public.billing_records set data=projection where id=source.id returning * into source;
 elsif action='post' then
  if command_data<>'{}'::jsonb or issued.document_id is null or source.data->>'status'='cancelled' then raise exception 'Choose an active frozen issued snapshot to post';end if;
  if exists(select 1 from public.billing_source_postings where source_id=source.id and kind='document.issue') then raise exception 'This issued snapshot is already posted';end if;
  journal=public.billing_post_document_source(issued);
  if not exists(select 1 from public.billing_source_postings where source_id=source.id and kind='document.issue') then raise exception 'Enable source posting for a supported financial document first';end if;
 else
  if command_data-array['date','reason']<>'{}'::jsonb then raise exception 'Cancellation needs only a date and reason';end if;
  if issued.document_id is null then raise exception 'Freeze the legacy issued snapshot before recording a dated cancellation';end if;
  if source.data->>'status'='cancelled' then raise exception 'This document is already cancelled';end if;
  day=public.billing_payment_date(command_data->'date');reason=btrim(command_data->>'reason');
  if day<issued.date or day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) or jsonb_typeof(command_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Choose a cancellation date on or after the document date, on or before today, and a reason';end if;
  if exists(select 1 from public.billing_records where business_id=business and demo=data_mode and collection='payments' and data->>'documentId'=source.id::text) then raise exception 'An invoice with recorded payments needs adjustments and payment reversals, not cancellation';end if;
  if exists(select 1 from public.billing_records r where r.business_id=business and r.demo=data_mode and r.collection='documents' and r.data->>'originalDocumentId'=source.id::text and not r.archived and (r.data->>'status'<>'cancelled' or (r.data->'lifecycle'->>'cancelledOn')::date>day)) then raise exception 'Cancel all adjustment notes first; invoice cancellation cannot predate their cancellations';end if;
  event_id=gen_random_uuid();insert into public.billing_document_cancellations(id,document_id,business_id,demo,date,reason,actor_id) values(event_id,source.id,business,data_mode,day,reason,auth.uid());
  select * into posting from public.billing_source_postings where source_id=source.id and kind='document.issue';
  if posting.event_id is not null then
   if posting.batch_id is not null then journal=(public.billing_ledger_reverse(business,data_mode,event_id,posting.batch_id,day,reason))->'batch';end if;
   insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(event_id,business,data_mode,source.id,'document.cancel',(journal->>'id')::uuid,jsonb_build_object('date',day,'reason',reason));
  end if;
  update public.billing_records set data=public.billing_document_projection(source.id) where id=source.id returning * into source;
 end if;
 result=jsonb_build_object('record',to_jsonb(source),'journal',journal,'replayed',false);
 insert into public.billing_document_lifecycle_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'document.'||action,jsonb_build_object('documentId',source.id,'issueId',issued.issue_id));
 insert into public.billing_document_outbox(business_id,demo,command_id,document_id,topic,payload) values(business,data_mode,command_id,source.id,'document.'||action,jsonb_build_object('documentId',source.id,'version',source.version,'issueId',issued.issue_id));
 return result;
end$$;

create function public.billing_source_reversal_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare original public.billing_source_postings;
begin
 if new.reverses_id is null then return new;end if;
 select * into original from public.billing_source_postings where batch_id=new.reverses_id;
 if original.kind='document.issue' and not exists(select 1 from public.billing_document_cancellations c where c.id=new.command_id and c.document_id=original.source_id and c.date=new.date) then raise exception 'Cancel the source document through its lifecycle command to reverse this journal';end if;
 if original.kind='payment.receipt' and not exists(select 1 from public.billing_payment_events p where p.id=new.command_id and p.kind='reversal' and p.reverses_id=original.source_id and p.transaction_date=new.date) then raise exception 'Reverse the source payment through its payment command to reverse this journal';end if;
 return new;
end$$;
create trigger billing_source_reversal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_source_reversal_guard();

create function public.billing_post_payment_source() returns trigger language plpgsql security definer set search_path='' as $$
declare config public.billing_auto_posting_configs;invoice_posting public.billing_source_postings;original public.billing_source_postings;result jsonb;entries jsonb;
begin
 select * into config from public.billing_auto_posting_configs where business_id=new.business_id and demo=new.demo;
 if config.business_id is null then return new;end if;
 if new.transaction_date<config.cutover_date or new.currency<>config.currency then raise exception 'Payment is outside source cutover/base currency; review its opening or FX treatment first';end if;
 select * into invoice_posting from public.billing_source_postings where business_id=new.business_id and demo=new.demo and source_id=new.document_id and kind='document.issue';
 if invoice_posting.event_id is null then raise exception 'Freeze and post the invoice snapshot before recording its automatic payment journal';end if;
 perform public.billing_ledger_writer_lock(new.business_id,false);
 perform 1 from public.billing_ledger_configs where business_id=new.business_id and demo=new.demo for update;
 if new.kind='receipt' then
  entries=jsonb_build_array(jsonb_build_object('account_id',config.cash_account,'debit',new.amount::text,'credit','0'),jsonb_build_object('account_id',config.receivable_account,'debit','0','credit',new.amount::text));
  result=public.billing_ledger_commit(new.business_id,new.demo,new.id,jsonb_build_object('source','payment.receipt','paymentId',new.id,'snapshot',new.snapshot),jsonb_build_object('date',new.transaction_date,'description','Payment receipt '||new.number,'kind','manual','entries',entries));
 else
  select * into original from public.billing_source_postings where business_id=new.business_id and demo=new.demo and source_id=new.reverses_id and kind='payment.receipt';
  if original.batch_id is null then raise exception 'Legacy payment needs reviewed opening reconciliation before an automatic reversal';end if;
  result=public.billing_ledger_reverse(new.business_id,new.demo,new.id,original.batch_id,new.transaction_date,new.snapshot->>'reason');
 end if;
 insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(new.id,new.business_id,new.demo,new.id,'payment.'||new.kind,(result->'batch'->>'id')::uuid,new.snapshot);
 return new;
end$$;
create trigger billing_post_payment_source after insert on public.billing_payment_events for each row execute function public.billing_post_payment_source();

create function public.billing_document_readiness(business uuid,data_mode boolean,document_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.billing_records;issued public.billing_issued_documents;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Document unavailable';end if;
 select * into source from public.billing_records r where r.id=billing_document_readiness.document_id and r.business_id=business and r.demo=data_mode and r.collection='documents';
 if source.id is null then raise exception 'Document unavailable in this business and data mode';end if;
 select * into issued from public.billing_issued_documents d where d.document_id=source.id;
 return jsonb_build_object('apiVersion',1,'canWrite',public.billing_can_access(business,true),'managed',issued.document_id is not null,'origin',issued.origin,'autoConfigured',exists(select 1 from public.billing_auto_posting_configs where business_id=business and demo=data_mode),'posted',exists(select 1 from public.billing_source_postings where source_id=source.id and kind='document.issue'),'snapshot',issued.snapshot);
end$$;
revoke all on function public.billing_document_projection(uuid),public.billing_managed_document_guard(),public.billing_post_document_source(public.billing_issued_documents),public.billing_source_reversal_guard(),public.billing_post_payment_source() from public,anon,authenticated;
revoke all on function public.billing_auto_posting_setup(uuid,boolean,date,jsonb),public.billing_document_command(uuid,boolean,uuid,integer,uuid,text,jsonb),public.billing_document_readiness(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.billing_auto_posting_setup(uuid,boolean,date,jsonb),public.billing_document_command(uuid,boolean,uuid,integer,uuid,text,jsonb),public.billing_document_readiness(uuid,boolean,uuid) to authenticated;
notify pgrst,'reload schema';

create or replace function public.billing_create_adjustment(source_id uuid,source_version integer,document_data jsonb)
returns public.billing_records language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records; number text;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true)
   or source.version is distinct from source_version or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
   or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'Invoice unavailable or changed'; end if;
 if not coalesce(document_data->>'type' in ('credit-note','debit-note'),false)
   or document_data->>'originalDocumentId' is distinct from source.id::text or document_data->>'status' is distinct from 'draft'
 then raise exception 'Invalid adjustment'; end if;
 number=(case when document_data->>'type'='credit-note' then 'CN-' else 'DN-' end)||public.billing_next_document_number(source.business_id);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number),source.demo,auth.uid()) returning * into result;
 return result;
end $$;

create or replace function public.billing_generate_document(source_id uuid,source_version integer,document_data jsonb,next_date date default null)
returns public.billing_records language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or not public.billing_can_access(source.business_id,true) or source.archived then raise exception 'Record unavailable'; end if;
 if source.version is distinct from source_version then raise exception 'Record changed'; end if;
 if document_data->>'sourceRecord' is distinct from source.id::text or document_data->>'status' is distinct from 'draft' then raise exception 'Invalid generated document'; end if;
 if not coalesce(((source.collection='leads' and document_data->>'type'='quotation')
   or (source.collection='documents' and source.data->>'type'='quotation' and document_data->>'type'='invoice')
   or (source.collection='subscriptions' and source.data->>'status'='Active' and document_data->>'type'='invoice' and next_date>(source.data->>'nextDate')::date)),false)
 then raise exception 'Invalid workflow'; end if;
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data,source.demo,auth.uid()) returning * into result;
 if source.collection='subscriptions' then
  update public.billing_records set data=data||jsonb_build_object('nextDate',next_date,'lastDocumentId',result.id) where id=source.id;
 elsif source.collection='leads' then
  update public.billing_records set data=data||jsonb_build_object('status','Proposal','lastDocumentId',result.id) where id=source.id;

 end if;
 return result;
end
$$;

create or replace function public.billing_record_payment(business uuid,invoice_id uuid,expected_version integer,command_id uuid,payment_data jsonb,data_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records; cmd public.billing_payment_commands; result public.billing_records;
 amount numeric; payment_date date; payload jsonb; request jsonb; sequence bigint; receipt_number text; event_id uuid=gen_random_uuid();
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot record payments for this business'; end if;
 if command_id is null or invoice_id is null or data_mode is null or expected_version is null or expected_version<1
  or jsonb_typeof(payment_data) is distinct from 'object' then raise exception 'Invalid payment command'; end if;
 if (payment_data-array['amount','date','method','reference','notes','currency'])<>'{}'::jsonb then raise exception 'Unexpected payment fields'; end if;
 amount=public.billing_payment_amount(payment_data->'amount');payment_date=public.billing_payment_date(payment_data->'date');
 if jsonb_typeof(payment_data->'method') is distinct from 'string' or length(btrim(payment_data->>'method')) not between 1 and 100 then raise exception 'Enter a payment method (up to 100 characters)'; end if;
 if payment_data?'reference' and (jsonb_typeof(payment_data->'reference')<>'string' or length(payment_data->>'reference')>500) then raise exception 'Payment reference must be text up to 500 characters'; end if;
 if payment_data?'notes' and (jsonb_typeof(payment_data->'notes')<>'string' or length(payment_data->>'notes')>5000) then raise exception 'Payment notes must be text up to 5000 characters'; end if;
 request=jsonb_build_object('action','record','invoice',invoice_id,'version',expected_version,'data',payment_data);
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 -- Resolve a committed replay before checking a now-stale invoice version.
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 select * into source from public.billing_records where id=invoice_id and business_id=business and demo=data_mode and collection='documents' for update;
 perform public.billing_ledger_writer_lock(business,false);
 -- Preserve invoice -> business FK lock order used by document numbering.
 insert into public.billing_payment_commands(business_id,demo,command_id,actor_id,request)
 values(business,data_mode,command_id,auth.uid(),request) on conflict do nothing;
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id for update;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 -- Resolve a committed replay before checking a now-stale invoice version.
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 if source.id is null or source.business_id<>business or source.demo<>data_mode or source.archived or source.collection<>'documents'
  or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
  or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'Choose an issued invoice in this business and data mode'; end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='The invoice changed. Reload before recording payment'; end if;
 if source.data->>'currency' is null or source.data->>'currency'!~'^[A-Z]{3}$'
  or (payment_data?'currency' and payment_data->>'currency' is distinct from source.data->>'currency') then raise exception 'Payment currency differs from its invoice'; end if;
 -- Freeze validated snapshot totals and dates; never trust the caller for parties or invoice identity.
 perform public.billing_document_totals(source.data);perform public.billing_payment_date(source.data->'date');
 if coalesce(source.data->>'dueDate','')<>'' then
  if public.billing_payment_date(source.data->'dueDate')<public.billing_payment_date(source.data->'date') then raise exception 'The invoice due date needs review before recording payment'; end if;
 end if;
 if jsonb_typeof(source.data->'number') is distinct from 'string' or length(btrim(source.data->>'number')) not between 1 and 256 then raise exception 'The invoice number needs review before recording payment'; end if;
 if jsonb_typeof(source.data->'seller'->'name') is distinct from 'string' or length(btrim(source.data->'seller'->>'name')) not between 1 and 1024
  or jsonb_typeof(source.data->'buyer'->'name') is distinct from 'string' or length(btrim(source.data->'buyer'->>'name')) not between 1 and 1024
 then raise exception 'The invoice parties need review before recording payment'; end if;
 loop
  insert into public.billing_payment_sequences(business_id,demo,next_number) values(business,data_mode,2)
   on conflict(business_id,demo) do update set next_number=billing_payment_sequences.next_number+1 returning next_number-1 into sequence;
  if sequence>999999999 then raise exception 'Receipt sequence exhausted'; end if;
  receipt_number=(case when data_mode then 'DEMO-RCT-' else 'RCT-' end)||lpad(sequence::text,greatest(6,length(sequence::text)),'0');
  exit when not exists(select 1 from public.billing_records where business_id=business and demo=data_mode and collection='payments' and data->>'number'=receipt_number);
 end loop;
 payload=jsonb_build_object('kind','receipt','number',receipt_number,'documentId',source.id,'invoiceNumber',source.data->>'number',
  'invoiceDate',source.data->>'date','invoiceType',source.data->>'type','currency',source.data->>'currency','date',payment_date::text,
  'amount',to_char(amount,'FM99999999990.00'),'method',btrim(payment_data->>'method'),'direction','incoming',
  'reference',coalesce(payment_data->>'reference',''),'notes',coalesce(payment_data->>'notes',''),
  'seller',source.data->'seller','buyer',source.data->'buyer','clientId',coalesce(source.data->>'clientId',''));
 insert into public.billing_payment_events(id,business_id,demo,document_id,kind,number,transaction_date,currency,amount,actor_id,snapshot)
 values(event_id,business,data_mode,source.id,'receipt',receipt_number,payment_date,source.data->>'currency',amount,auth.uid(),payload);
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(event_id,business,'payments',payload,data_mode,auth.uid()) returning * into result;
 insert into public.billing_payment_outbox(event_id,business_id,topic,payload) values(event_id,business,'payment.recorded',jsonb_build_object('paymentId',event_id,'documentId',source.id,'demo',data_mode));
 update public.billing_payment_commands c set result_id=result.id where c.business_id=business and c.demo=data_mode and c.command_id=billing_record_payment.command_id;
 return jsonb_build_object('record',to_jsonb(result),'replayed',false);
end $$;

create or replace function public.billing_reverse_payment(business uuid,payment_id uuid,command_id uuid,reversal_data jsonb,data_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.billing_records; source public.billing_records; cmd public.billing_payment_commands; result public.billing_records;
 amount numeric; reversal_date date; request jsonb; payload jsonb; event_id uuid=gen_random_uuid(); reversal_number text;
begin
 if auth.uid() is null or not coalesce(public.billing_can_access(business,true),false) then raise exception using errcode='42501',message='You cannot reverse payments for this business'; end if;
 if command_id is null or payment_id is null or data_mode is null or jsonb_typeof(reversal_data) is distinct from 'object' then raise exception 'Invalid reversal command'; end if;
 if (reversal_data-array['date','reason'])<>'{}'::jsonb then raise exception 'Unexpected reversal fields'; end if;
 reversal_date=public.billing_payment_date(reversal_data->'date');
 if jsonb_typeof(reversal_data->'reason') is distinct from 'string' or length(btrim(reversal_data->>'reason')) not between 1 and 1000 then raise exception 'Enter a reversal reason (up to 1000 characters)'; end if;
 request=jsonb_build_object('action','reverse','payment',payment_id,'data',reversal_data);
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 select * into original from public.billing_records where id=payment_id and business_id=business and demo=data_mode and collection='payments';
 if original.id is null or original.collection<>'payments' or original.business_id<>business or original.demo<>data_mode or original.archived
  or coalesce(original.data->>'kind','receipt')<>'receipt' or coalesce(original.data->>'direction','incoming')<>'incoming'
 then raise exception 'Payment unavailable in this business and data mode'; end if;
 -- Original rows (including retained legacy rows) are now protected by the projection guard.
 select * into source from public.billing_records where id=(original.data->>'documentId')::uuid and business_id=business and demo=data_mode and collection='documents' for update;
 perform public.billing_ledger_writer_lock(business,false);
 -- Preserve invoice -> business FK lock order used by document numbering.
 insert into public.billing_payment_commands(business_id,demo,command_id,actor_id,request) values(business,data_mode,command_id,auth.uid(),request) on conflict do nothing;
 select * into cmd from public.billing_payment_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id for update;
 if cmd.actor_id<>auth.uid() or cmd.request<>request then raise exception using errcode='40001',message='This retry key was used for a different payment'; end if;
 if cmd.result_id is not null then select * into result from public.billing_records where id=cmd.result_id;return jsonb_build_object('record',to_jsonb(result),'replayed',true);end if;
 if source.id is null or source.business_id<>business or source.demo<>data_mode or source.archived or source.collection<>'documents'
  or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
  or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'The payment invoice needs review before reversal'; end if;
 if original.data?'currency' and original.data->>'currency' is distinct from source.data->>'currency' then raise exception 'The payment currency needs review before reversal'; end if;
 amount=public.billing_payment_amount(original.data->'amount');
 if reversal_date<public.billing_payment_date(original.data->'date') then raise exception 'A reversal cannot predate its payment'; end if;
 if exists(select 1 from public.billing_payment_events where reverses_id=original.id) then raise exception using errcode='40001',message='This payment is already reversed'; end if;
 reversal_number='REV-'||event_id::text;
 payload=jsonb_build_object('kind','reversal','number',reversal_number,'documentId',source.id,'reversalOf',original.id,
  'invoiceNumber',source.data->>'number','invoiceDate',source.data->>'date','invoiceType',source.data->>'type',
  'currency',source.data->>'currency','date',reversal_date::text,'amount',to_char(amount,'FM99999999990.00'),
  'direction','incoming','method',original.data->>'method','reason',btrim(reversal_data->>'reason'),
  'seller',coalesce(original.data->'seller',source.data->'seller'),'buyer',coalesce(original.data->'buyer',source.data->'buyer'),
  'clientId',coalesce(source.data->>'clientId',''));
 insert into public.billing_payment_events(id,business_id,demo,document_id,reverses_id,kind,number,transaction_date,currency,amount,actor_id,snapshot)
 values(event_id,business,data_mode,source.id,original.id,'reversal',reversal_number,reversal_date,source.data->>'currency',amount,auth.uid(),payload);
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(event_id,business,'payments',payload,data_mode,auth.uid()) returning * into result;
 insert into public.billing_payment_outbox(event_id,business_id,topic,payload) values(event_id,business,'payment.reversed',jsonb_build_object('paymentId',original.id,'reversalId',event_id,'documentId',source.id,'demo',data_mode));
 update public.billing_payment_commands c set result_id=result.id where c.business_id=business and c.demo=data_mode and c.command_id=billing_reverse_payment.command_id;
 return jsonb_build_object('record',to_jsonb(result),'replayed',false);
end $$;

notify pgrst,'reload schema';
