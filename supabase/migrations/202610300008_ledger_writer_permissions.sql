-- Lock membership changes before ledger/config locks, then recheck the current role.
-- NO KEY UPDATE remains compatible with FK KEY SHARE. Payment invoice/business lock order is unchanged.
create or replace function public.billing_ledger_writer_lock(business uuid,owner_only boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.billing_can_access(business,true) or (owner_only and not public.billing_is_owner(business)) then raise exception using errcode='42501',message='Your role cannot write to this business ledger';end if;
 perform 1 from public.billing_businesses where id=business for no key update;
 if not public.billing_can_access(business,true) or (owner_only and not public.billing_is_owner(business)) then raise exception using errcode='42501',message='Your role no longer permits this ledger action';end if;
end$$;
revoke all on function public.billing_ledger_writer_lock(uuid,boolean) from public,anon,authenticated;


create or replace function public.billing_ledger_setup(business uuid,data_mode boolean,date_start date) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.billing_businesses;c public.billing_ledger_configs;inserted integer;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can configure this ledger';end if;
 select * into b from public.billing_businesses where id=business for no key update;
 if not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can configure this ledger';end if;
 if data_mode is null or date_start is null or not isfinite(date_start) or date_start>(now() at time zone b.time_zone)::date then raise exception 'Choose a ledger start date on or before today';end if;
 if b.currency not in ('INR','USD','EUR','GBP','AUD','CAD','SGD','AED') and not exists(select 1 from public.billing_ledger_configs where business_id=business and demo=data_mode) then raise exception 'Ledger currency is not supported yet. This ledger supports INR, USD, EUR, GBP, AUD, CAD, SGD and AED with two decimal places';end if;
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

create or replace function public.billing_ledger_create_account(business uuid,data_mode boolean,account_code text,account_name text,account_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.billing_ledger_accounts;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can create ledger accounts';end if;
 perform public.billing_ledger_writer_lock(business,true);
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first';end if;
 if account_code is null or account_code!~'^[A-Za-z0-9._-]{1,30}$' or account_name is null or length(btrim(account_name)) not between 1 and 180 or account_type is null or account_type not in ('asset','liability','equity','income','expense') then raise exception 'Enter a valid account code, name and type';end if;
 insert into public.billing_ledger_accounts(business_id,demo,code,name,type) values(business,data_mode,account_code,btrim(account_name),account_type) returning * into a;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'account.created',jsonb_build_object('accountId',a.id));
 return to_jsonb(a);
end$$;

create or replace function public.billing_ledger_post(business uuid,data_mode boolean,command_id uuid,journal jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.billing_ledger_batches;request jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot post to this ledger';end if;
 perform public.billing_ledger_writer_lock(business,false);
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

create or replace function public.billing_ledger_reverse(business uuid,data_mode boolean,command_id uuid,batch_id uuid,reversal_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.billing_ledger_batches;original public.billing_ledger_batches;request jsonb;journal jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot reverse this ledger journal';end if;
 perform public.billing_ledger_writer_lock(business,false);
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

create or replace function public.billing_ledger_close(business uuid,data_mode boolean,through_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_ledger_configs;
begin
 if auth.uid() is null or not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the owner can close ledger periods';end if;
 perform public.billing_ledger_writer_lock(business,true);
 select * into c from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if c.business_id is null then raise exception 'Configure the ledger first';end if;
 if through_date is null or not isfinite(through_date) or through_date<c.start_date or through_date>(select (now() at time zone time_zone)::date from public.billing_businesses where id=business) or through_date<coalesce(c.closed_through,through_date) then raise exception 'Choose a close date within the ledger period; closed periods cannot reopen';end if;
 if c.closed_through is distinct from through_date then
  update public.billing_ledger_configs set closed_through=through_date where business_id=business and demo=data_mode;
  insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'period.closed',jsonb_build_object('through',through_date));
 end if;
 return jsonb_build_object('closed_through',through_date);
end$$;
notify pgrst,'reload schema';
