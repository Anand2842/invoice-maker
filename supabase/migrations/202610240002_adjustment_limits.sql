-- Serialized on the parent invoice, so concurrent credits cannot over-adjust it.
create or replace function public.billing_adjustment_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent public.billing_records; credits numeric; debits numeric;
begin
 if new.collection<>'documents' then return new; end if;
 if new.data->>'type' in ('credit-note','debit-note') then
  select * into parent from public.billing_records where id=(new.data->>'originalDocumentId')::uuid for update;
  if new.data->>'status'='sent' and new.data->>'adjustmentReason'='Review and enter the reason for this adjustment' then raise exception 'Enter the adjustment reason before issuing'; end if;
  select coalesce(sum((r.data->'totals'->>'total')::numeric) filter(where r.data->>'type'='credit-note'),0),
    coalesce(sum((r.data->'totals'->>'total')::numeric) filter(where r.data->>'type'='debit-note'),0)
  into credits,debits from public.billing_records r where r.business_id=new.business_id and r.id<>new.id
    and r.data->>'originalDocumentId'=parent.id::text and not r.archived and r.data->>'status'='sent';
  if not new.archived and new.data->>'status'='sent' then
   if new.data->>'type'='credit-note' then credits=credits+(new.data->'totals'->>'total')::numeric;
   else debits=debits+(new.data->'totals'->>'total')::numeric; end if;
  end if;
  if credits>(parent.data->'totals'->>'total')::numeric+debits then raise exception 'Issued credits cannot exceed invoice plus issued debit notes'; end if;
 elsif tg_op='UPDATE' then
  select coalesce(sum((r.data->'totals'->>'total')::numeric) filter(where r.data->>'type'='credit-note'),0),
    coalesce(sum((r.data->'totals'->>'total')::numeric) filter(where r.data->>'type'='debit-note'),0)
  into credits,debits from public.billing_records r where r.business_id=new.business_id
    and r.data->>'originalDocumentId'=new.id::text and not r.archived and r.data->>'status'='sent';
  if credits>(new.data->'totals'->>'total')::numeric+debits then raise exception 'Invoice amount cannot fall below its issued adjustments'; end if;
 end if;
 return new;
end $$;
create trigger billing_adjustment_limit before insert or update on public.billing_records
for each row execute function public.billing_adjustment_limit();
notify pgrst,'reload schema';
