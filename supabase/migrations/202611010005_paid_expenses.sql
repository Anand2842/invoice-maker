-- Explicit reviewed paid-expense posting. Mutable legacy expenses never post implicitly.
create table public.billing_posted_expenses(
 expense_id uuid primary key,event_id uuid not null unique,business_id uuid not null,demo boolean not null,date date not null,currency text not null,
 gross_amount numeric(18,2) not null check(gross_amount>=0 and gross_amount<=10000000000),expense_amount numeric(18,2) not null check(expense_amount>=0),input_tax numeric(18,2) not null check(input_tax>=0),
 expense_account uuid not null,cash_account uuid not null,tax_account uuid,batch_id uuid unique,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(expense_id,business_id,demo),
 check(expense_amount+input_tax=gross_amount),check((gross_amount=0)=(batch_id is null)),
 foreign key(expense_id,business_id,demo) references public.billing_records(id,business_id,demo),
 foreign key(expense_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(cash_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(tax_account,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create table public.billing_expense_reversals(
 id uuid primary key,expense_id uuid not null unique,business_id uuid not null,demo boolean not null,date date not null,reason text not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(expense_id,business_id,demo) references public.billing_posted_expenses(expense_id,business_id,demo)
);
create table public.billing_expense_commands(
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,
 actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,primary key(business_id,demo,command_id)
);
create table public.billing_expense_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,
 expense_id uuid not null references public.billing_records(id),topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_expense_commands(business_id,demo,command_id)
);
alter table public.billing_posted_expenses enable row level security;
alter table public.billing_expense_reversals enable row level security;
alter table public.billing_expense_commands enable row level security;
alter table public.billing_expense_outbox enable row level security;
revoke all on public.billing_posted_expenses,public.billing_expense_reversals,public.billing_expense_commands,public.billing_expense_outbox from public,anon,authenticated;
grant select on public.billing_posted_expenses,public.billing_expense_reversals to authenticated;
create policy posted_expense_read on public.billing_posted_expenses for select to authenticated using(public.billing_can_access(business_id));
create policy expense_reversal_read on public.billing_expense_reversals for select to authenticated using(public.billing_can_access(business_id));
create trigger posted_expense_immutable before update or delete on public.billing_posted_expenses for each row execute function public.billing_ledger_immutable();
create trigger expense_reversal_immutable before update or delete on public.billing_expense_reversals for each row execute function public.billing_ledger_immutable();
create trigger expense_command_immutable before update or delete on public.billing_expense_commands for each row execute function public.billing_ledger_immutable();
create trigger expense_outbox_immutable before update or delete on public.billing_expense_outbox for each row execute function public.billing_ledger_immutable();
create index posted_expense_scope on public.billing_posted_expenses(business_id,demo,date,expense_id);
alter table public.billing_source_postings drop constraint billing_source_postings_kind_check;
alter table public.billing_source_postings add constraint billing_source_postings_kind_check check(kind in ('document.issue','document.cancel','payment.receipt','payment.reversal','expense.post','expense.reversal'));
alter table public.billing_source_postings drop constraint billing_source_postings_check;
alter table public.billing_source_postings add constraint billing_source_postings_check check(batch_id is not null or kind in ('document.issue','document.cancel','expense.post','expense.reversal'));

create function public.billing_expense_projection(expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare posted public.billing_posted_expenses;reversed public.billing_expense_reversals;result jsonb;
begin
 select * into posted from public.billing_posted_expenses where expense_id=expense;if posted.expense_id is null then return null;end if;
 result=posted.snapshot;select * into reversed from public.billing_expense_reversals where expense_id=expense;
 if reversed.id is not null then result=result||jsonb_build_object('accounting',(result->'accounting')||jsonb_build_object('reversedOn',reversed.date,'reversalId',reversed.id,'reversalJournalId',(select batch_id from public.billing_source_postings where event_id=reversed.id),'reason',reversed.reason));end if;
 return result;
end$$;
create function public.billing_posted_expense_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare expected jsonb;
begin
 if new.collection<>'expenses' then return new;end if;
 expected=public.billing_expense_projection(new.id);
 if expected is not null then
  if new.archived or new.data is distinct from expected then raise exception 'Posted expenses cannot be edited or archived; use the dated expense reversal command';end if;
 elsif new.data?'accounting' then raise exception 'Expense accounting metadata can only be written by its command';end if;
 return new;
end$$;
create trigger billing_91_posted_expense before insert or update on public.billing_records for each row execute function public.billing_posted_expense_guard();

create function public.billing_expense_command(business uuid,data_mode boolean,expense_id uuid,expected_version integer,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.billing_records;ledger public.billing_ledger_configs;auto_config public.billing_auto_posting_configs;posted public.billing_posted_expenses;prior public.billing_expense_commands;
 request jsonb;result jsonb;journal jsonb;entries jsonb='[]';projection jsonb;meta jsonb;event_id uuid;day date;reason text;treatment text;key_name text;
 gross numeric(18,2);tax numeric(18,2)=0;reversed_tax numeric(18,2)=0;net_tax numeric(18,2)=0;expense_amount numeric(18,2);expense_account uuid;cash_account uuid;tax_account uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot post or reverse paid expenses';end if;
 if data_mode is null or expense_id is null or command_id is null or expected_version is null or expected_version<1 or action is null or action not in ('post','reverse') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid expense command';end if;
 request=jsonb_build_object('expenseId',expense_id,'version',expected_version,'action',action,'data',command_data);
 select * into prior from public.billing_expense_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_expense_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different expense command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 select * into source from public.billing_records r where r.id=billing_expense_command.expense_id and r.business_id=business and r.demo=data_mode and r.collection='expenses' for update;
 if source.id is null or source.archived then raise exception 'Expense unavailable in this business and data mode';end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if ledger.business_id is null then raise exception 'Configure the ledger before posting paid expenses';end if;
 select * into prior from public.billing_expense_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_expense_command.command_id;
 if prior.command_id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different expense command';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if source.version<>expected_version then raise exception using errcode='40001',message='Expense changed; reload before posting or reversing';end if;
 select * into posted from public.billing_posted_expenses p where p.expense_id=source.id;
 if action='post' then
  if posted.expense_id is not null then raise exception 'This expense already has an immutable posting';end if;
  if command_data-array['currency','expenseAccount','cashAccount','taxAccount','taxTreatment','paidConfirmed','taxReviewed']<>'{}'::jsonb or command_data->'paidConfirmed' is distinct from 'true'::jsonb or command_data->'taxReviewed' is distinct from 'true'::jsonb then raise exception 'Confirm this expense was paid outside Folio and review its tax treatment';end if;
  if command_data->>'currency' is distinct from ledger.currency or (source.data?'currency' and source.data->>'currency' is distinct from ledger.currency) then raise exception 'Paid expenses must use the configured ledger base currency; review FX separately';end if;
  day=public.billing_payment_date(source.data->'date');gross=public.billing_ledger_amount(source.data->'amount');
  select * into auto_config from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
  if auto_config.business_id is not null and day<auto_config.cutover_date then raise exception 'Expense predates source cutover; review opening treatment instead of replaying history';end if;
  if source.data->>'reverseCharge'='Yes' then raise exception 'Reverse-charge expenses need a complete reviewed tax-payable treatment; do not post them as ordinary paid expenses';end if;
  if jsonb_typeof(source.data->'name') is distinct from 'string' or length(btrim(source.data->>'name')) not between 1 and 1000 then raise exception 'Review the expense description';end if;
  treatment=command_data->>'taxTreatment';if treatment is null or treatment not in ('expense-all','reviewed-itc') then raise exception 'Choose whether tax is expensed or explicitly reviewed input credit';end if;
  foreach key_name in array array['inputCgst','inputSgst','inputIgst','inputCess'] loop tax=tax+public.billing_ledger_amount(coalesce(source.data->key_name,'"0"'::jsonb));end loop;
  foreach key_name in array array['reversalCgst','reversalSgst','reversalIgst','reversalCess'] loop reversed_tax=reversed_tax+public.billing_ledger_amount(coalesce(source.data->key_name,'"0"'::jsonb));end loop;
  if reversed_tax>tax or tax>gross then raise exception 'Expense input tax/reversals must reconcile within the gross paid amount';end if;
  if public.billing_ledger_amount(coalesce(source.data->'inputIgst','"0"'::jsonb))>0 and (public.billing_ledger_amount(coalesce(source.data->'inputCgst','"0"'::jsonb))>0 or public.billing_ledger_amount(coalesce(source.data->'inputSgst','"0"'::jsonb))>0) then raise exception 'An expense cannot mix IGST with CGST/SGST';end if;
  if treatment='reviewed-itc' then
   if source.data->>'itcStatus' is distinct from 'Eligible' or source.data->>'reconciled2B' is distinct from 'Yes' or coalesce(source.data->>'vendorGstin','')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'Input credit requires explicit eligibility, GSTR-2B review and a recorded supplier GSTIN; no provider verification is implied';end if;
   net_tax=tax-reversed_tax;
  end if;
  if coalesce(command_data->>'expenseAccount','')!~'^[a-fA-F0-9-]{36}$' or coalesce(command_data->>'cashAccount','')!~'^[a-fA-F0-9-]{36}$' then raise exception 'Choose the expense and cash posting accounts';end if;
  select id into expense_account from public.billing_ledger_accounts a where a.id=(command_data->>'expenseAccount')::uuid and a.business_id=business and a.demo=data_mode and a.type='expense';
  select id into cash_account from public.billing_ledger_accounts a where a.id=(command_data->>'cashAccount')::uuid and a.business_id=business and a.demo=data_mode and a.type='asset' and a.code not in ('1100','1200','1300','1400','1450','1500');
  if expense_account is null or cash_account is null then raise exception 'Choose an expense account and a cash asset account in this business and data mode';end if;
  if net_tax>0 then
   if coalesce(command_data->>'taxAccount','')!~'^[a-fA-F0-9-]{36}$' then raise exception 'Choose the reviewed input-tax account';end if;
   select id into tax_account from public.billing_ledger_accounts a where a.id=(command_data->>'taxAccount')::uuid and a.business_id=business and a.demo=data_mode and a.type='asset' and a.code='1300';
   if tax_account is null then raise exception 'Reviewed input credit requires tax receivable (1300)';end if;
  end if;
  expense_amount=gross-net_tax;event_id=gen_random_uuid();
  if expense_amount>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',expense_account,'debit',expense_amount::text,'credit','0'));end if;
  if net_tax>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',tax_account,'debit',net_tax::text,'credit','0'));end if;
  if gross>0 then
   entries=entries||jsonb_build_array(jsonb_build_object('account_id',cash_account,'debit','0','credit',gross::text));
   journal=(public.billing_ledger_commit(business,data_mode,event_id,jsonb_build_object('source','expense.post','expenseId',source.id,'sourceVersion',source.version,'data',source.data,'review',command_data),jsonb_build_object('date',day,'kind','manual','description','Paid expense '||(source.data->>'name'),'entries',entries)))->'batch';
  else
   if day<ledger.start_date or day<=coalesce(ledger.closed_through,day-1) or day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Expense date is outside the open ledger period';end if;
  end if;
  meta=jsonb_build_object('version',1,'kind','paid-expense','eventId',event_id,'journalId',journal->>'id','postedOn',day,'recordedAt',now(),'currencySource',case when source.data?'currency' then 'recorded' else 'explicit-posting' end,'grossAmount',gross::text,'expenseAmount',expense_amount::text,'inputTax',net_tax::text,'expenseAccount',expense_account,'cashAccount',cash_account,'taxAccount',tax_account,'taxTreatment',treatment,'paidConfirmed',true,'taxReviewed',true);
  projection=source.data||jsonb_build_object('currency',ledger.currency,'accounting',meta);
  insert into public.billing_posted_expenses(expense_id,event_id,business_id,demo,date,currency,gross_amount,expense_amount,input_tax,expense_account,cash_account,tax_account,batch_id,snapshot,actor_id)
  values(source.id,event_id,business,data_mode,day,ledger.currency,gross,expense_amount,net_tax,expense_account,cash_account,tax_account,(journal->>'id')::uuid,projection,auth.uid()) returning * into posted;
  insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(event_id,business,data_mode,source.id,'expense.post',posted.batch_id,projection);
 else
  if posted.expense_id is null then raise exception 'Choose a posted expense for dated reversal';end if;
  if command_data-array['date','reason']<>'{}'::jsonb then raise exception 'Expense reversal needs only a date and reason';end if;
  day=public.billing_payment_date(command_data->'date');reason=btrim(command_data->>'reason');
  if day<posted.date or day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) or jsonb_typeof(command_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Choose a reversal date on or after the expense date, on or before today, and a reason';end if;
  if exists(select 1 from public.billing_expense_reversals r where r.expense_id=source.id) then raise exception 'This paid expense is already reversed';end if;
  event_id=gen_random_uuid();insert into public.billing_expense_reversals(id,expense_id,business_id,demo,date,reason,actor_id) values(event_id,source.id,business,data_mode,day,reason,auth.uid());
  if posted.batch_id is not null then journal=(public.billing_ledger_reverse(business,data_mode,event_id,posted.batch_id,day,reason))->'batch';
  elsif day<ledger.start_date or day<=coalesce(ledger.closed_through,day-1) then raise exception 'Expense reversal date is outside the open ledger period';end if;
  insert into public.billing_source_postings(event_id,business_id,demo,source_id,kind,batch_id,snapshot) values(event_id,business,data_mode,source.id,'expense.reversal',(journal->>'id')::uuid,jsonb_build_object('date',day,'reason',reason));
 end if;
 update public.billing_records set data=public.billing_expense_projection(source.id) where id=source.id returning * into source;
 result=jsonb_build_object('record',to_jsonb(source),'journal',journal,'replayed',false);
 insert into public.billing_expense_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'expense.'||action,jsonb_build_object('expenseId',source.id,'eventId',event_id));
 insert into public.billing_expense_outbox(business_id,demo,command_id,expense_id,topic,payload) values(business,data_mode,command_id,source.id,'expense.'||action,jsonb_build_object('expenseId',source.id,'version',source.version,'eventId',event_id));
 return result;
end$$;

create or replace function public.billing_source_reversal_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare original public.billing_source_postings;
begin
 if new.reverses_id is null then return new;end if;
 select * into original from public.billing_source_postings where batch_id=new.reverses_id;
 if original.kind='document.issue' and not exists(select 1 from public.billing_document_cancellations c where c.id=new.command_id and c.document_id=original.source_id and c.date=new.date) then raise exception 'Cancel the source document through its lifecycle command to reverse this journal';end if;
 if original.kind='payment.receipt' and not exists(select 1 from public.billing_payment_events p where p.id=new.command_id and p.kind='reversal' and p.reverses_id=original.source_id and p.transaction_date=new.date) then raise exception 'Reverse the source payment through its payment command to reverse this journal';end if;
 if original.kind='expense.post' and not exists(select 1 from public.billing_expense_reversals r where r.id=new.command_id and r.expense_id=original.source_id and r.date=new.date) then raise exception 'Reverse the paid expense through its expense command to reverse this journal';end if;
 return new;
end$$;

create function public.billing_expense_read(business uuid,data_mode boolean,expense_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.billing_records;ledger public.billing_ledger_configs;posted public.billing_posted_expenses;accounts jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Expense unavailable in this business';end if;
 if data_mode is null then raise exception 'Choose the expense data mode';end if;
 select * into source from public.billing_records r where r.id=billing_expense_read.expense_id and r.business_id=business and r.demo=data_mode and r.collection='expenses';
 if source.id is null then raise exception using errcode='P0002',message='Expense unavailable in this business and data mode';end if;
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select * into posted from public.billing_posted_expenses p where p.expense_id=source.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode and type in ('expense','asset');
 return jsonb_build_object('record',to_jsonb(source),'configured',ledger.business_id is not null,'currency',ledger.currency,'ledgerStart',ledger.start_date,'closedThrough',ledger.closed_through,'canWrite',public.billing_can_access(business,true),'posted',posted.expense_id is not null,'accounts',accounts);
end$$;
revoke all on function public.billing_expense_projection(uuid),public.billing_posted_expense_guard() from public,anon,authenticated;
revoke all on function public.billing_expense_command(uuid,boolean,uuid,integer,uuid,text,jsonb),public.billing_expense_read(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.billing_expense_command(uuid,boolean,uuid,integer,uuid,text,jsonb),public.billing_expense_read(uuid,boolean,uuid) to authenticated;
notify pgrst,'reload schema';

create or replace function public.billing_source_reconciliation(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_auto_posting_configs;ledger public.billing_ledger_configs;accounts jsonb;
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
 select coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.receivable_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=ap_account),0),coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.cash_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=config.tax_account),0) into ar_actual,ap_actual,cash_actual,tax_actual
 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select count(*) filter(where i.document_id is null),count(*) filter(where i.document_id is not null and not exists(select 1 from public.billing_source_postings p where p.source_id=r.id and p.kind='document.issue')),count(*) filter(where r.data->>'currency'<>config.currency)
 into legacy,unposted,foreign_docs from public.billing_records r left join public.billing_issued_documents i on i.document_id=r.id
 where r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note') and (r.data->>'status' in ('sent','paid') or r.data->>'status'='cancelled' and i.document_id is not null) and (r.data->>'date')::date<=as_of;
 return jsonb_build_object('businessId',business,'demo',data_mode,'configured',true,'ledgerConfigured',true,'canManage',public.billing_is_owner(business),'config',to_jsonb(config),'currency',config.currency,'asOf',as_of,'accounts',accounts,'controls',jsonb_build_array(
 jsonb_build_object('code','AR','name','Accounts receivable','expected',ar_expected::text,'ledger',ar_actual::text,'difference',(ar_actual-ar_expected)::text),
 jsonb_build_object('code','AP','name','Accounts payable','expected',ap_expected::text,'ledger',ap_actual::text,'difference',(ap_actual-ap_expected)::text),
 jsonb_build_object('code','CASH','name','Cash / bank','expected',cash_expected::text,'ledger',cash_actual::text,'difference',(cash_actual-cash_expected)::text),
 jsonb_build_object('code','TAX','name','Output tax payable','expected',tax_expected::text,'ledger',tax_actual::text,'difference',(tax_actual-tax_expected)::text),jsonb_build_object('code','ITC','name','Reviewed input tax receivable','expected',itc_expected::text,'ledger',itc_actual::text,'difference',(itc_actual-itc_expected)::text)),
 'unpostedExpenses',unposted_expenses,'unpostedManagedDocuments',unposted,'legacyDocumentsNeedingOpeningReview',legacy,'foreignDocumentsNeedingFxReview',foreign_docs,'managedDocumentsThroughDate',source_rows,'arithmeticAgrees',ar_actual=ar_expected and ap_actual=ap_expected and cash_actual=cash_expected and tax_actual=tax_expected and itc_actual=itc_expected and unposted_expenses=0 and unposted=0 and legacy=0 and foreign_docs=0,'reviewStatus','unreviewed',
 'limitations',jsonb_build_array('Mechanical control-account comparison only; personal review decisions are recorded separately and this result does not assert sign-off.','Expected AR/output tax uses frozen managed documents and dated receipt/cancellation events after cutover. No paid flag becomes cash.','Expected AP uses explicit Folio vendor bills/payments/reversals. Legacy expenses, advances, credits and manual journals are not invented.','Expected cash also includes explicit paid expense snapshots/reversals; reviewed input tax includes expense and vendor bill snapshots. Unposted expenses require opening/source review.','Manual/opening control-account entries can cause differences and need reviewed mappings. FX, inventory and additional expense sources remain separate work.'));
end$$;
notify pgrst,'reload schema';
