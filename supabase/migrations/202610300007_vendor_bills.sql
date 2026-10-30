-- Explicit vendor bills only. POs, expenses and legacy records never create liabilities.
alter table public.billing_records add constraint billing_records_id_scope unique(id,business_id,demo);
create table public.billing_vendor_bills(
 id uuid primary key,business_id uuid not null references public.billing_businesses(id),demo boolean not null,
 vendor_id uuid not null,data jsonb not null,status text not null default 'draft' check(status in ('draft','issued')),
 version integer not null default 1 check(version>0),issued_batch uuid unique,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,business_id,demo),foreign key(vendor_id,business_id,demo) references public.billing_records(id,business_id,demo),
 foreign key(issued_batch,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),
 check((status='issued')=(issued_batch is not null))
);
create index billing_vendor_bills_scope on public.billing_vendor_bills(business_id,demo,created_at,id);
alter table public.billing_vendor_bills enable row level security;
revoke all on public.billing_vendor_bills from public,anon,authenticated;
grant select on public.billing_vendor_bills to authenticated;
create policy vendor_bill_read on public.billing_vendor_bills for select to authenticated using(public.billing_can_access(business_id));
create function public.billing_vendor_bill_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status='issued' then raise exception 'Issued vendor bills are immutable; correct the posted journal with a dated reversal';end if;
 if new.id<>old.id or new.business_id<>old.business_id or new.demo<>old.demo or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Vendor bill identity is immutable';end if;
 return new;
end$$;
create trigger vendor_bill_guard before update or delete on public.billing_vendor_bills for each row execute function public.billing_vendor_bill_guard();

create function public.billing_vendor_bill_save(business uuid,data_mode boolean,bill_id uuid,expected_version integer,bill_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.billing_vendor_bills;vendor public.billing_records;config public.billing_ledger_configs;account public.billing_ledger_accounts;
 item jsonb;items jsonb='[]';quantity numeric;rate numeric;line_total numeric;base numeric=0;tax numeric;day date;due date;normalized jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot edit vendor bills in this business';end if;
 if data_mode is null or bill_id is null or expected_version is null or expected_version<0 or jsonb_typeof(bill_data) is distinct from 'object' or (bill_data-array['vendorId','number','date','dueDate','currency','items','taxAmount','taxReviewed','accountId','notes'])<>'{}'::jsonb then raise exception 'Invalid vendor bill draft';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if config.business_id is null then raise exception 'Configure the ledger first; legacy expenses remain separate';end if;
 if coalesce(bill_data->>'vendorId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(bill_data->>'accountId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a saved vendor and posting account';end if;
 select * into vendor from public.billing_records where id=(bill_data->>'vendorId')::uuid and business_id=business and demo=data_mode and collection='vendors' and not archived for share;
 if vendor.id is null or jsonb_typeof(vendor.data->'name') is distinct from 'string' or length(btrim(vendor.data->>'name')) not between 1 and 1024 then raise exception 'Choose an active saved vendor in this business and data mode';end if;
 select * into account from public.billing_ledger_accounts where id=(bill_data->>'accountId')::uuid and business_id=business and demo=data_mode and type in ('expense','asset');
 if account.id is null then raise exception 'Choose an expense or asset account in this business and data mode';end if;
 if bill_data->>'currency' is distinct from config.currency then raise exception 'Vendor bills must use the configured ledger base currency';end if;
 day=public.billing_payment_date(bill_data->'date');due=public.billing_payment_date(bill_data->'dueDate');
 if due<day then raise exception 'Bill due date cannot precede its issue date';end if;
 if jsonb_typeof(bill_data->'number') is distinct from 'string' or length(btrim(bill_data->>'number')) not between 1 and 180 then raise exception 'Enter the vendor bill reference, up to 180 characters';end if;
 if jsonb_typeof(bill_data->'notes') is distinct from 'string' or length(bill_data->>'notes')>4096 or jsonb_typeof(bill_data->'taxReviewed') is distinct from 'boolean' then raise exception 'Enter bill notes and an explicit tax review flag';end if;
 if jsonb_typeof(bill_data->'items') is distinct from 'array' or jsonb_array_length(bill_data->'items') not between 1 and 100 then raise exception 'A vendor bill needs 1 to 100 items';end if;
 for item in select value from jsonb_array_elements(bill_data->'items') loop
  if jsonb_typeof(item) is distinct from 'object' or (item-array['name','quantity','rate'])<>'{}'::jsonb or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 500 then raise exception 'Enter an item description up to 500 characters';end if;
  quantity=public.billing_ledger_amount(item->'quantity');rate=public.billing_ledger_amount(item->'rate');if quantity<=0 then raise exception 'Item quantity must be positive';end if;
  line_total=round(quantity*rate,2);base=base+line_total;if line_total>10000000000 or base>10000000000 then raise exception 'Bill amount exceeds the supported range';end if;
  items=items||jsonb_build_array(jsonb_build_object('name',btrim(item->>'name'),'quantity',quantity::text,'rate',rate::text,'amount',line_total::text));
 end loop;
 tax=public.billing_ledger_amount(bill_data->'taxAmount');if base<=0 or base+tax>10000000000 then raise exception 'Bill total must be positive and at most 10000000000';end if;
 normalized=jsonb_build_object('vendorId',vendor.id,'number',btrim(bill_data->>'number'),'date',day,'dueDate',due,'currency',config.currency,'items',items,'taxAmount',tax::text,'taxReviewed',(bill_data->>'taxReviewed')::boolean,'accountId',account.id,'notes',bill_data->>'notes','subtotal',base::text,'total',(base+tax)::text);
 select * into existing from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode for update;
 if existing.id is null then
  if expected_version<>0 then raise exception using errcode='40001',message='Vendor bill draft is unavailable; reload the list';end if;
  insert into public.billing_vendor_bills(id,business_id,demo,vendor_id,data,created_by) values(bill_id,business,data_mode,vendor.id,normalized,auth.uid()) returning * into existing;
 else
  if existing.status<>'draft' then raise exception 'Issued vendor bills cannot be edited';end if;
  if existing.version<>expected_version then raise exception using errcode='40001',message='Vendor bill changed; reload before editing';end if;
  update public.billing_vendor_bills set vendor_id=vendor.id,data=normalized,version=version+1,updated_at=now() where id=existing.id returning * into existing;
 end if;
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'vendor-bill.draft-saved',jsonb_build_object('billId',existing.id,'version',existing.version));
 return jsonb_build_object('bill',to_jsonb(existing));
end$$;

create function public.billing_vendor_bill_issue(business uuid,data_mode boolean,bill_id uuid,expected_version integer,command_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare bill public.billing_vendor_bills;vendor public.billing_records;previous public.billing_ledger_batches;request jsonb;result jsonb;entries jsonb;payable uuid;tax_account uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot issue vendor bills in this business';end if;
 if data_mode is null or bill_id is null or command_id is null or expected_version is null or expected_version<1 then raise exception 'Invalid vendor bill issue command';end if;
 -- Every ledger writer takes this same lock before posting. Retry lookup precedes mutable draft/period checks.
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;if not found then raise exception 'Configure the ledger first; legacy expenses remain separate';end if;
 request=jsonb_build_object('action','vendor-bill.issue','billId',bill_id,'version',expected_version);
 select * into previous from public.billing_ledger_batches b where b.business_id=business and b.demo=data_mode and b.command_id=billing_vendor_bill_issue.command_id;
 if previous.id is not null then
  if previous.actor_id<>auth.uid() or previous.request-'snapshot'<>request then raise exception using errcode='40001',message='This retry key was used for a different command';end if;
  select * into bill from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode and issued_batch=previous.id;
  if bill.id is null then raise exception 'Vendor bill journal confirmation is inconsistent';end if;
  return jsonb_build_object('bill',to_jsonb(bill),'journal',public.billing_ledger_batch_json(previous.id),'replayed',true);
 end if;
 select * into bill from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode for update;
 if bill.id is null or bill.status<>'draft' then raise exception 'Choose a draft vendor bill in this business and data mode';end if;
 if bill.version<>expected_version then raise exception using errcode='40001',message='Vendor bill changed; reload before issuing';end if;
 if bill.data->>'taxReviewed'<>'true' then raise exception 'Review the aggregate tax amount before issuing';end if;
 select * into vendor from public.billing_records where id=bill.vendor_id and business_id=business and demo=data_mode and collection='vendors' and not archived for share;
 if vendor.id is null then raise exception 'Vendor is no longer active; review the draft';end if;
 select id into payable from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 select id into tax_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1300' and type='asset';
 entries=jsonb_build_array(jsonb_build_object('account_id',bill.data->>'accountId','debit',bill.data->>'subtotal','credit','0'));
 if (bill.data->>'taxAmount')::numeric>0 then entries=entries||jsonb_build_array(jsonb_build_object('account_id',tax_account,'debit',bill.data->>'taxAmount','credit','0'));end if;
 entries=entries||jsonb_build_array(jsonb_build_object('account_id',payable,'debit','0','credit',bill.data->>'total'));
 bill.data=bill.data||jsonb_build_object('vendor',jsonb_build_object('id',vendor.id,'name',vendor.data->>'name','address',vendor.data->>'address','email',vendor.data->>'email','phone',vendor.data->>'phone','gstin',vendor.data->>'gstin'));
 result=public.billing_ledger_commit(business,data_mode,command_id,request||jsonb_build_object('snapshot',bill.data),jsonb_build_object('date',bill.data->>'date','description','Vendor bill '||(bill.data->>'number'),'kind','manual','entries',entries));
 update public.billing_vendor_bills set status='issued',issued_batch=(result->'batch'->>'id')::uuid,data=bill.data,version=version+1,updated_at=now() where id=bill.id returning * into bill;
 return jsonb_build_object('bill',to_jsonb(bill),'journal',result->'batch','replayed',false);
end$$;

create function public.billing_vendor_bills_read(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_ledger_configs;rows jsonb;vendors jsonb;accounts jsonb;total numeric;overdue numeric;bill_count integer;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Vendor bills unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid payables date';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name') order by data->>'name',id),'[]'::jsonb) into vendors from (select id,data from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived order by data->>'name',id limit 500)v;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode and type in ('expense','asset');
 select count(*),coalesce(sum((data->>'total')::numeric) filter(where b.status='issued' and (b.data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of)),0),coalesce(sum((data->>'total')::numeric) filter(where b.status='issued' and (b.data->>'date')::date<=as_of and (b.data->>'dueDate')::date<as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of)),0) into bill_count,total,overdue from public.billing_vendor_bills b where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('balance',case when status='issued' and (data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of) then data->>'total' else '0' end,'reversalDate',(select r.date from public.billing_ledger_batches r where r.reverses_id=b.issued_batch)) order by created_at desc,id desc),'[]'::jsonb) into rows from (select * from public.billing_vendor_bills where business_id=business and demo=data_mode order by created_at desc,id desc limit 500)b;
 return jsonb_build_object('configured',config.business_id is not null,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'asOf',as_of,'bills',rows,'vendors',vendors,'accounts',accounts,'totalDue',total::text,'overdue',overdue::text,'billCount',bill_count,'billsTruncated',bill_count>500,'vendorsTruncated',(select count(*)>500 from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived),'settlementsAvailable',false);
end$$;
revoke all on function public.billing_vendor_bill_guard(),public.billing_vendor_bill_save(uuid,boolean,uuid,integer,jsonb),public.billing_vendor_bill_issue(uuid,boolean,uuid,integer,uuid),public.billing_vendor_bills_read(uuid,boolean,date) from public,anon,authenticated;
grant execute on function public.billing_vendor_bill_save(uuid,boolean,uuid,integer,jsonb),public.billing_vendor_bill_issue(uuid,boolean,uuid,integer,uuid),public.billing_vendor_bills_read(uuid,boolean,date) to authenticated;
notify pgrst,'reload schema';
