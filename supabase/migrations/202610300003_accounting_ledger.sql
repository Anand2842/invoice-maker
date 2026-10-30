-- Explicit-cutover, immutable base-currency ledger. No automatic legacy imports.
create table public.billing_ledger_configs (
 business_id uuid not null references public.billing_businesses(id), demo boolean not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'),start_date date not null,
 closed_through date,next_number bigint not null default 1 check(next_number>0),
 created_at timestamptz not null default now(),primary key(business_id,demo)
);
create table public.billing_ledger_accounts (
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,
 code text not null check(code ~ '^[A-Za-z0-9._-]{1,30}$'),name text not null check(length(btrim(name)) between 1 and 180),
 type text not null check(type in ('asset','liability','equity','income','expense')),
 created_at timestamptz not null default now(),foreign key(business_id,demo) references public.billing_ledger_configs(business_id,demo),
 unique(business_id,demo,code),unique(id,business_id,demo)
);
create table public.billing_ledger_batches (
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,
 command_id uuid not null,request jsonb not null,actor_id uuid not null references auth.users(id),
 number text not null,date date not null,description text not null check(length(btrim(description)) between 1 and 1000),
 kind text not null check(kind in ('manual','opening','reversal')),reverses_id uuid unique,
 created_at timestamptz not null default now(),foreign key(business_id,demo) references public.billing_ledger_configs(business_id,demo),
 unique(business_id,demo,command_id),unique(business_id,demo,number),unique(id,business_id,demo),
 foreign key(reverses_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),
 check((kind='reversal')=(reverses_id is not null))
);
create table public.billing_ledger_entries (
 batch_id uuid not null,business_id uuid not null,demo boolean not null,line integer not null check(line between 1 and 200),
 account_id uuid not null,debit numeric(18,2) not null check(debit>=0 and debit<=10000000000),
 credit numeric(18,2) not null check(credit>=0 and credit<=10000000000),
 primary key(batch_id,line),foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),
 foreign key(account_id,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 check((debit>0)<>(credit>0))
);
create index billing_ledger_date on public.billing_ledger_batches(business_id,demo,date,id);
create index billing_ledger_account_entries on public.billing_ledger_entries(business_id,demo,account_id,batch_id);
create table public.billing_ledger_audit (
 id bigint generated always as identity primary key,business_id uuid not null references public.billing_businesses(id),demo boolean not null,
 actor_id uuid not null references auth.users(id),action text not null,details jsonb not null,created_at timestamptz not null default now()
);
create table public.billing_ledger_outbox (
 batch_id uuid primary key references public.billing_ledger_batches(id),business_id uuid not null references public.billing_businesses(id),
 demo boolean not null,topic text not null,payload jsonb not null,created_at timestamptz not null default now()
);
alter table public.billing_ledger_configs enable row level security;
alter table public.billing_ledger_accounts enable row level security;
alter table public.billing_ledger_batches enable row level security;
alter table public.billing_ledger_entries enable row level security;
alter table public.billing_ledger_audit enable row level security;
alter table public.billing_ledger_outbox enable row level security;
revoke all on public.billing_ledger_configs,public.billing_ledger_accounts,public.billing_ledger_batches,public.billing_ledger_entries,public.billing_ledger_audit,public.billing_ledger_outbox from public,anon,authenticated;
grant select on public.billing_ledger_configs,public.billing_ledger_accounts,public.billing_ledger_batches,public.billing_ledger_entries,public.billing_ledger_audit to authenticated;
create policy ledger_config_read on public.billing_ledger_configs for select to authenticated using(public.billing_can_access(business_id));
create policy ledger_account_read on public.billing_ledger_accounts for select to authenticated using(public.billing_can_access(business_id));
create policy ledger_batch_read on public.billing_ledger_batches for select to authenticated using(public.billing_can_access(business_id));
create policy ledger_entry_read on public.billing_ledger_entries for select to authenticated using(public.billing_can_access(business_id));
create policy ledger_audit_read on public.billing_ledger_audit for select to authenticated using(public.billing_can_access(business_id));

create function public.billing_ledger_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Posted ledger history is immutable; use a dated reversal';end $$;
create trigger ledger_batch_immutable before update or delete on public.billing_ledger_batches for each row execute function public.billing_ledger_immutable();
create trigger ledger_entry_immutable before update or delete on public.billing_ledger_entries for each row execute function public.billing_ledger_immutable();
create trigger ledger_account_immutable before update or delete on public.billing_ledger_accounts for each row execute function public.billing_ledger_immutable();
create trigger ledger_audit_immutable before update or delete on public.billing_ledger_audit for each row execute function public.billing_ledger_immutable();
create trigger ledger_outbox_immutable before update or delete on public.billing_ledger_outbox for each row execute function public.billing_ledger_immutable();

create function public.billing_ledger_amount(value jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare raw text;amount numeric;
begin
 if value is null or jsonb_typeof(value) not in ('string','number') then raise exception 'Ledger amounts must have at most two decimal places';end if;
 raw=value#>>'{}';
 if length(raw)>64 or raw!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Ledger amounts must have at most two decimal places';end if;
 amount=raw::numeric;if amount>10000000000 then raise exception 'Ledger amount exceeds the supported range';end if;return amount;
end$$;
create function public.billing_ledger_batch_json(batch uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'number',b.number,'date',b.date,'description',b.description,'kind',b.kind,'reverses_id',b.reverses_id,
 'reversed_by',(select r.id from public.billing_ledger_batches r where r.reverses_id=b.id),'entries',
 (select jsonb_agg(jsonb_build_object('account_id',e.account_id,'debit',e.debit::text,'credit',e.credit::text) order by e.line) from public.billing_ledger_entries e where e.batch_id=b.id))
 from public.billing_ledger_batches b where b.id=batch
$$;
create function public.billing_ledger_setup(business uuid,data_mode boolean,date_start date) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.billing_businesses;c public.billing_ledger_configs;inserted integer;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can configure this ledger';end if;
 select * into b from public.billing_businesses where id=business for no key update;
 if data_mode is null or date_start is null or not isfinite(date_start) or date_start>(now() at time zone b.time_zone)::date then raise exception 'Choose a ledger start date on or before today';end if;
 insert into public.billing_ledger_configs(business_id,demo,currency,start_date) values(business,data_mode,b.currency,date_start) on conflict do nothing;
 get diagnostics inserted=row_count;
 select * into c from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if c.start_date<>date_start then raise exception 'Ledger already configured; start date and currency cannot be changed';end if;
 insert into public.billing_ledger_accounts(business_id,demo,code,name,type) values
 (business,data_mode,'1000','Cash and bank','asset'),(business,data_mode,'1100','Accounts receivable','asset'),
 (business,data_mode,'1200','Inventory','asset'),(business,data_mode,'1300','Tax receivable','asset'),
 (business,data_mode,'2000','Accounts payable','liability'),(business,data_mode,'2100','Tax payable','liability'),
 (business,data_mode,'3000','Capital and opening equity','equity'),(business,data_mode,'3100','Retained earnings','equity'),
 (business,data_mode,'4000','Sales income','income'),(business,data_mode,'4900','Other income','income'),
 (business,data_mode,'5000','Operating expenses','expense'),(business,data_mode,'5100','Cost of goods sold','expense') on conflict do nothing;
 if inserted=1 then insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'ledger.configured',jsonb_build_object('currency',c.currency,'startDate',c.start_date));end if;
 return to_jsonb(c);
end$$;
create function public.billing_ledger_create_account(business uuid,data_mode boolean,account_code text,account_name text,account_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.billing_ledger_accounts;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can create ledger accounts';end if;
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 if account_code is null or account_code!~'^[A-Za-z0-9._-]{1,30}$' or account_name is null or length(btrim(account_name)) not between 1 and 180 or account_type is null or account_type not in ('asset','liability','equity','income','expense') then raise exception 'Enter a valid account code, name and type';end if;
 insert into public.billing_ledger_accounts(business_id,demo,code,name,type) values(business,data_mode,account_code,btrim(account_name),account_type) returning * into a;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'account.created',jsonb_build_object('accountId',a.id));
 return to_jsonb(a);
end$$;

-- Private commit primitive. Public commands own authorization, idempotency and period locks.
create function public.billing_ledger_commit(business uuid,data_mode boolean,command_id uuid,request jsonb,journal jsonb,reverses uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_ledger_configs;b public.billing_ledger_batches;a public.billing_ledger_accounts;entry jsonb;
 debit numeric;credit numeric;total_debit numeric=0;total_credit numeric=0;n integer=0;day date;kind text;
begin
 select * into c from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if c.business_id is null then raise exception 'Configure the ledger first';end if;
 day=public.billing_payment_date(journal->'date');kind=journal->>'kind';
 if day<c.start_date or (c.closed_through is not null and day<=c.closed_through) then raise exception 'Posting date is outside the open ledger period';end if;
 if day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Future journal posting is not supported';end if;
 if jsonb_typeof(journal->'description') is distinct from 'string' or length(btrim(journal->>'description')) not between 1 and 1000 then raise exception 'Enter a journal description';end if;
 if jsonb_typeof(journal->'entries') is distinct from 'array' or jsonb_array_length(journal->'entries') not between 2 and 200 then raise exception 'A journal needs 2 to 200 lines';end if;
 if kind='opening' then
  if exists(select 1 from public.billing_ledger_batches o join public.billing_ledger_batches r on r.reverses_id=o.id where o.business_id=business and o.demo=data_mode and o.kind='opening' and r.date<>c.start_date) then raise exception 'A later-date opening reversal needs a manual correction; it cannot be replaced at the start date';end if;
  if not public.billing_is_owner(business) or day<>c.start_date then raise exception 'Opening balances require the owner and ledger start date';end if;
  if exists(select 1 from public.billing_ledger_batches o where o.business_id=business and o.demo=data_mode and o.kind='opening' and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=o.id)) then raise exception 'Reverse the existing opening journal before replacing it';end if;
 end if;
 if c.next_number>999999999 then raise exception 'Ledger sequence exhausted';end if;
 insert into public.billing_ledger_batches(business_id,demo,command_id,request,actor_id,number,date,description,kind,reverses_id)
 values(business,data_mode,command_id,request,auth.uid(),(case when data_mode then 'DEMO-JRN-' else 'JRN-' end)||lpad(c.next_number::text,greatest(6,length(c.next_number::text)),'0'),day,btrim(journal->>'description'),kind,reverses) returning * into b;
 for entry in select value from jsonb_array_elements(journal->'entries') loop
  n=n+1;
  if jsonb_typeof(entry) is distinct from 'object' or (entry-array['account_id','debit','credit'])<>'{}'::jsonb or coalesce(entry->>'account_id','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Choose a ledger account for each line';end if;
  select * into a from public.billing_ledger_accounts where id=(entry->>'account_id')::uuid and business_id=business and demo=data_mode;
  if a.id is null then raise exception 'Account unavailable in this business and data mode';end if;
  if kind='opening' and a.type in ('income','expense') then raise exception 'Opening balances cannot use income or expense accounts';end if;
  debit=public.billing_ledger_amount(entry->'debit');credit=public.billing_ledger_amount(entry->'credit');
  if (debit>0)=(credit>0) then raise exception 'Each line needs exactly one positive debit or credit';end if;
  total_debit=total_debit+debit;total_credit=total_credit+credit;
  insert into public.billing_ledger_entries(batch_id,business_id,demo,line,account_id,debit,credit) values(b.id,business,data_mode,n,a.id,debit,credit);
 end loop;
 if total_debit<>total_credit or total_debit=0 or (select count(distinct account_id) from public.billing_ledger_entries where batch_id=b.id)<2 then raise exception 'Journal debits and credits must balance across at least two accounts';end if;
 update public.billing_ledger_configs set next_number=next_number+1 where business_id=business and demo=data_mode;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),case when reverses is null then 'journal.posted' else 'journal.reversed' end,jsonb_build_object('batchId',b.id,'reversesId',reverses));
 insert into public.billing_ledger_outbox(batch_id,business_id,demo,topic,payload) values(b.id,business,data_mode,'ledger.posted',jsonb_build_object('batchId',b.id));
 return jsonb_build_object('batch',public.billing_ledger_batch_json(b.id),'replayed',false);
end$$;
create function public.billing_ledger_post(business uuid,data_mode boolean,command_id uuid,journal jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.billing_ledger_batches;request jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot post to this ledger';end if;
 if data_mode is null or command_id is null or jsonb_typeof(journal) is distinct from 'object' or (journal-array['date','description','kind','entries'])<>'{}'::jsonb or not coalesce(journal->>'kind' in ('manual','opening'),false) then raise exception 'Invalid journal command';end if;
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 request=jsonb_build_object('action','post','journal',journal);
 select * into previous from public.billing_ledger_batches b where b.business_id=business and b.demo=data_mode and b.command_id=billing_ledger_post.command_id;
 if previous.id is not null then
  if previous.actor_id<>auth.uid() or previous.request<>request then raise exception using errcode='40001',message='This retry key was used for a different journal';end if;
  return jsonb_build_object('batch',public.billing_ledger_batch_json(previous.id),'replayed',true);
 end if;
 return public.billing_ledger_commit(business,data_mode,command_id,request,journal);
end$$;
create function public.billing_ledger_reverse(business uuid,data_mode boolean,command_id uuid,batch_id uuid,reversal_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.billing_ledger_batches;original public.billing_ledger_batches;request jsonb;journal jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot reverse this ledger journal';end if;
 if data_mode is null or command_id is null or batch_id is null or reversal_date is null or not isfinite(reversal_date) or reason is null or length(btrim(reason)) not between 1 and 1000 then raise exception 'Enter a reversal date and reason';end if;
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 request=jsonb_build_object('action','reverse','batch',batch_id,'date',reversal_date,'reason',reason);
 select * into previous from public.billing_ledger_batches b where b.business_id=business and b.demo=data_mode and b.command_id=billing_ledger_reverse.command_id;
 if previous.id is not null then
  if previous.actor_id<>auth.uid() or previous.request<>request then raise exception using errcode='40001',message='This retry key was used for a different journal';end if;
  return jsonb_build_object('batch',public.billing_ledger_batch_json(previous.id),'replayed',true);
 end if;
 select * into original from public.billing_ledger_batches where id=batch_id and business_id=business and demo=data_mode;
 if original.id is null or original.kind='reversal' then raise exception 'Choose an original journal in this business and data mode';end if;
 if original.kind='opening' and not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can reverse opening balances';end if;
 if reversal_date<original.date then raise exception 'A reversal cannot predate its journal';end if;
 if exists(select 1 from public.billing_ledger_batches where reverses_id=batch_id) then raise exception using errcode='40001',message='This journal is already reversed';end if;
 journal=jsonb_build_object('date',reversal_date,'description',reason,'kind','reversal','entries',(select jsonb_agg(jsonb_build_object('account_id',account_id,'debit',credit::text,'credit',debit::text) order by line) from public.billing_ledger_entries where public.billing_ledger_entries.batch_id=billing_ledger_reverse.batch_id));
 return public.billing_ledger_commit(business,data_mode,command_id,request,journal,batch_id);
end$$;
create function public.billing_ledger_close(business uuid,data_mode boolean,through_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_ledger_configs;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can close ledger periods';end if;
 select * into c from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if c.business_id is null then raise exception 'Configure the ledger first';end if;
 if through_date is null or not isfinite(through_date) or through_date<c.start_date or through_date>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) or through_date<coalesce(c.closed_through,through_date) then raise exception 'Choose a close date within the ledger period; closed periods cannot reopen';end if;
 if c.closed_through is distinct from through_date then
  update public.billing_ledger_configs set closed_through=through_date where business_id=business and demo=data_mode;
  insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'period.closed',jsonb_build_object('through',through_date));
 end if;
 return jsonb_build_object('closed_through',through_date);
end$$;
create function public.billing_ledger_read(business uuid,data_mode boolean,from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.billing_ledger_configs;accounts jsonb;balances jsonb;journals jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business ledger unavailable';end if;
 select * into c from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if c.business_id is null then return jsonb_build_object('configured',false,'canManage',public.billing_is_owner(business));end if;
 if from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a valid report date range';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('account_id',a.id,'debit',coalesce(v.debit,0)::text,'credit',coalesce(v.credit,0)::text,'period_debit',coalesce(v.period_debit,0)::text,'period_credit',coalesce(v.period_credit,0)::text,'opening',coalesce(v.opening,0)::text) order by a.code),'[]'::jsonb) into balances
 from public.billing_ledger_accounts a left join lateral(
  select sum(e.debit) as debit,sum(e.credit) as credit,sum(e.debit) filter(where b.date>=from_date) as period_debit,sum(e.credit) filter(where b.date>=from_date) as period_credit,sum(e.debit-e.credit) filter(where b.date<from_date) as opening
  from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.account_id=a.id and e.business_id=business and e.demo=data_mode and b.date<=to_date
 )v on true where a.business_id=business and a.demo=data_mode;
 select coalesce(jsonb_agg(public.billing_ledger_batch_json(id) order by date desc,created_at desc,id desc),'[]'::jsonb) into journals from(select id,date,created_at from public.billing_ledger_batches where business_id=business and demo=data_mode and date between from_date and to_date order by date desc,created_at desc,id desc limit 100)q;
 return jsonb_build_object('configured',true,'canManage',public.billing_is_owner(business),'canWrite',public.billing_can_access(business,true),'config',jsonb_build_object('currency',c.currency,'start_date',c.start_date,'closed_through',c.closed_through),'accounts',accounts,'balances',balances,'journals',journals,'historyTruncated',(select count(*)>100 from public.billing_ledger_batches where business_id=business and demo=data_mode and date between from_date and to_date));
end$$;
revoke all on function public.billing_ledger_immutable(),public.billing_ledger_amount(jsonb),public.billing_ledger_batch_json(uuid),public.billing_ledger_commit(uuid,boolean,uuid,jsonb,jsonb,uuid),public.billing_ledger_setup(uuid,boolean,date),public.billing_ledger_create_account(uuid,boolean,text,text,text),public.billing_ledger_post(uuid,boolean,uuid,jsonb),public.billing_ledger_reverse(uuid,boolean,uuid,uuid,date,text),public.billing_ledger_close(uuid,boolean,date),public.billing_ledger_read(uuid,boolean,date,date) from public,anon,authenticated;
grant execute on function public.billing_ledger_setup(uuid,boolean,date),public.billing_ledger_create_account(uuid,boolean,text,text,text),public.billing_ledger_post(uuid,boolean,uuid,jsonb),public.billing_ledger_reverse(uuid,boolean,uuid,uuid,date,text),public.billing_ledger_close(uuid,boolean,date),public.billing_ledger_read(uuid,boolean,date,date) to authenticated;
notify pgrst,'reload schema';

-- A demo ledger cannot lock the real business profile. A configured real base is fixed.
create function public.billing_ledger_currency_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.currency is distinct from old.currency and exists(select 1 from public.billing_ledger_configs where business_id=old.id and not demo) then raise exception 'The real ledger base currency cannot change after setup';end if;
 return new;
end$$;
create trigger billing_ledger_currency_guard before update of currency on public.billing_businesses for each row execute function public.billing_ledger_currency_guard();
revoke all on function public.billing_ledger_currency_guard() from public,anon,authenticated;
