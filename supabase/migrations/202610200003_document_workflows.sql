-- A source record is locked while its draft is created and schedule/stage advances.
create function public.billing_generate_document(source_id uuid,source_version integer,document_data jsonb,next_date date default null)
returns public.billing_records language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or not public.billing_can_access(source.business_id,true) or source.archived then raise exception 'Record unavailable'; end if;
 if source.version<>source_version then raise exception 'Record changed'; end if;
 if document_data->>'sourceRecord'<>source.id::text or document_data->>'status'<>'draft' then raise exception 'Invalid generated document'; end if;
 if not ((source.collection='leads' and document_data->>'type'='quotation')
   or (source.collection='documents' and source.data->>'type'='quotation' and document_data->>'type'='invoice')
   or (source.collection='subscriptions' and source.data->>'status'='Active' and document_data->>'type'='invoice' and next_date>(source.data->>'nextDate')::date))
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
