-- Manual statement reconciliation only. No feeds, money movement or journal posting.
create table public.billing_bank_imports (
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,account_id uuid not null,
 currency text not null,source_name text not null check(length(source_name) between 1 and 180),source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),
 rows_hash text not null check(rows_hash~'^[a-f0-9]{64}$'),mapping jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(account_id,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo),
 unique(business_id,demo,account_id,source_hash),unique(business_id,demo,account_id,rows_hash),unique(id,business_id,demo,account_id)
);
create table public.billing_bank_lines (
 id uuid primary key default gen_random_uuid(),import_id uuid not null,business_id uuid not null,demo boolean not null,account_id uuid not null,
 source_line integer not null check(source_line between 2 and 5001),date date not null,description text not null check(length(description) between 1 and 1000),reference text not null check(length(reference)<=500),
 debit numeric(18,2) not null check(debit>=0 and debit<=10000000000),credit numeric(18,2) not null check(credit>=0 and credit<=10000000000),reported_balance numeric(18,2),
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),check((debit>0)<>(credit>0)),check(reported_balance is null or abs(reported_balance)<=10000000000),
 foreign key(import_id,business_id,demo,account_id) references public.billing_bank_imports(id,business_id,demo,account_id),
 unique(business_id,demo,account_id,fingerprint),unique(id,business_id,demo,account_id)
);
create table public.billing_bank_matches (
 line_id uuid primary key,business_id uuid not null,demo boolean not null,account_id uuid not null,batch_id uuid not null,entry_line integer not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(line_id,business_id,demo,account_id) references public.billing_bank_lines(id,business_id,demo,account_id),
 foreign key(batch_id,entry_line) references public.billing_ledger_entries(batch_id,line),unique(batch_id,entry_line)
);
create table public.billing_bank_audit (
 id bigint generated always as identity primary key,business_id uuid not null references public.billing_businesses(id),demo boolean not null,
 command_id uuid not null,actor_id uuid not null references auth.users(id),action text not null,details jsonb not null,created_at timestamptz not null default now()
);
create table public.billing_bank_commands (
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),
 request jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(business_id,demo,command_id)
);
alter table public.billing_bank_imports enable row level security;
alter table public.billing_bank_lines enable row level security;
alter table public.billing_bank_matches enable row level security;
alter table public.billing_bank_audit enable row level security;
alter table public.billing_bank_commands enable row level security;
revoke all on public.billing_bank_imports,public.billing_bank_lines,public.billing_bank_matches,public.billing_bank_audit,public.billing_bank_commands from public,anon,authenticated;
grant select on public.billing_bank_imports,public.billing_bank_lines,public.billing_bank_matches,public.billing_bank_audit to authenticated;
create policy bank_import_read on public.billing_bank_imports for select to authenticated using(public.billing_can_access(business_id));
create policy bank_line_read on public.billing_bank_lines for select to authenticated using(public.billing_can_access(business_id));
create policy bank_match_read on public.billing_bank_matches for select to authenticated using(public.billing_can_access(business_id));
create policy bank_audit_read on public.billing_bank_audit for select to authenticated using(public.billing_can_access(business_id));
create trigger bank_import_immutable before update or delete on public.billing_bank_imports for each row execute function public.billing_ledger_immutable();
create trigger bank_line_immutable before update or delete on public.billing_bank_lines for each row execute function public.billing_ledger_immutable();
create trigger bank_audit_immutable before update or delete on public.billing_bank_audit for each row execute function public.billing_ledger_immutable();
create trigger bank_command_immutable before update or delete on public.billing_bank_commands for each row execute function public.billing_ledger_immutable();

create function public.billing_bank_command(business uuid,data_mode boolean,command_id uuid,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_ledger_configs;account public.billing_ledger_accounts;previous public.billing_bank_commands;imported uuid;item jsonb;n integer=0;day date;debit numeric;credit numeric;balance numeric;description text;reference text;v_fingerprint text;v_source_hash text;v_rows_hash text;statement public.billing_bank_lines;entry public.billing_ledger_entries;matched public.billing_bank_matches;result jsonb;action text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot reconcile this business';end if;
 if data_mode is null or command_id is null or jsonb_typeof(command) is distinct from 'object' then raise exception 'Invalid reconciliation command';end if;
 action=command->>'action';
 if action is null or action not in ('import','match','unmatch') or coalesce(command->>'account','')!~'^[a-f0-9A-F]{8}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{12}$' then raise exception 'Choose a reconciliation action and asset account';end if;
 -- Ledger and reconciliation commands share this one serialization lock. No account->config inversion.
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if config.business_id is null then raise exception 'Configure the ledger first';end if;
 select * into previous from public.billing_bank_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_bank_command.command_id;
 if previous.command_id is not null then
  if previous.actor_id<>auth.uid() or previous.request<>command then raise exception using errcode='40001',message='Retry key was used for a different reconciliation command';end if;
  return previous.result||jsonb_build_object('replayed',true);
 end if;
 select * into account from public.billing_ledger_accounts where id=(command->>'account')::uuid and business_id=business and demo=data_mode and type='asset';
 if account.id is null then raise exception 'Choose an asset account in this business and data mode';end if;
 if action='import' then
  if (command-array['action','account','currency','sourceName','sourceHash','mapping','rows'])<>'{}'::jsonb or jsonb_typeof(command->'sourceName') is distinct from 'string' or length(btrim(command->>'sourceName')) not between 1 and 180 or coalesce(command->>'currency','')<>config.currency or coalesce(command->>'sourceHash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(command->'mapping') is distinct from 'object' or octet_length((command->'mapping')::text)>2000 or jsonb_typeof(command->'rows') is distinct from 'array' or jsonb_array_length(command->'rows') not between 1 and 5000 or octet_length(command::text)>2097152 then raise exception 'Review 1 to 5000 rows within 2 MB in the ledger base currency';end if;
  v_source_hash=command->>'sourceHash';v_rows_hash=encode(sha256(convert_to((command->'rows')::text,'UTF8')),'hex');
  if exists(select 1 from public.billing_bank_imports i where i.business_id=business and i.demo=data_mode and i.account_id=account.id and (i.source_hash=v_source_hash or i.rows_hash=v_rows_hash)) then raise exception using errcode='23505',message='This statement has already been imported for this account';end if;
  insert into public.billing_bank_imports(business_id,demo,account_id,currency,source_name,source_hash,rows_hash,mapping,actor_id)
   values(business,data_mode,account.id,config.currency,btrim(command->>'sourceName'),v_source_hash,v_rows_hash,command->'mapping',auth.uid()) returning id into imported;
  for item in select value from jsonb_array_elements(command->'rows') loop
   n=n+1;
   if jsonb_typeof(item) is distinct from 'object' or (item-array['date','description','reference','debit','credit','reportedBalance'])<>'{}'::jsonb or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 1000 or jsonb_typeof(item->'reference') is distinct from 'string' or length(item->>'reference')>500 then raise exception 'Statement rows need a date, description, reference and exact debit/credit amounts';end if;
   day=public.billing_payment_date(item->'date');
   if day>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) then raise exception 'Statement dates cannot be in the future';end if;
   if jsonb_typeof(item->'debit') is distinct from 'string' or jsonb_typeof(item->'credit') is distinct from 'string' then raise exception 'Statement amounts must be exact decimal strings';end if;
   debit=public.billing_ledger_amount(item->'debit');credit=public.billing_ledger_amount(item->'credit');
   if (debit>0)=(credit>0) then raise exception 'Each statement row needs exactly one positive debit or credit';end if;
   description=btrim(item->>'description');reference=btrim(item->>'reference');balance=null;
   if item?'reportedBalance' then
    if jsonb_typeof(item->'reportedBalance') is distinct from 'string' or coalesce(item->>'reportedBalance','')!~'^-?[0-9]+(\.[0-9]{1,2})?$' or length(item->>'reportedBalance')>64 then raise exception 'Reported balance must be an exact signed decimal';end if;
    balance=(item->>'reportedBalance')::numeric;if abs(balance)>10000000000 then raise exception 'Reported balance exceeds the supported range';end if;
   end if;
   -- Balance is observational, not transaction identity. A changed reported balance cannot bypass duplicates.
   v_fingerprint=encode(sha256(convert_to(jsonb_build_array(day,description,reference,debit::numeric(18,2),credit::numeric(18,2))::text,'UTF8')),'hex');
   if exists(select 1 from public.billing_bank_lines l where l.business_id=business and l.demo=data_mode and l.account_id=account.id and l.fingerprint=v_fingerprint) then raise exception using errcode='23505',message='A duplicate transaction fingerprint was found. Nothing was imported; review overlapping or identical rows';end if;
   insert into public.billing_bank_lines(import_id,business_id,demo,account_id,source_line,date,description,reference,debit,credit,reported_balance,fingerprint)
   values(imported,business,data_mode,account.id,n+1,day,description,reference,debit,credit,balance,v_fingerprint);
  end loop;
  result=jsonb_build_object('importId',imported,'lineCount',n,'replayed',false);
 else
  if (command-array['action','account','line','batch','entryLine','reason'])<>'{}'::jsonb or coalesce(command->>'line','')!~'^[a-f0-9A-F]{8}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{12}$' then raise exception 'Choose a statement line';end if;
  select * into statement from public.billing_bank_lines where id=(command->>'line')::uuid and business_id=business and demo=data_mode and account_id=account.id;
  if statement.id is null then raise exception 'Statement line unavailable in this account';end if;
  select * into matched from public.billing_bank_matches where line_id=statement.id;
  if action='match' then
   if matched.line_id is not null then raise exception using errcode='40001',message='This statement line is already matched';end if;
   if coalesce(command->>'batch','')!~'^[a-f0-9A-F]{8}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{4}-[a-f0-9A-F]{12}$' or coalesce(command->>'entryLine','')!~'^[0-9]{1,3}$' then raise exception 'Choose a posted ledger entry';end if;
   select * into entry from public.billing_ledger_entries where batch_id=(command->>'batch')::uuid and line=(command->>'entryLine')::integer and business_id=business and demo=data_mode and account_id=account.id;
   if entry.batch_id is null or entry.debit-entry.credit<>statement.debit-statement.credit then raise exception 'Ledger entry must match this account and exact signed amount';end if;
   if exists(select 1 from public.billing_bank_matches where batch_id=entry.batch_id and entry_line=entry.line) then raise exception using errcode='40001',message='This ledger entry is already matched';end if;
   insert into public.billing_bank_matches(line_id,business_id,demo,account_id,batch_id,entry_line,actor_id) values(statement.id,business,data_mode,account.id,entry.batch_id,entry.line,auth.uid());
   result=jsonb_build_object('lineId',statement.id,'batchId',entry.batch_id,'entryLine',entry.line,'replayed',false);
  else
   if matched.line_id is null then raise exception using errcode='40001',message='This statement line is not matched';end if;
   if jsonb_typeof(command->'reason') is distinct from 'string' or length(btrim(command->>'reason')) not between 1 and 1000 then raise exception 'Enter the reason for removing this match';end if;
   delete from public.billing_bank_matches where line_id=statement.id;
   result=jsonb_build_object('lineId',statement.id,'batchId',matched.batch_id,'entryLine',matched.entry_line,'reason',btrim(command->>'reason'),'replayed',false);
  end if;
 end if;
 insert into public.billing_bank_audit(business_id,demo,command_id,actor_id,action,details) values(business,data_mode,command_id,auth.uid(),action,result);
 insert into public.billing_bank_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),command,result);
 return result;
end $$;

create function public.billing_bank_read(business uuid,data_mode boolean,account_id uuid,from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_ledger_configs;imports jsonb;lines jsonb;accounts jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business reconciliation unavailable';end if;
 if data_mode is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a valid statement date range';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if config.business_id is null then return jsonb_build_object('configured',false);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode and type='asset';
 if account_id is null then return jsonb_build_object('configured',true,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'accounts',accounts,'imports','[]'::jsonb,'lines','[]'::jsonb);end if;
 if not exists(select 1 from public.billing_ledger_accounts a where a.id=account_id and a.business_id=business and a.demo=data_mode and a.type='asset') then raise exception 'Choose an asset account in this business and data mode';end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by created_at desc,id desc),'[]'::jsonb) into imports from(select id,source_name,created_at,currency from public.billing_bank_imports i where i.business_id=business and i.demo=data_mode and i.account_id=billing_bank_read.account_id order by created_at desc,id desc limit 100)i;
 select coalesce(jsonb_agg(to_jsonb(l) order by date,id),'[]'::jsonb) into lines from(select l.id,l.import_id,l.source_line,l.date,l.description,l.reference,l.debit::text,l.credit::text,l.reported_balance::text,m.batch_id,m.entry_line from public.billing_bank_lines l left join public.billing_bank_matches m on m.line_id=l.id where l.business_id=business and l.demo=data_mode and l.account_id=billing_bank_read.account_id and l.date between from_date and to_date order by l.date,l.id limit 501)l;
 if jsonb_array_length(lines)>500 then raise exception 'More than 500 statement lines in this range. Choose a narrower date range';end if;
 return jsonb_build_object('configured',true,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'accounts',accounts,'imports',imports,'lines',lines,'importsTruncated',(select count(*)>100 from public.billing_bank_imports i where i.business_id=business and i.demo=data_mode and i.account_id=billing_bank_read.account_id));
end $$;
create function public.billing_bank_candidates(business uuid,data_mode boolean,line_id uuid,from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare statement public.billing_bank_lines;entries jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business reconciliation unavailable';end if;
 if data_mode is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a valid candidate date range';end if;
 select * into statement from public.billing_bank_lines where id=line_id and business_id=business and demo=data_mode;
 if statement.id is null then raise exception 'Statement line unavailable';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by date,batch_id,line),'[]'::jsonb) into entries from(select e.batch_id,e.line,b.date,b.number,b.description,e.debit::text,e.credit::text from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and e.account_id=statement.account_id and e.debit-e.credit=statement.debit-statement.credit and b.date between from_date and to_date and not exists(select 1 from public.billing_bank_matches m where m.batch_id=e.batch_id and m.entry_line=e.line) order by b.date,e.batch_id,e.line limit 101)q;
 if jsonb_array_length(entries)>100 then raise exception 'More than 100 matching candidates. Narrow the ledger date range';end if;
 return jsonb_build_object('lineId',statement.id,'candidates',entries);
end $$;
revoke all on function public.billing_bank_command(uuid,boolean,uuid,jsonb),public.billing_bank_read(uuid,boolean,uuid,date,date),public.billing_bank_candidates(uuid,boolean,uuid,date,date) from public,anon,authenticated;
grant execute on function public.billing_bank_command(uuid,boolean,uuid,jsonb),public.billing_bank_read(uuid,boolean,uuid,date,date),public.billing_bank_candidates(uuid,boolean,uuid,date,date) to authenticated;
notify pgrst,'reload schema';
