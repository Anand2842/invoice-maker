-- A source record is locked while its draft is created and schedule/stage advances.
create or replace function public.billing_generate_document(source_id uuid,source_version integer,document_data jsonb,next_date date default null)
returns public.billing_records language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or not public.billing_can_access(source.business_id,true) or source.archived then raise exception 'Record unavailable'; end if;
 if source.version is distinct from source_version then raise exception 'Record changed'; end if;
 if document_data->>'sourceRecord' is distinct from source.id::text or document_data->>'status' is distinct from 'draft' then raise exception 'Invalid generated document'; end if;
 if not coalesce(((source.collection='leads' and document_data->>'type'='quotation')
   or (source.collection='documents' and source.data->>'type'='quotation' and document_data->>'type'='invoice')
   or (source.collection='subscriptions' and source.data->>'status'='Active' and document_data->>'type'='invoice' and next_date>(source.data->>'nextDate')::date)),false)
 then raise exception 'Invalid workflow'; end if;
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data,source.demo,auth.uid()) returning * into result;
 if source.collection='subscriptions' then
  update public.billing_records set data=data||jsonb_build_object('nextDate',next_date,'lastDocumentId',result.id) where id=source.id;
 elsif source.collection='leads' then
  update public.billing_records set data=data||jsonb_build_object('status','Proposal','lastDocumentId',result.id) where id=source.id;
 else
  update public.billing_records set data=data||jsonb_build_object('lastDocumentId',result.id) where id=source.id;
 end if;
 return result;
end
$$;
revoke all on function public.billing_generate_document(uuid,integer,jsonb,date) from public,anon;
grant execute on function public.billing_generate_document(uuid,integer,jsonb,date) to authenticated;
notify pgrst,'reload schema';

-- Immutable IDs keep references and audit history stable.
create or replace function public.billing_record_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.business_id is distinct from old.business_id or new.collection is distinct from old.collection or new.created_by is distinct from old.created_by or new.demo is distinct from old.demo then raise exception 'Record identity cannot be changed';end if;
  new.version=old.version+1;new.created_at=old.created_at;
 else new.version=1;end if;
 new.updated_at=now();return new;
end $$;
create or replace function public.billing_profile_stamp() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then raise exception 'Business identity cannot be changed';end if;
 new.updated_at=now();new.profile_version=old.profile_version+1;return new;
end $$;
notify pgrst,'reload schema';

create or replace function public.billing_duplicate_document(source_id uuid,source_version integer,document_data jsonb) returns public.billing_records
language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records; number text;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true) then raise exception 'Document unavailable';end if;
 if source.version is distinct from source_version then raise exception 'Document changed';end if;
 number=public.billing_next_document_number(source.business_id);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number,'status','draft'),source.demo,auth.uid()) returning * into result;
 return result;
end $$;
