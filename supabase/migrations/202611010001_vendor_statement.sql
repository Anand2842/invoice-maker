-- Read-only, dated AP statements over explicit vendor-bill/payment journals.
-- No legacy expense/PO/manual-AP interpretation and no data backfill.
create index billing_vendor_bills_vendor on public.billing_vendor_bills(business_id,demo,vendor_id,id);
create view public.billing_vendor_statement_events with(security_barrier=true) as
 select b.business_id,b.demo,b.vendor_id,b.id as bill_id,j.id as batch_id,j.date,
 substring(j.number from '([0-9]+)$')::bigint as sequence,j.number,'bill'::text as kind,
 b.data->>'number' as reference,(b.data->>'total')::numeric as charge,0::numeric as credit
 from public.billing_vendor_bills b join public.billing_ledger_batches j on j.id=b.issued_batch
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'bill-reversal',
 b.data->>'number',0::numeric,(b.data->>'total')::numeric
 from public.billing_vendor_bills b join public.billing_ledger_batches j on j.reverses_id=b.issued_batch
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'payment',
 coalesce(nullif(p.data->>'reference',''),b.data->>'number'),0::numeric,p.amount
 from public.billing_vendor_payments p join public.billing_vendor_bills b on b.id=p.bill_id join public.billing_ledger_batches j on j.id=p.batch_id
 union all
 select b.business_id,b.demo,b.vendor_id,b.id,j.id,j.date,substring(j.number from '([0-9]+)$')::bigint,j.number,'payment-reversal',
 coalesce(nullif(p.data->>'reference',''),b.data->>'number'),p.amount,0::numeric
 from public.billing_vendor_payments p join public.billing_vendor_bills b on b.id=p.bill_id join public.billing_ledger_batches j on j.reverses_id=p.batch_id;
revoke all on public.billing_vendor_statement_events from public,anon,authenticated;

create function public.billing_vendor_statement(
 business uuid,data_mode boolean,vendor_id uuid,from_date date,to_date date,
 after_date date default null,after_sequence bigint default null,page_size integer default 100,snapshot_number bigint default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare vendor public.billing_records;business_name text;currency text;ceiling bigint;current_ceiling bigint;
 opening numeric;closing numeric;charges numeric;credits numeric;result_rows jsonb;next_cursor jsonb=null;aging jsonb;negative_balances integer;total_rows bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Vendor statement unavailable in this business';end if;
 if data_mode is null or vendor_id is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date then raise exception 'Choose a vendor and valid statement date range';end if;
 if page_size is null or page_size not between 1 and 200 then raise exception 'Statement page size must be between 1 and 200';end if;
 if num_nonnulls(after_date,after_sequence) not in (0,2) then raise exception 'Provide the complete vendor statement cursor';end if;
 select * into vendor from public.billing_records r where r.id=billing_vendor_statement.vendor_id and r.business_id=business and r.demo=data_mode and r.collection='vendors';
 if vendor.id is null then raise exception 'Vendor unavailable in this business and data mode';end if;
 select c.currency,c.next_number-1 into currency,current_ceiling from public.billing_ledger_configs c where c.business_id=business and c.demo=data_mode;
 if current_ceiling is null then raise exception 'Configure the ledger before generating vendor statements';end if;
 select name into business_name from public.billing_businesses where id=business;
 if after_date is not null and snapshot_number is null then raise exception 'Continue vendor statement pages with the original snapshot number';end if;
 ceiling=coalesce(snapshot_number,current_ceiling);
 if ceiling<0 or ceiling>current_ceiling then raise exception 'Statement snapshot number is outside the posted sequence';end if;
 if after_date is not null and (not isfinite(after_date) or after_date<from_date or after_date>to_date or not exists(
  select 1 from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.vendor_id=billing_vendor_statement.vendor_id and e.date=after_date and e.sequence=after_sequence and e.sequence<=ceiling
 )) then raise exception 'Statement cursor is invalid for this vendor, data mode and period';end if;
 select coalesce(sum(e.charge-e.credit) filter(where e.date<from_date),0),coalesce(sum(e.charge-e.credit),0),
 coalesce(sum(e.charge) filter(where e.date>=from_date),0),coalesce(sum(e.credit) filter(where e.date>=from_date),0),count(*) filter(where e.date>=from_date)
 into opening,closing,charges,credits,total_rows from public.billing_vendor_statement_events e
 where e.business_id=business and e.demo=data_mode and e.vendor_id=billing_vendor_statement.vendor_id and e.date<=to_date and e.sequence<=ceiling;
 with running as(
  select e.*,opening+sum(e.charge-e.credit) over(order by e.date,e.sequence rows between unbounded preceding and current row) as balance
  from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.vendor_id=billing_vendor_statement.vendor_id and e.date between from_date and to_date and e.sequence<=ceiling
 ),page as(
  select * from running where after_date is null or (date,sequence)>(after_date,after_sequence) order by date,sequence limit page_size+1
 )select coalesce(jsonb_agg(jsonb_build_object('date',date,'sequence',sequence::text,'batchId',batch_id,'number',number,'kind',kind,'reference',reference,'billId',bill_id,'charge',charge::text,'credit',credit::text,'balance',balance::text) order by date,sequence),'[]'::jsonb) into result_rows from page;
 if jsonb_array_length(result_rows)>page_size then
  next_cursor=jsonb_build_object('date',result_rows->(page_size-1)->>'date','sequence',result_rows->(page_size-1)->>'sequence','snapshot',ceiling::text);result_rows=result_rows-page_size;
 end if;
 with balances as(
  select e.bill_id,sum(e.charge-e.credit) as balance from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.vendor_id=billing_vendor_statement.vendor_id and e.date<=to_date and e.sequence<=ceiling group by e.bill_id
 ),dated as(
  select x.balance,to_date-(b.data->>'dueDate')::date as days from balances x join public.billing_vendor_bills b on b.id=x.bill_id
 )select jsonb_build_object('current',coalesce(sum(balance) filter(where days<=0),0)::text,'days1to30',coalesce(sum(balance) filter(where days between 1 and 30),0)::text,'days31to60',coalesce(sum(balance) filter(where days between 31 and 60),0)::text,'days61to90',coalesce(sum(balance) filter(where days between 61 and 90),0)::text,'daysOver90',coalesce(sum(balance) filter(where days>90),0)::text),count(*) filter(where balance<0) into aging,negative_balances from dated;
 if negative_balances>0 then raise exception 'A vendor bill has a negative balance. Review its journal history before using this statement';end if;
 return jsonb_build_object('businessId',business,'businessName',business_name,'demo',data_mode,'vendor',jsonb_build_object('id',vendor.id,'name',vendor.data->>'name','address',vendor.data->>'address','email',vendor.data->>'email','archived',vendor.archived),'currency',currency,'from',from_date,'to',to_date,'snapshotNumber',ceiling::text,'opening',opening::text,'charges',charges::text,'credits',credits::text,'closing',closing::text,'aging',aging,'totalRows',total_rows::text,'rows',result_rows,'next',next_cursor);
end$$;
revoke all on function public.billing_vendor_statement(uuid,boolean,uuid,date,date,date,bigint,integer,bigint) from public,anon,authenticated;
grant execute on function public.billing_vendor_statement(uuid,boolean,uuid,date,date,date,bigint,integer,bigint) to authenticated;
notify pgrst,'reload schema';
