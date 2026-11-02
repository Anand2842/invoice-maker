-- Resolve one exact bill without the recent-list limit. Historical immutable
-- bills remain reachable from statements, including archived vendor contacts.
create function public.billing_vendor_bill_detail(business uuid,data_mode boolean,bill_id uuid,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare bill public.billing_vendor_bills;config public.billing_ledger_configs;bill_json jsonb;vendors jsonb;accounts jsonb;payments jsonb;total numeric;overdue numeric;bill_count bigint;balance numeric;reversed date;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Vendor bill unavailable in this business';end if;
 if data_mode is null or bill_id is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid bill and payables date';end if;
 select * into bill from public.billing_vendor_bills b where b.id=bill_id and b.business_id=business and b.demo=data_mode;
 if bill.id is null then raise exception using errcode='P0002',message='Vendor bill unavailable in this business and data mode';end if;
 select * into config from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name') order by data->>'name',id),'[]'::jsonb) into vendors from (
  select id,data from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived and id=bill.vendor_id
  union all select id,data from (select id,data from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived and id<>bill.vendor_id order by data->>'name',id limit 500)other_vendors
 )v;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode and (type='expense' or (type='asset' and code not in ('1000','1100','1300','1400','1450')));
 select count(*) into bill_count from public.billing_vendor_bills b where b.business_id=business and b.demo=data_mode;
 with balances as(
  select e.bill_id,sum(e.charge-e.credit) as balance from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.date<=as_of group by e.bill_id
 )select coalesce(sum(x.balance),0),coalesce(sum(x.balance) filter(where (b.data->>'dueDate')::date<as_of),0) into total,overdue from balances x join public.billing_vendor_bills b on b.id=x.bill_id;
 select coalesce(sum(e.charge-e.credit),0) into balance from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.bill_id=bill.id and e.date<=as_of;
 select date into reversed from public.billing_ledger_batches r where r.reverses_id=bill.issued_batch;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('amount',p.amount::text,'number',j.number,'reversalDate',r.date,'reversalId',r.id) order by p.date,p.created_at,p.id),'[]'::jsonb) into payments from public.billing_vendor_payments p join public.billing_ledger_batches j on j.id=p.batch_id left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.bill_id=bill.id;
 bill_json=to_jsonb(bill)||jsonb_build_object('balance',balance::text,'reversalDate',reversed,'payments',payments);
 return jsonb_build_object('configured',config.business_id is not null,'currency',config.currency,'canWrite',public.billing_can_access(business,true),'asOf',as_of,'bills',jsonb_build_array(bill_json),'vendors',vendors,'accounts',accounts,'totalDue',total::text,'overdue',overdue::text,'billCount',bill_count,'billsTruncated',false,'detailOnly',true,'vendorsTruncated',(select count(*)>500 from public.billing_records where business_id=business and demo=data_mode and collection='vendors' and not archived),'paymentAccounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code)),'[]'::jsonb) from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='1000' and type='asset'),'settlementsAvailable',true);
end$$;
revoke all on function public.billing_vendor_bill_detail(uuid,boolean,uuid,date) from public,anon,authenticated;
grant execute on function public.billing_vendor_bill_detail(uuid,boolean,uuid,date) to authenticated;
notify pgrst,'reload schema';
