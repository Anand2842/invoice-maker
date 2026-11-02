-- Manual single-bill payment records, with balanced AP/cash postings. No funds movement.
create table public.billing_vendor_payments(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,
 bill_id uuid not null,date date not null,amount numeric(18,2) not null check(amount>0 and amount<=10000000000),
 account_id uuid not null,data jsonb not null,batch_id uuid not null unique,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(bill_id,business_id,demo) references public.billing_vendor_bills(id,business_id,demo),
 foreign key(batch_id,business_id,demo) references public.billing_ledger_batches(id,business_id,demo),
 foreign key(account_id,business_id,demo) references public.billing_ledger_accounts(id,business_id,demo)
);
create index vendor_payment_bill on public.billing_vendor_payments(business_id,demo,bill_id,date,id);
alter table public.billing_vendor_payments enable row level security;
revoke all on public.billing_vendor_payments from public,anon,authenticated;
grant select on public.billing_vendor_payments to authenticated;
create policy vendor_payment_read on public.billing_vendor_payments for select to authenticated using(public.billing_can_access(business_id));
create trigger vendor_payment_immutable before update or delete on public.billing_vendor_payments for each row execute function public.billing_ledger_immutable();

-- Reversing a paid bill first would create negative AP between the two reversals.
-- Enforce this for every entry point, including the general ledger reversal command.
create function public.billing_vendor_reversal_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare bill uuid;
begin
 if new.reverses_id is not null then
  select id into bill from public.billing_vendor_bills where issued_batch=new.reverses_id;
  if bill is not null and exists(select 1 from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.bill_id=bill and (r.id is null or r.date>new.date)) then raise exception 'Reverse every vendor payment first; bill reversal date must be on or after all payment reversals';end if;
 end if;
 return new;
end$$;
create trigger vendor_reversal_guard before insert on public.billing_ledger_batches for each row execute function public.billing_vendor_reversal_guard();
revoke all on function public.billing_vendor_reversal_guard() from public,anon,authenticated;

create function public.billing_vendor_bill_pay(business uuid,data_mode boolean,bill_id uuid,expected_version integer,command_id uuid,payment_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare bill public.billing_vendor_bills;config public.billing_ledger_configs;prior public.billing_ledger_batches;payment public.billing_vendor_payments;
 request jsonb;result jsonb;day date;amount numeric;paid numeric;latest date;cash uuid;payable uuid;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot record vendor payments in this business';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or bill_id is null or expected_version is null or expected_version<1 or command_id is null or jsonb_typeof(payment_data) is distinct from 'object' or (payment_data-array['date','amount','accountId','method','reference','notes'])<>'{}'::jsonb then raise exception 'Invalid vendor payment command';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 if config.business_id is null then raise exception 'Configure the ledger first';end if;
 request=jsonb_build_object('action','vendor-bill.pay','billId',bill_id,'version',expected_version,'payment',payment_data);
 select * into prior from public.billing_ledger_batches b where b.business_id=business and b.demo=data_mode and b.command_id=billing_vendor_bill_pay.command_id;
 if prior.id is not null then
  if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different vendor payment command';end if;
  select * into payment from public.billing_vendor_payments where batch_id=prior.id;
  if payment.id is null then raise exception 'Vendor payment journal confirmation is inconsistent';end if;
  return jsonb_build_object('payment',to_jsonb(payment)||jsonb_build_object('amount',payment.amount::text),'journal',public.billing_ledger_batch_json(prior.id),'replayed',true);
 end if;
 select * into bill from public.billing_vendor_bills where id=bill_id and business_id=business and demo=data_mode and status='issued';
 if bill.id is null then raise exception 'Choose an issued bill in this business and data mode';end if;
 if bill.version<>expected_version then raise exception using errcode='40001',message='Vendor bill changed; reload before recording a payment';end if;
 if exists(select 1 from public.billing_ledger_batches where reverses_id=bill.issued_batch) then raise exception 'This bill is reversed; no new payment can be recorded';end if;
 day=public.billing_payment_date(payment_data->'date');amount=public.billing_ledger_amount(payment_data->'amount');
 if day<(bill.data->>'date')::date or amount<=0 then raise exception 'Payment must be positive and cannot predate its bill';end if;
 -- Explicitly supported history: new payments cannot precede an existing settlement event.
 select greatest(max(p.date),max(r.date)),coalesce(sum(p.amount) filter(where r.id is null),0) into latest,paid from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.bill_id=bill.id;
 if latest is not null and day<latest then raise exception 'Payment date cannot precede the latest payment or payment reversal for this bill';end if;
 if amount>(bill.data->>'total')::numeric-paid then raise exception 'Payment exceeds the remaining bill balance';end if;
 if jsonb_typeof(payment_data->'accountId') is distinct from 'string' or coalesce(payment_data->>'accountId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose the cash and bank account';end if;
 select id into cash from public.billing_ledger_accounts where id=(payment_data->>'accountId')::uuid and business_id=business and demo=data_mode and code='1000' and type='asset';
 select id into payable from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 if cash is null or payable is null then raise exception 'Vendor payments require the cash and bank (1000) and accounts payable (2000) control accounts';end if;
 if jsonb_typeof(payment_data->'method') is distinct from 'string' or length(btrim(payment_data->>'method')) not between 1 and 80 or jsonb_typeof(payment_data->'reference') is distinct from 'string' or length(payment_data->>'reference')>180 or jsonb_typeof(payment_data->'notes') is distinct from 'string' or length(payment_data->>'notes')>1000 then raise exception 'Enter a payment method, reference (up to 180 characters) and notes (up to 1000)';end if;
 result=public.billing_ledger_commit(business,data_mode,command_id,request,jsonb_build_object('date',day,'kind','manual','description','Vendor payment '||(bill.data->>'number'),'entries',jsonb_build_array(jsonb_build_object('account_id',payable,'debit',amount::text,'credit','0'),jsonb_build_object('account_id',cash,'debit','0','credit',amount::text))));
 insert into public.billing_vendor_payments(business_id,demo,bill_id,date,amount,account_id,data,batch_id,actor_id)
 values(business,data_mode,bill.id,day,amount,cash,payment_data||jsonb_build_object('vendor',bill.data->'vendor','billNumber',bill.data->>'number','currency',config.currency),(result->'batch'->>'id')::uuid,auth.uid()) returning * into payment;
 return jsonb_build_object('payment',to_jsonb(payment)||jsonb_build_object('amount',payment.amount::text),'journal',result->'batch','replayed',false);
end$$;
create function public.billing_vendor_payment_reverse(business uuid,data_mode boolean,bill_id uuid,payment_id uuid,command_id uuid,reversal_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.billing_vendor_payments;result jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot reverse vendor payments in this business';end if;
 perform public.billing_ledger_writer_lock(business,false);
 perform 1 from public.billing_ledger_configs where business_id=business and demo=data_mode for update;
 select * into payment from public.billing_vendor_payments where id=payment_id and business_id=business and demo=data_mode and public.billing_vendor_payments.bill_id=billing_vendor_payment_reverse.bill_id;
 if payment.id is null then raise exception 'Choose a payment for this bill in this business and data mode';end if;
 result=public.billing_ledger_reverse(business,data_mode,command_id,payment.batch_id,reversal_date,reason);
 return jsonb_build_object('payment',to_jsonb(payment)||jsonb_build_object('amount',payment.amount::text),'journal',result->'batch','replayed',result->'replayed');
end$$;
revoke all on function public.billing_vendor_bill_pay(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_vendor_payment_reverse(uuid,boolean,uuid,uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.billing_vendor_bill_pay(uuid,boolean,uuid,integer,uuid,jsonb),public.billing_vendor_payment_reverse(uuid,boolean,uuid,uuid,uuid,date,text) to authenticated;

create or replace function public.billing_vendor_bills_read(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_ledger_configs;rows jsonb;vendors jsonb;accounts jsonb;total numeric;overdue numeric;bill_count integer;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Vendor bills unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid payables date';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name') order by data->>'name',id),'[]'::jsonb) into vendors from (select id,data from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived order by data->>'name',id limit 500)v;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode and (type='expense' or (type='asset' and code not in ('1000','1100','1300','1400','1450')));
 select count(*),coalesce(sum((data->>'total')::numeric-coalesce((select sum(p.amount) from public.billing_vendor_payments p where p.bill_id=b.id and p.date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=p.batch_id and r.date<=as_of)),0)) filter(where b.status='issued' and (b.data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of)),0),coalesce(sum((data->>'total')::numeric-coalesce((select sum(p.amount) from public.billing_vendor_payments p where p.bill_id=b.id and p.date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=p.batch_id and r.date<=as_of)),0)) filter(where b.status='issued' and (b.data->>'date')::date<=as_of and (b.data->>'dueDate')::date<as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of)),0) into bill_count,total,overdue from public.billing_vendor_bills b where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('balance',case when status='issued' and (data->>'date')::date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=as_of) then ((data->>'total')::numeric-coalesce((select sum(p.amount) from public.billing_vendor_payments p where p.bill_id=b.id and p.date<=as_of and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=p.batch_id and r.date<=as_of)),0))::text else '0' end,'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('amount',p.amount::text,'number',j.number,'reversalDate',r.date,'reversalId',r.id) order by p.date,p.created_at,p.id) from public.billing_vendor_payments p join public.billing_ledger_batches j on j.id=p.batch_id left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.bill_id=b.id),'[]'::jsonb),'reversalDate',(select r.date from public.billing_ledger_batches r where r.reverses_id=b.issued_batch)) order by created_at desc,id desc),'[]'::jsonb) into rows from (select * from public.billing_vendor_bills where business_id=business and demo=data_mode order by created_at desc,id desc limit 500)b;
 return jsonb_build_object('configured',config.business_id is not null,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'asOf',as_of,'bills',rows,'vendors',vendors,'accounts',accounts,'totalDue',total::text,'overdue',overdue::text,'billCount',bill_count,'billsTruncated',bill_count>500,'vendorsTruncated',(select count(*)>500 from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived),'paymentAccounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code)),'[]'::jsonb) from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1000' and type='asset'),'settlementsAvailable',true);
end$$;
notify pgrst,'reload schema';
