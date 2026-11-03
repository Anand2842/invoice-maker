-- Explicit grouped bank review. Links existing immutable statement and ledger
-- entries; never creates cash, fees, postings or a feed transaction.
create table public.billing_bank_match_groups(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,account_id uuid not null,amount numeric(18,2) not null check(amount<>0),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),foreign key(account_id,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo));
create table public.billing_bank_group_lines(group_id uuid not null references public.billing_bank_match_groups(id),line_id uuid not null references public.billing_bank_lines(id),primary key(group_id,line_id));
create index bank_group_line_lookup on public.billing_bank_group_lines(line_id);
create table public.billing_bank_group_entries(group_id uuid not null references public.billing_bank_match_groups(id),batch_id uuid not null,entry_line integer not null,primary key(group_id,batch_id,entry_line),foreign key(batch_id,entry_line) references public.billing_ledger_entries(batch_id,line));
create index bank_group_entry_lookup on public.billing_bank_group_entries(batch_id,entry_line);
create table public.billing_bank_group_active(group_id uuid primary key references public.billing_bank_match_groups(id));
create table public.billing_bank_group_outbox(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,kind text not null check(kind in ('matched','unmatched')),payload jsonb not null,created_at timestamptz not null default now(),unique(business_id,demo,command_id));
create function public.billing_bank_group_legacy_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.billing_bank_group_active a join public.billing_bank_group_lines l on l.group_id=a.group_id where l.line_id=new.line_id) or exists(select 1 from public.billing_bank_group_active a join public.billing_bank_group_entries e on e.group_id=a.group_id where e.batch_id=new.batch_id and e.entry_line=new.entry_line) then raise exception using errcode='40001',message='This statement or ledger entry belongs to an active grouped match. Remove the whole reviewed group first';end if;return new;
end $$;
create trigger bank_group_legacy_guard before insert or update on public.billing_bank_matches for each row execute function public.billing_bank_group_legacy_guard();
create function public.billing_bank_group_json(group_uuid uuid) returns jsonb language sql stable security definer set search_path='' as $$select to_jsonb(g)||jsonb_build_object('amount',g.amount::text,'active',exists(select 1 from public.billing_bank_group_active a where a.group_id=g.id),'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'date',l.date,'description',l.description,'reference',l.reference,'debit',l.debit::text,'credit',l.credit::text) order by l.date,l.id) from public.billing_bank_group_lines x join public.billing_bank_lines l on l.id=x.line_id where x.group_id=g.id),'[]'::jsonb),'entries',coalesce((select jsonb_agg(jsonb_build_object('batchId',e.batch_id,'line',e.line,'date',b.date,'number',b.number,'description',b.description,'debit',e.debit::text,'credit',e.credit::text) order by b.date,e.batch_id,e.line) from public.billing_bank_group_entries x join public.billing_ledger_entries e on e.batch_id=x.batch_id and e.line=x.entry_line join public.billing_ledger_batches b on b.id=e.batch_id where x.group_id=g.id),'[]'::jsonb)) from public.billing_bank_match_groups g where g.id=group_uuid$$;
create function public.billing_bank_group_command(business uuid,data_mode boolean,command_id uuid,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.billing_ledger_configs;prior public.billing_bank_commands;account public.billing_ledger_accounts;g public.billing_bank_match_groups;result jsonb;action text;v jsonb;ids uuid[];line_uuid uuid;batch uuid;line_num integer;bank_total numeric=0;book_total numeric=0;n integer;entry public.billing_ledger_entries;statement public.billing_bank_lines;reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot reconcile this business';end if;
 if data_mode is null or command_id is null or jsonb_typeof(command) is distinct from 'object' or command->>'action' is null or command->>'action' not in ('match-group','unmatch-group') then raise exception 'Choose a reviewed grouped reconciliation command';end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if config.business_id is null then raise exception 'Configure the ledger first';end if;
 select * into prior from public.billing_bank_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_bank_group_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>command then raise exception using errcode='40001',message='Retry key was used for a different reconciliation command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if coalesce(command->>'account','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose a ledger asset account';end if;
 select * into account from public.billing_ledger_accounts where id=(command->>'account')::uuid and business_id=business and demo=data_mode and type='asset';
 if account.id is null then raise exception 'Choose an asset account in this business and data mode';end if;
 action=command->>'action';
 if action='match-group' then
  if command-array['action','account','lines','entries','reviewed']<>'{}'::jsonb or command->'reviewed' is distinct from 'true'::jsonb or jsonb_typeof(command->'lines') is distinct from 'array' or jsonb_typeof(command->'entries') is distinct from 'array' then raise exception 'Review the exact grouped statement and ledger entries';end if;
  if jsonb_array_length(command->'lines') not between 1 and 100 or jsonb_array_length(command->'entries') not between 1 and 100 then raise exception 'Choose between 1 and 100 statement lines and ledger entries';end if;
  ids='{}';
  for v in select value from jsonb_array_elements(command->'lines') loop
   if jsonb_typeof(v)<>'string' or coalesce(v#>>'{}','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose exact statement line IDs';end if;
   line_uuid=(v#>>'{}')::uuid;if line_uuid=any(ids) then raise exception 'Duplicate statement line in grouped match';end if;ids=array_append(ids,line_uuid);
   select * into statement from public.billing_bank_lines where billing_bank_lines.id=line_uuid and business_id=business and demo=data_mode and account_id=account.id;
   if statement.id is null then raise exception 'Statement line unavailable in this account and data mode';end if;
   if exists(select 1 from public.billing_bank_matches where line_id=line_uuid) or exists(select 1 from public.billing_bank_group_active a join public.billing_bank_group_lines x on x.group_id=a.group_id where x.line_id=line_uuid) then raise exception using errcode='40001',message='Statement line is already matched';end if;
   if bank_total<>0 and sign(bank_total)<>sign(statement.debit-statement.credit) then raise exception 'A grouped match must have one cash direction; do not hide fees or reversals by netting';end if;
   bank_total=bank_total+statement.debit-statement.credit;
  end loop;
  n=0;
  for v in select value from jsonb_array_elements(command->'entries') loop
   if jsonb_typeof(v)<>'object' or v-array['batch','entryLine']<>'{}'::jsonb or coalesce(v->>'batch','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(v->'entryLine')<>'number' or coalesce(v->>'entryLine','')!~'^[0-9]{1,3}$' then raise exception 'Choose exact posted ledger entry identities';end if;
   batch=(v->>'batch')::uuid;line_num=(v->>'entryLine')::integer;n=n+1;
   if (select count(*) from jsonb_array_elements(command->'entries') z where lower(z->>'batch')=batch::text and z->>'entryLine'=line_num::text)<>1 then raise exception 'Duplicate ledger entry in grouped match';end if;
   select * into entry from public.billing_ledger_entries where batch_id=batch and line=line_num and business_id=business and demo=data_mode and account_id=account.id;
   if entry.batch_id is null then raise exception 'Ledger entry unavailable in this account and data mode';end if;
   if sign(entry.debit-entry.credit)<>sign(bank_total) then raise exception 'All grouped entries must have the same cash direction as the statement';end if;
   if exists(select 1 from public.billing_bank_matches where batch_id=batch and entry_line=line_num) or exists(select 1 from public.billing_bank_group_active a join public.billing_bank_group_entries x on x.group_id=a.group_id where x.batch_id=batch and x.entry_line=line_num) then raise exception using errcode='40001',message='Ledger entry is already matched';end if;
   book_total=book_total+entry.debit-entry.credit;
  end loop;
  if bank_total<>book_total or bank_total=0 or abs(bank_total)>10000000000 then raise exception 'Grouped statement and posted ledger totals must match exactly within the supported amount; post reviewed fees separately';end if;
  insert into public.billing_bank_match_groups(business_id,demo,account_id,amount,actor_id) values(business,data_mode,account.id,bank_total,auth.uid()) returning * into g;
  insert into public.billing_bank_group_lines(group_id,line_id) select g.id,unnest(ids);
  insert into public.billing_bank_group_entries(group_id,batch_id,entry_line) select g.id,(piece.value->>'batch')::uuid,(piece.value->>'entryLine')::integer from jsonb_array_elements(command->'entries') piece(value);
  insert into public.billing_bank_group_active values(g.id);
 else
  if command-array['action','account','group','reason']<>'{}'::jsonb or coalesce(command->>'group','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(command->'reason') is distinct from 'string' or length(btrim(command->>'reason')) not between 1 and 1000 then raise exception 'Choose the whole grouped match and a correction reason';end if;
  select * into g from public.billing_bank_match_groups where billing_bank_match_groups.id=(command->>'group')::uuid and business_id=business and demo=data_mode and account_id=account.id;
  if g.id is null then raise exception 'Grouped match unavailable in this account and data mode';end if;
  if not exists(select 1 from public.billing_bank_group_active where group_id=g.id) then raise exception using errcode='40001',message='This grouped match was already removed';end if;
  delete from public.billing_bank_group_active where group_id=g.id;reason=btrim(command->>'reason');
 end if;
 result=jsonb_build_object('group',public.billing_bank_group_json(g.id),'reason',reason,'replayed',false,'fundsMovedByFolio',false,'journalsPosted',false);
 insert into public.billing_bank_audit(business_id,demo,command_id,actor_id,action,details) values(business,data_mode,command_id,auth.uid(),action,result);
 insert into public.billing_bank_group_outbox(business_id,demo,command_id,kind,payload) values(business,data_mode,command_id,case when action='match-group' then 'matched' else 'unmatched' end,result);
 insert into public.billing_bank_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),command,result);
 return result;
end $$;
create function public.billing_bank_group_read(business uuid,data_mode boolean,account_id uuid,from_date date,to_date date,group_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_ledger_configs;lines jsonb;entries jsonb;groups jsonb;selected jsonb=null;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Bank reconciliation unavailable in this business';end if;
 if data_mode is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a valid grouped review date range';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if config.business_id is null then raise exception 'Configure the ledger first';end if;
 if not exists(select 1 from public.billing_ledger_accounts where id=account_id and business_id=business and demo=data_mode and type='asset') then raise exception 'Choose an asset account in this business and data mode';end if;
 select coalesce(jsonb_agg(to_jsonb(l) order by date,id),'[]') into lines from(select l.id,l.date,l.description,l.reference,l.debit::text,l.credit::text from public.billing_bank_lines l where l.business_id=business and l.demo=data_mode and l.account_id=billing_bank_group_read.account_id and l.date between from_date and to_date and not exists(select 1 from public.billing_bank_matches m where m.line_id=l.id) and not exists(select 1 from public.billing_bank_group_lines x join public.billing_bank_group_active a on a.group_id=x.group_id where x.line_id=l.id) order by l.date,l.id limit 501)l;
 select coalesce(jsonb_agg(to_jsonb(e) order by date,batch_id,line),'[]') into entries from(select e.batch_id,e.line,b.date,b.number,b.description,e.debit::text,e.credit::text from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and e.account_id=billing_bank_group_read.account_id and b.date between from_date and to_date and not exists(select 1 from public.billing_bank_matches m where m.batch_id=e.batch_id and m.entry_line=e.line) and not exists(select 1 from public.billing_bank_group_entries x join public.billing_bank_group_active a on a.group_id=x.group_id where x.batch_id=e.batch_id and x.entry_line=e.line) order by b.date,e.batch_id,e.line limit 501)e;
 if jsonb_array_length(lines)>500 or jsonb_array_length(entries)>500 then raise exception 'Grouped review exceeds 500 statement or ledger entries. Choose a narrower date range; no partial group choices are shown';end if;
 select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('amount',g.amount::text) order by created_at,id),'[]') into groups from(select g.id,g.account_id,g.amount,g.created_at,g.actor_id,(select count(*) from public.billing_bank_group_lines x where x.group_id=g.id) line_count,(select count(*) from public.billing_bank_group_entries x where x.group_id=g.id) entry_count from public.billing_bank_match_groups g join public.billing_bank_group_active a on a.group_id=g.id where g.business_id=business and g.demo=data_mode and g.account_id=billing_bank_group_read.account_id and exists(select 1 from public.billing_bank_group_lines x join public.billing_bank_lines l on l.id=x.line_id where x.group_id=g.id and l.date between from_date and to_date) order by g.created_at,g.id limit 101)g;
 if jsonb_array_length(groups)>100 then raise exception 'More than 100 grouped matches. Choose a narrower date range';end if;
 if group_id is not null then if not exists(select 1 from public.billing_bank_match_groups g where g.id=group_id and g.business_id=business and g.demo=data_mode and g.account_id=billing_bank_group_read.account_id) then raise exception using errcode='P0002',message='Grouped match unavailable in this account';end if;selected=public.billing_bank_group_json(group_id);end if;
 return jsonb_build_object('businessId',business,'demo',data_mode,'accountId',account_id,'currency',config.currency,'from',from_date,'to',to_date,'canWrite',public.billing_can_access(business,true),'lines',lines,'entries',entries,'groups',groups,'selected',selected,'fundsMovedByFolio',false,'journalsPosted',false,'scope','Current reconciliation decisions over immutable statement/ledger entries in the selected date range. A grouped link is an explicit review decision, not accountant certification or bank-feed verification. Opposite cash directions cannot be netted.');
end $$;
-- Immutable reviewed history; current occupancy is a private command projection.
create trigger bank_group_history before update or delete on public.billing_bank_match_groups for each row execute function public.billing_ledger_immutable();
create trigger bank_group_lines_history before update or delete on public.billing_bank_group_lines for each row execute function public.billing_ledger_immutable();
create trigger bank_group_entries_history before update or delete on public.billing_bank_group_entries for each row execute function public.billing_ledger_immutable();
create trigger bank_group_outbox_history before update or delete on public.billing_bank_group_outbox for each row execute function public.billing_ledger_immutable();
alter table public.billing_bank_match_groups enable row level security;alter table public.billing_bank_group_lines enable row level security;alter table public.billing_bank_group_entries enable row level security;alter table public.billing_bank_group_active enable row level security;alter table public.billing_bank_group_outbox enable row level security;
revoke all on public.billing_bank_match_groups,public.billing_bank_group_lines,public.billing_bank_group_entries,public.billing_bank_group_active,public.billing_bank_group_outbox from public,anon,authenticated;
grant select on public.billing_bank_match_groups,public.billing_bank_group_lines,public.billing_bank_group_entries to authenticated;
create policy bank_group_read on public.billing_bank_match_groups for select to authenticated using(public.billing_can_access(business_id));
create policy bank_group_line_read on public.billing_bank_group_lines for select to authenticated using(exists(select 1 from public.billing_bank_match_groups g where g.id=group_id and public.billing_can_access(g.business_id)));
create policy bank_group_entry_read on public.billing_bank_group_entries for select to authenticated using(exists(select 1 from public.billing_bank_match_groups g where g.id=group_id and public.billing_can_access(g.business_id)));
revoke all on function public.billing_bank_group_legacy_guard(),public.billing_bank_group_json(uuid),public.billing_bank_group_command(uuid,boolean,uuid,jsonb),public.billing_bank_group_read(uuid,boolean,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function public.billing_bank_group_command(uuid,boolean,uuid,jsonb),public.billing_bank_group_read(uuid,boolean,uuid,date,date,uuid) to authenticated;

create or replace function public.billing_bank_read(business uuid,data_mode boolean,account_id uuid,from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 select coalesce(jsonb_agg(to_jsonb(l) order by date,id),'[]'::jsonb) into lines from(select l.id,l.import_id,l.source_line,l.date,l.description,l.reference,l.debit::text,l.credit::text,l.reported_balance::text,m.batch_id,m.entry_line,(select x.group_id from public.billing_bank_group_lines x join public.billing_bank_group_active a on a.group_id=x.group_id where x.line_id=l.id) match_group from public.billing_bank_lines l left join public.billing_bank_matches m on m.line_id=l.id where l.business_id=business and l.demo=data_mode and l.account_id=billing_bank_read.account_id and l.date between from_date and to_date order by l.date,l.id limit 501)l;
 if jsonb_array_length(lines)>500 then raise exception 'More than 500 statement lines in this range. Choose a narrower date range';end if;
 return jsonb_build_object('configured',true,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'accounts',accounts,'imports',imports,'lines',lines,'importsTruncated',(select count(*)>100 from public.billing_bank_imports i where i.business_id=business and i.demo=data_mode and i.account_id=billing_bank_read.account_id));
end $$;
create or replace function public.billing_bank_candidates(business uuid,data_mode boolean,line_id uuid,from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare statement public.billing_bank_lines;entries jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Business reconciliation unavailable';end if;
 if data_mode is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a valid candidate date range';end if;
 select * into statement from public.billing_bank_lines where id=line_id and business_id=business and demo=data_mode;
 if statement.id is null then raise exception 'Statement line unavailable';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by date,batch_id,line),'[]'::jsonb) into entries from(select e.batch_id,e.line,b.date,b.number,b.description,e.debit::text,e.credit::text from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and e.account_id=statement.account_id and e.debit-e.credit=statement.debit-statement.credit and b.date between from_date and to_date and not exists(select 1 from public.billing_bank_matches m where m.batch_id=e.batch_id and m.entry_line=e.line) and not exists(select 1 from public.billing_bank_group_entries x join public.billing_bank_group_active a on a.group_id=x.group_id where x.batch_id=e.batch_id and x.entry_line=e.line) order by b.date,e.batch_id,e.line limit 101)q;
 if jsonb_array_length(entries)>100 then raise exception 'More than 100 matching candidates. Narrow the ledger date range';end if;
 return jsonb_build_object('lineId',statement.id,'candidates',entries);
end $$;

notify pgrst,'reload schema';
