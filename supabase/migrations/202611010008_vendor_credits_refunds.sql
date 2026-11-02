-- Vendor credits are non-cash assets until explicitly allocated or refunded.
-- Refunds record explicitly confirmed external events; no provider money moves.
create table public.billing_vendor_credits(
 id uuid primary key,business_id uuid not null,demo boolean not null,bill_id uuid not null,vendor_id uuid not null,
 date date not null,number text not null,currency text not null,subtotal numeric(18,2) not null check(subtotal>=0),tax_amount numeric(18,2) not null check(tax_amount>=0),
 amount numeric(18,2) not null check(amount>0 and amount<=10000000000),account_id uuid not null,batch_id uuid not null unique,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo),check(amount=subtotal+tax_amount),
 foreign key(bill_id,business_id,demo) references public.billing_vendor_bills(id,business_id,demo),
 foreign key(vendor_id,business_id,demo) references public.billing_records(id,business_id,demo),
 foreign key(account_id,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create index vendor_credit_scope on public.billing_vendor_credits(business_id,demo,vendor_id,date,id);
create index vendor_credit_bill on public.billing_vendor_credits(bill_id,date,id);
create table public.billing_vendor_credit_reversals(
 id uuid primary key,credit_id uuid not null unique,business_id uuid not null,demo boolean not null,date date not null,reason text not null,batch_id uuid not null unique,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(credit_id,business_id,demo) references public.billing_vendor_credits(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create table public.billing_vendor_credit_allocations(
 id uuid primary key,business_id uuid not null,demo boolean not null,credit_id uuid not null,bill_id uuid not null,kind text not null check(kind in ('allocate','release')),releases_id uuid,
 date date not null,amount numeric(18,2) not null check(amount>0 and amount<=10000000000),batch_id uuid not null unique,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo),check((kind='release')=(releases_id is not null)),
 foreign key(credit_id,business_id,demo) references public.billing_vendor_credits(id,business_id,demo),
 foreign key(bill_id,business_id,demo) references public.billing_vendor_bills(id,business_id,demo),
 foreign key(releases_id,business_id,demo) references public.billing_vendor_credit_allocations(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create index vendor_credit_allocation_bill on public.billing_vendor_credit_allocations(bill_id,date,id);
create index vendor_credit_allocation_credit on public.billing_vendor_credit_allocations(credit_id,date,id);
create table public.billing_refund_events(
 id uuid primary key,business_id uuid not null,demo boolean not null,kind text not null check(kind in ('refund','reversal')),reverses_id uuid unique,
 source_kind text not null check(source_kind in ('cash','vendor-credit')),source_id uuid not null,party_id uuid not null,direction text not null check(direction in ('incoming','outgoing')),
 date date not null,currency text not null,amount numeric(18,2) not null check(amount>0 and amount<=10000000000),number text not null,batch_id uuid not null unique,snapshot jsonb not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo),unique(business_id,demo,number),check((kind='reversal')=(reverses_id is not null)),
 foreign key(reverses_id,business_id,demo) references public.billing_refund_events(id,business_id,demo),
 foreign key(party_id,business_id,demo) references public.billing_records(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo)
);
create index refund_source on public.billing_refund_events(business_id,demo,source_kind,source_id,date,id);
create table public.billing_credit_refund_commands(
 business_id uuid not null,demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,
 primary key(business_id,demo,command_id),foreign key(business_id,demo) references public.billing_cash_configs(business_id,demo)
);
create table public.billing_credit_refund_outbox(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,command_id uuid not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(business_id,demo,command_id),foreign key(business_id,demo,command_id) references public.billing_credit_refund_commands(business_id,demo,command_id)
);
create table public.billing_credit_refund_authority(
 id uuid primary key,business_id uuid not null,demo boolean not null,source_kind text not null check(source_kind in ('vendor-credit','refund')),source_id uuid not null,date date not null
);
alter table public.billing_vendor_credits enable row level security;
alter table public.billing_vendor_credit_reversals enable row level security;
alter table public.billing_vendor_credit_allocations enable row level security;
alter table public.billing_refund_events enable row level security;
alter table public.billing_credit_refund_commands enable row level security;
alter table public.billing_credit_refund_outbox enable row level security;
alter table public.billing_credit_refund_authority enable row level security;
revoke all on public.billing_vendor_credits,public.billing_vendor_credit_reversals,public.billing_vendor_credit_allocations,public.billing_refund_events,public.billing_credit_refund_commands,public.billing_credit_refund_outbox,public.billing_credit_refund_authority from public,anon,authenticated;
grant select on public.billing_vendor_credits,public.billing_vendor_credit_reversals,public.billing_vendor_credit_allocations,public.billing_refund_events to authenticated;
create policy vendor_credit_read on public.billing_vendor_credits for select to authenticated using(public.billing_can_access(business_id));
create policy vendor_credit_reversal_read on public.billing_vendor_credit_reversals for select to authenticated using(public.billing_can_access(business_id));
create policy vendor_credit_allocation_read on public.billing_vendor_credit_allocations for select to authenticated using(public.billing_can_access(business_id));
create policy refund_event_read on public.billing_refund_events for select to authenticated using(public.billing_can_access(business_id));
create trigger vendor_credit_immutable before update or delete on public.billing_vendor_credits for each row execute function public.billing_ledger_immutable();
create trigger vendor_credit_reversal_immutable before update or delete on public.billing_vendor_credit_reversals for each row execute function public.billing_ledger_immutable();
create trigger vendor_credit_allocation_immutable before update or delete on public.billing_vendor_credit_allocations for each row execute function public.billing_ledger_immutable();
create trigger refund_event_immutable before update or delete on public.billing_refund_events for each row execute function public.billing_ledger_immutable();
create trigger credit_refund_command_immutable before update or delete on public.billing_credit_refund_commands for each row execute function public.billing_ledger_immutable();
create trigger credit_refund_outbox_immutable before update or delete on public.billing_credit_refund_outbox for each row execute function public.billing_ledger_immutable();
create trigger credit_refund_authority_immutable before update or delete on public.billing_credit_refund_authority for each row execute function public.billing_ledger_immutable();

create function public.billing_vendor_credit_movements(credit uuid) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select c.date,c.amount from public.billing_vendor_credits c where c.id=credit
 union all select r.date,-c.amount from public.billing_vendor_credit_reversals r join public.billing_vendor_credits c on c.id=r.credit_id where r.credit_id=credit
 union all select a.date,a.amount*case when a.kind='allocate' then -1 else 1 end from public.billing_vendor_credit_allocations a where a.credit_id=credit
 union all select f.date,f.amount*case when f.kind='refund' then -1 else 1 end from public.billing_refund_events f where f.source_kind='vendor-credit' and f.source_id=credit
$$;
create or replace function public.billing_cash_movements(cash uuid) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select c.date,case when c.kind='cash' then c.amount else -c.amount end from public.billing_cash_events c where c.id=cash or c.reverses_id=cash
 union all select a.date,case when a.kind='allocate' then -a.amount else a.amount end from public.billing_cash_allocations a where a.cash_id=cash
 union all select f.date,f.amount*case when f.kind='refund' then -1 else 1 end from public.billing_refund_events f where f.source_kind='cash' and f.source_id=cash
$$;
create function public.billing_validate_vendor_credit_history(credit uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from(select sum(sum(delta)) over(order by date) balance from public.billing_vendor_credit_movements(credit) group by date)x where balance<0) then raise exception 'Credit allocation/refund/reversal exceeds available vendor credit at an effective date; review complete dated history';end if;
end$$;
create function public.billing_validate_vendor_credit_cap(bill uuid) returns void language plpgsql security definer set search_path='' as $$
declare source public.billing_vendor_bills;
begin
 select * into source from public.billing_vendor_bills where id=bill;
 if exists(with movements as(select c.date,c.subtotal,c.tax_amount from public.billing_vendor_credits c where c.bill_id=bill union all select r.date,-c.subtotal,-c.tax_amount from public.billing_vendor_credits c join public.billing_vendor_credit_reversals r on r.credit_id=c.id where c.bill_id=bill),running as(select date,sum(sum(subtotal)) over(order by date) base,sum(sum(tax_amount)) over(order by date) tax from movements group by date) select 1 from running where base<0 or tax<0 or base>(source.data->>'subtotal')::numeric or tax>(source.data->>'taxAmount')::numeric) then raise exception 'Vendor credits exceed the source bill subtotal or input tax at an effective date';end if;
end$$;

create function public.billing_vendor_credit_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_cash_configs;prior public.billing_credit_refund_commands;credit public.billing_vendor_credits;source public.billing_vendor_bills;bill public.billing_vendor_bills;original public.billing_vendor_credit_allocations;
 request jsonb;result jsonb;entries jsonb;journal jsonb;item jsonb;rows jsonb='[]';snapshot jsonb;event_id uuid;requested_credit uuid;target_id uuid;day date;amount numeric(18,2);base numeric(18,2);tax numeric(18,2);released numeric;credit_account uuid;tax_account uuid;reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot issue or correct vendor credits';end if;
 if data_mode is null or command_id is null or action is null or action not in ('issue','allocate','release','reverse') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid vendor credit command';end if;
 request=jsonb_build_object('domain','vendor-credit','action',action,'data',command_data);
 select * into prior from public.billing_credit_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_vendor_credit_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different credit/refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 perform public.billing_ledger_writer_lock(business,false);perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;if config.business_id is null then raise exception 'Configure reviewed cash and advance controls first';end if;
 select * into prior from public.billing_credit_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_vendor_credit_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different credit/refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 day=public.billing_payment_date(command_data->'date');if day<config.cutover_date then raise exception 'Credit date predates cash/source cutover; review opening treatment';end if;
 if action='issue' then
  if command_data-array['billId','billVersion','number','date','currency','subtotal','taxAmount','taxReviewed','creditAccount','reason']<>'{}'::jsonb or command_data->'taxReviewed' is distinct from 'true'::jsonb or coalesce(command_data->>'billId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'billVersion','')!~'^[1-9][0-9]{0,8}$' or coalesce(command_data->>'creditAccount','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Review a versioned source bill, credit account and input-tax correction';end if;
  select * into source from public.billing_vendor_bills b where b.id=(command_data->>'billId')::uuid and b.business_id=business and b.demo=data_mode and b.status='issued';
  if source.id is null or exists(select 1 from public.billing_ledger_batches where reverses_id=source.issued_batch) then raise exception 'Choose an active issued source bill in this business and data mode';end if;
  if source.version<>(command_data->>'billVersion')::integer then raise exception using errcode='40001',message='Source bill changed; reload before issuing credit';end if;
  if command_data->>'currency' is distinct from config.currency or source.data->>'currency' is distinct from config.currency or day<(source.data->>'date')::date then raise exception 'Credit currency/date must match its source bill and ledger base';end if;
  if jsonb_typeof(command_data->'number') is distinct from 'string' or length(btrim(command_data->>'number')) not between 1 and 180 or jsonb_typeof(command_data->'reason') is distinct from 'string' or length(btrim(command_data->>'reason')) not between 1 and 1000 then raise exception 'Enter the supplier credit reference and reviewed correction reason';end if;
  select id into credit_account from public.billing_ledger_accounts where id=(command_data->>'creditAccount')::uuid and business_id=business and demo=data_mode and code='1450' and type='asset';
  select id into tax_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1300' and type='asset';
  if credit_account is null or tax_account is null or credit_account in (config.cash_account,config.receivable_account,config.vendor_advance_account,(source.data->>'accountId')::uuid) then raise exception 'Choose a separate vendor credit asset (1450), outside cash/AR/advances and the bill posting account';end if;
  if exists(select 1 from public.billing_vendor_credits c left join public.billing_vendor_credit_reversals r on r.credit_id=c.id where c.business_id=business and c.demo=data_mode and c.vendor_id=source.vendor_id and lower(c.number)=lower(btrim(command_data->>'number')) and (r.id is null or r.date>day)) then raise exception using errcode='23505',message='Supplier credit reference is already issued or its replacement predates correction';end if;
  base=public.billing_ledger_amount(command_data->'subtotal');tax=public.billing_ledger_amount(command_data->'taxAmount');amount=base+tax;if amount<=0 or amount>10000000000 then raise exception 'Credit total must be positive and within the supported range';end if;
  event_id=gen_random_uuid();entries=jsonb_build_array(jsonb_build_object('account_id',credit_account,'debit',amount::text,'credit','0'));
  if base>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',source.data->>'accountId','debit','0','credit',base::text));end if;
  if tax>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',tax_account,'debit','0','credit',tax::text));end if;
  journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description','Vendor credit '||btrim(command_data->>'number'),'entries',entries)))->'batch';
  snapshot=command_data||jsonb_build_object('sourceBill',source.data,'vendor',source.data->'vendor','vendorId',source.vendor_id,'business',(select jsonb_build_object('id',b.id,'name',b.name,'address',b.address,'email',b.email,'gstin',b.gstin) from public.billing_businesses b where b.id=business),'amount',amount::text,'fundsMovedByFolio',false,'taxVerification','user-reviewed-only');
  insert into public.billing_vendor_credits(id,business_id,demo,bill_id,vendor_id,date,number,currency,subtotal,tax_amount,amount,account_id,batch_id,snapshot,actor_id) values(event_id,business,data_mode,source.id,source.vendor_id,day,btrim(command_data->>'number'),config.currency,base,tax,amount,credit_account,(journal->>'id')::uuid,snapshot,auth.uid()) returning * into credit;
  perform public.billing_validate_vendor_credit_cap(source.id);result=jsonb_build_object('credit',to_jsonb(credit)||jsonb_build_object('amount',credit.amount::text,'subtotal',credit.subtotal::text,'tax_amount',credit.tax_amount::text),'journal',journal,'allocations','[]'::jsonb,'replayed',false);
 else
  if coalesce(command_data->>'creditId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an issued vendor credit';end if;requested_credit=(command_data->>'creditId')::uuid;
  select * into credit from public.billing_vendor_credits c where c.id=requested_credit and c.business_id=business and c.demo=data_mode;
  if credit.id is null then raise exception using errcode='P0002',message='Vendor credit unavailable in this business and data mode';end if;
  if day<credit.date then raise exception 'Credit correction/allocation cannot predate issuance';end if;
  if action='allocate' then
   if command_data-array['creditId','date','targets']<>'{}'::jsonb or jsonb_typeof(command_data->'targets') is distinct from 'array' or jsonb_array_length(command_data->'targets') not between 1 and 50 then raise exception 'Choose 1 to 50 distinct bill allocations';end if;
   if exists(select 1 from public.billing_vendor_credit_reversals where credit_id=credit.id) then raise exception 'Reversed credit cannot receive allocations';end if;
   for item in select value from jsonb_array_elements(command_data->'targets') loop
    if jsonb_typeof(item) is distinct from 'object' or item-array['id','version','amount']<>'{}'::jsonb or coalesce(item->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(item->>'version','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Each credit allocation needs a versioned bill and exact amount';end if;
   end loop;
   if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(command_data->'targets'))<>jsonb_array_length(command_data->'targets') then raise exception 'Choose distinct bill targets';end if;
   for item in select value from jsonb_array_elements(command_data->'targets') order by (value->>'id')::uuid loop
    target_id=(item->>'id')::uuid;amount=public.billing_payment_amount(item->'amount');
    select * into bill from public.billing_vendor_bills b where b.id=target_id and b.business_id=business and b.demo=data_mode and b.status='issued' and b.vendor_id=credit.vendor_id;
    if bill.id is null or bill.data->>'currency' is distinct from credit.currency or exists(select 1 from public.billing_ledger_batches where reverses_id=bill.issued_batch) then raise exception 'Choose an active issued bill for this vendor, currency and data mode';end if;
    if bill.version<>(item->>'version')::integer then raise exception using errcode='40001',message='Target bill changed; reload before allocating credit';end if;
    if day<(bill.data->>'date')::date then raise exception 'Credit allocation cannot predate its target bill';end if;
    event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request||jsonb_build_object('targetId',target_id),jsonb_build_object('date',day,'kind','manual','description','Allocate vendor credit '||credit.number,'entries',jsonb_build_array(jsonb_build_object('account_id',config.payable_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit.account_id,'debit','0','credit',amount::text)))))->'batch';
    insert into public.billing_vendor_credit_allocations(id,business_id,demo,credit_id,bill_id,kind,date,amount,batch_id,snapshot,actor_id) values(event_id,business,data_mode,credit.id,bill.id,'allocate',day,amount,(journal->>'id')::uuid,jsonb_build_object('bill',bill.data,'creditNumber',credit.number,'currency',credit.currency),auth.uid());
    perform public.billing_validate_settlement_history(bill.id,'outgoing');rows=rows||jsonb_build_array(jsonb_build_object('id',event_id,'billId',bill.id,'kind','allocate','date',day,'amount',amount::text,'journal',journal));
   end loop;perform public.billing_validate_vendor_credit_history(credit.id);result=jsonb_build_object('creditId',credit.id,'allocations',rows,'replayed',false);
  else
   reason=btrim(command_data->>'reason');if jsonb_typeof(command_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Enter the dated credit correction reason';end if;
   if action='release' then
    if command_data-array['creditId','allocationId','date','amount','reason']<>'{}'::jsonb or coalesce(command_data->>'allocationId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose the original credit allocation';end if;
    select * into original from public.billing_vendor_credit_allocations a where a.id=(command_data->>'allocationId')::uuid and a.credit_id=credit.id and a.kind='allocate';
    if original.id is null or day<original.date then raise exception 'Release must reference an original allocation on or before its date';end if;
    amount=public.billing_payment_amount(command_data->'amount');select coalesce(sum(a.amount),0) into released from public.billing_vendor_credit_allocations a where a.releases_id=original.id;
    if amount>original.amount-released then raise exception 'Release exceeds remaining credit allocation';end if;
    event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description','Release vendor credit '||credit.number,'entries',jsonb_build_array(jsonb_build_object('account_id',credit.account_id,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',config.payable_account,'debit','0','credit',amount::text)))))->'batch';
    insert into public.billing_vendor_credit_allocations(id,business_id,demo,credit_id,bill_id,kind,releases_id,date,amount,batch_id,snapshot,actor_id) values(event_id,business,data_mode,credit.id,original.bill_id,'release',original.id,day,amount,(journal->>'id')::uuid,original.snapshot||jsonb_build_object('reason',reason),auth.uid());
    perform public.billing_validate_vendor_credit_history(credit.id);perform public.billing_validate_settlement_history(original.bill_id,'outgoing');result=jsonb_build_object('creditId',credit.id,'allocations',jsonb_build_array(jsonb_build_object('id',event_id,'billId',original.bill_id,'kind','release','releasesId',original.id,'date',day,'amount',amount::text,'journal',journal)),'replayed',false);
   else
    if command_data-array['creditId','date','reason']<>'{}'::jsonb or exists(select 1 from public.billing_vendor_credit_reversals where credit_id=credit.id) then raise exception 'Choose an active vendor credit and only a reversal date/reason';end if;
    if exists(select 1 from public.billing_vendor_credit_allocations a where a.credit_id=credit.id and (a.date>day or a.kind='allocate' and a.amount>coalesce((select sum(r.amount) from public.billing_vendor_credit_allocations r where r.releases_id=a.id and r.date<=day),0))) or exists(select 1 from public.billing_refund_events f where f.source_kind='vendor-credit' and f.source_id=credit.id and (f.date>day or f.kind='refund' and not exists(select 1 from public.billing_refund_events r where r.reverses_id=f.id and r.date<=day))) then raise exception 'Release every allocation and correct every refund first; credit reversal cannot predate corrections';end if;
    event_id=gen_random_uuid();insert into public.billing_credit_refund_authority(id,business_id,demo,source_kind,source_id,date) values(event_id,business,data_mode,'vendor-credit',credit.id,day);
    journal=(public.billing_ledger_reverse(business,data_mode,event_id,credit.batch_id,day,reason))->'batch';
    insert into public.billing_vendor_credit_reversals(id,credit_id,business_id,demo,date,reason,batch_id,actor_id) values(event_id,credit.id,business,data_mode,day,reason,(journal->>'id')::uuid,auth.uid());
    perform public.billing_validate_vendor_credit_history(credit.id);perform public.billing_validate_vendor_credit_cap(credit.bill_id);result=jsonb_build_object('creditId',credit.id,'credit',to_jsonb(credit)||jsonb_build_object('amount',credit.amount::text,'subtotal',credit.subtotal::text,'tax_amount',credit.tax_amount::text),'reversalId',event_id,'journal',journal,'allocations','[]'::jsonb,'replayed',false);
   end if;
  end if;
 end if;
 insert into public.billing_credit_refund_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'vendor-credit.'||action,jsonb_build_object('creditId',credit.id,'eventId',event_id));
 insert into public.billing_credit_refund_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'vendor-credit.'||action,result);return result;
end$$;

create function public.billing_refund_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_cash_configs;prior public.billing_credit_refund_commands;cash public.billing_cash_events;credit public.billing_vendor_credits;refund public.billing_refund_events;original public.billing_refund_events;
 request jsonb;result jsonb;journal jsonb;snapshot jsonb;source_kind text;source_id uuid;party uuid;direction text;control uuid;debit_account uuid;credit_account uuid;event_id uuid;day date;amount numeric(18,2);reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot record or correct refunds';end if;
 if data_mode is null or command_id is null or action is null or action not in ('record','reverse') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Invalid refund command';end if;
 request=jsonb_build_object('domain','refund','action',action,'data',command_data);
 select * into prior from public.billing_credit_refund_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_refund_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different credit/refund command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
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
  else raise exception 'Choose a cash advance or vendor credit refund source; customer credit-note refunds require their reviewed AR source workflow';end if;
  if jsonb_typeof(command_data->'method') is distinct from 'string' or length(btrim(command_data->>'method')) not between 1 and 100 or jsonb_typeof(command_data->'reference') is distinct from 'string' or length(command_data->>'reference')>500 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(command_data->>'notes')>5000 then raise exception 'Review refund method, reference and notes';end if;
  debit_account=case when direction='incoming' then config.cash_account else control end;credit_account=case when direction='incoming' then control else config.cash_account end;
  event_id=gen_random_uuid();journal=(public.billing_ledger_commit(business,data_mode,event_id,request,jsonb_build_object('date',day,'kind','manual','description','External refund record','entries',jsonb_build_array(jsonb_build_object('account_id',debit_account,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',credit_account,'debit','0','credit',amount::text)))))->'batch';
  snapshot=jsonb_build_object('business',snapshot->'business','party',snapshot->'party','partyId',party,'sourceKind',source_kind,'sourceId',source_id,'direction',direction,'currency',config.currency,'amount',amount::text,'date',day,'method',command_data->>'method','reference',command_data->>'reference','notes',command_data->>'notes','paidConfirmed',true,'providerMode','manual-external','fundsMovedByFolio',false);
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
 if refund.source_kind='cash' then perform public.billing_validate_cash_history(refund.source_id);else perform public.billing_validate_vendor_credit_history(refund.source_id);end if;
 result=jsonb_build_object('refund',to_jsonb(refund)||jsonb_build_object('amount',refund.amount::text),'journal',journal,'replayed',false);
 insert into public.billing_credit_refund_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'refund.'||action,jsonb_build_object('refundId',refund.id,'sourceKind',refund.source_kind,'sourceId',refund.source_id));
 insert into public.billing_credit_refund_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'refund.'||action,result);return result;
end$$;

create function public.billing_credit_refund_journal_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare guard_source_id uuid;guard_source_kind text;bill uuid;cash_source uuid;
begin
 if new.reverses_id is null then return new;end if;
 if exists(select 1 from public.billing_vendor_credit_allocations where batch_id=new.reverses_id) then raise exception 'Release vendor credit allocations through their source command';end if;
 select id into guard_source_id from public.billing_vendor_credits where batch_id=new.reverses_id;guard_source_kind='vendor-credit';
 if guard_source_id is null then select id into guard_source_id from public.billing_refund_events where batch_id=new.reverses_id;guard_source_kind='refund';end if;
 if guard_source_id is not null and not exists(select 1 from public.billing_credit_refund_authority a where a.id=new.command_id and a.business_id=new.business_id and a.demo=new.demo and a.source_kind=guard_source_kind and a.source_id=guard_source_id and a.date=new.date) then raise exception 'Correct vendor credits/refunds through their source commands';end if;
 select id into cash_source from public.billing_cash_events where batch_id=new.reverses_id and kind='cash';
 if cash_source is not null and exists(select 1 from public.billing_refund_events f where f.source_kind='cash' and f.source_id=cash_source and (f.date>new.date or f.kind='refund' and not exists(select 1 from public.billing_refund_events r where r.reverses_id=f.id and r.date<=new.date))) then raise exception 'Correct every cash refund first; cash reversal cannot predate refund corrections';end if;
 select id into bill from public.billing_vendor_bills where issued_batch=new.reverses_id;
 if bill is not null and exists(select 1 from public.billing_vendor_credits c left join public.billing_vendor_credit_reversals r on r.credit_id=c.id where c.bill_id=bill and (r.id is null or r.date>new.date)) then raise exception 'Reverse every source vendor credit first; bill reversal cannot predate credit corrections';end if;
 return new;
end$$;
create trigger credit_refund_journal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_credit_refund_journal_guard();
revoke all on function public.billing_vendor_credit_movements(uuid),public.billing_validate_vendor_credit_history(uuid),public.billing_validate_vendor_credit_cap(uuid),public.billing_vendor_credit_command(uuid,boolean,uuid,text,jsonb),public.billing_refund_command(uuid,boolean,uuid,text,jsonb),public.billing_credit_refund_journal_guard() from public,anon,authenticated;
grant execute on function public.billing_vendor_credit_command(uuid,boolean,uuid,text,jsonb),public.billing_refund_command(uuid,boolean,uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';

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
$$;

create function public.billing_credit_settlement_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if tg_table_name='billing_vendor_payments' then target=new.bill_id;else select id into target from public.billing_vendor_bills where issued_batch=new.reverses_id;end if;
 if target is not null and exists(select 1 from public.billing_vendor_credit_allocations where bill_id=target) then perform public.billing_validate_settlement_history(target,'outgoing');end if;return new;
end$$;
create trigger credit_compat_vendor_payment after insert on public.billing_vendor_payments for each row execute function public.billing_credit_settlement_guard();
create trigger credit_compat_bill_reversal after insert on public.billing_ledger_batches for each row execute function public.billing_credit_settlement_guard();
revoke all on function public.billing_credit_settlement_guard() from public,anon,authenticated;
