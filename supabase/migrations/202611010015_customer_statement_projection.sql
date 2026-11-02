-- One posted-sequence ceiling for AR allocation AND customer-refund projections.
-- No receipt is rewritten and no refund is masqueraded as incoming cash.
create view public.billing_customer_refund_report with(security_invoker=true,security_barrier=true) as
 select f.id,f.business_id,f.demo,'customer-refunds'::text as collection,false as archived,
 f.snapshot||jsonb_build_object('kind',f.kind,'number',f.number,'date',f.date,'amount',f.amount::text,'documentId',f.snapshot->>'parentDocumentId','clientId',f.party_id,'refundId',f.id,'reversalOf',f.reverses_id,'sourceId',f.source_id,'sourceKind',f.source_kind) as data
 from public.billing_refund_events f where f.source_kind='customer-credit-note';
revoke all on public.billing_customer_refund_report from public,anon,authenticated;
grant select on public.billing_customer_refund_report to authenticated;
create or replace function public.billing_cash_report_page(business uuid,data_mode boolean,after_id uuid default null,snapshot_number bigint default null,page_size integer default 500) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ceiling bigint;current_ceiling bigint;rows jsonb;next_id uuid=null;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='AR settlement report unavailable in this business';end if;
 if data_mode is null or page_size is null or page_size not between 1 and 500 or after_id is not null and snapshot_number is null then raise exception 'Choose a complete allocation report cursor';end if;
 select next_number-1 into current_ceiling from public.billing_ledger_configs where business_id=business and demo=data_mode;
 current_ceiling=coalesce(current_ceiling,0);ceiling=coalesce(snapshot_number,current_ceiling);
 if ceiling<0 or ceiling>current_ceiling then raise exception 'Allocation report snapshot is invalid';end if;
 if after_id is not null and not exists(
  select 1 from public.billing_cash_allocation_report v join public.billing_cash_allocations a on a.id=v.id join public.billing_ledger_batches j on j.id=a.batch_id where v.business_id=business and v.demo=data_mode and v.id=after_id and substring(j.number from '([0-9]+)$')::bigint<=ceiling
  union all select 1 from public.billing_customer_refund_report v join public.billing_refund_events f on f.id=v.id join public.billing_ledger_batches j on j.id=f.batch_id where v.business_id=business and v.demo=data_mode and v.id=after_id and substring(j.number from '([0-9]+)$')::bigint<=ceiling
 ) then raise exception 'Allocation report cursor is invalid for this scope';end if;
 with eligible as(
 select to_jsonb(v) as row_data,v.id,substring(j.number from '([0-9]+)$')::bigint as sequence from public.billing_cash_allocation_report v join public.billing_cash_allocations a on a.id=v.id join public.billing_ledger_batches j on j.id=a.batch_id where v.business_id=business and v.demo=data_mode
 union all select to_jsonb(v),v.id,substring(j.number from '([0-9]+)$')::bigint from public.billing_customer_refund_report v join public.billing_refund_events f on f.id=v.id join public.billing_ledger_batches j on j.id=f.batch_id where v.business_id=business and v.demo=data_mode
 ),page as(select * from eligible where sequence<=ceiling and (after_id is null or id>after_id) order by id limit page_size+1)
 select coalesce(jsonb_agg(row_data order by id),'[]'::jsonb) into rows from page;
 if jsonb_array_length(rows)>page_size then next_id=(rows->(page_size-1)->>'id')::uuid;rows=rows-page_size;end if;
 return jsonb_build_object('businessId',business,'demo',data_mode,'snapshot',ceiling::text,'rows',rows,'next',next_id);
end$$;
notify pgrst,'reload schema';
