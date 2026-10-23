-- Enforce invoice links even for direct authenticated PostgREST writes.
create or replace function public.billing_adjustment_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent public.billing_records;
begin
 if new.collection<>'documents' then return new; end if;
 if tg_op='UPDATE' and old.data->>'type' in ('credit-note','debit-note') and
   (new.data->>'type' is distinct from old.data->>'type' or new.data->>'originalDocumentId' is distinct from old.data->>'originalDocumentId')
 then raise exception 'An adjustment cannot change type or parent invoice'; end if;
 if new.data->>'type' in ('credit-note','debit-note') then
  select * into parent from public.billing_records where id=(new.data->>'originalDocumentId')::uuid for update;
  if parent.id is null or parent.collection<>'documents' or parent.business_id<>new.business_id or parent.demo<>new.demo
    or parent.archived or not coalesce(parent.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
    or not coalesce(parent.data->>'status' in ('sent','paid'),false)
  then raise exception 'Adjustment requires an issued invoice in the same business'; end if;
  if new.data->>'currency' is distinct from parent.data->>'currency'
    or new.data->>'originalDocumentNumber' is distinct from parent.data->>'number'
    or new.data->>'originalDocumentDate' is distinct from parent.data->>'date'
    or new.data->'buyer' is distinct from parent.data->'buyer'
    or new.data->'seller' is distinct from parent.data->'seller'
  then raise exception 'Adjustment currency, parties and reference must match its invoice'; end if;
  if not coalesce(new.data->>'status' in ('draft','sent','cancelled'),false)
    or nullif(btrim(new.data->>'adjustmentReason'),'') is null
    or not coalesce((new.data->>'date')::date >= (parent.data->>'date')::date,false)
    or not coalesce((new.data->'totals'->>'total')::numeric>0,false)
  then raise exception 'Invalid adjustment details'; end if;
 end if;
 if tg_op='UPDATE' and exists(select 1 from public.billing_records r where r.business_id=new.business_id and r.collection='documents'
   and r.data->>'originalDocumentId'=new.id::text and not r.archived and r.data->>'status'<>'cancelled') then
  if new.archived or new.data->>'status' not in ('sent','paid') or new.data->>'type' is distinct from old.data->>'type'
    or new.data->>'currency' is distinct from old.data->>'currency' or new.data->>'number' is distinct from old.data->>'number'
    or new.data->>'date' is distinct from old.data->>'date' or new.data->'buyer' is distinct from old.data->'buyer' or new.data->'seller' is distinct from old.data->'seller'
  then raise exception 'Cancel or archive adjustment notes before changing the invoice reference'; end if;
 end if;
 return new;
end $$;
create trigger billing_adjustment_guard before insert or update on public.billing_records
for each row execute function public.billing_adjustment_guard();

create or replace function public.billing_create_adjustment(source_id uuid,source_version integer,document_data jsonb)
returns public.billing_records language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records; number text;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true)
   or source.version is distinct from source_version or not coalesce(source.data->>'type' in ('invoice','gst-invoice','commercial-invoice'),false)
   or not coalesce(source.data->>'status' in ('sent','paid'),false) then raise exception 'Invoice unavailable or changed'; end if;
 if not coalesce(document_data->>'type' in ('credit-note','debit-note'),false)
   or document_data->>'originalDocumentId' is distinct from source.id::text or document_data->>'status' is distinct from 'draft'
 then raise exception 'Invalid adjustment'; end if;
 number=(case when document_data->>'type'='credit-note' then 'CN-' else 'DN-' end)||public.billing_next_document_number(source.business_id);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number),source.demo,auth.uid()) returning * into result;
 update public.billing_records set data=data||jsonb_build_object('lastAdjustmentId',result.id) where id=source.id;
 return result;
end $$;
revoke all on function public.billing_create_adjustment(uuid,integer,jsonb) from public,anon;
grant execute on function public.billing_create_adjustment(uuid,integer,jsonb) to authenticated;
create index billing_adjustment_parent on public.billing_records(business_id,(data->>'originalDocumentId')) where collection='documents';
notify pgrst,'reload schema';
