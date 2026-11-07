-- Document numbers: one series per document type, and numbers are taken only when a document is saved.
-- Invoices (tax, commercial) keep the business's invoice prefix and the counter shown in Settings. Quotations,
-- proformas, purchase orders, delivery challans and credit/debit notes each get their own series (QUO-, PRO-, PO-,
-- DC-, CN-, DN-), so creating one no longer consumes an invoice number. Sample (demo) documents use their own series.
create table public.billing_document_series(
 business_id uuid not null references public.billing_businesses(id) on delete cascade,
 demo boolean not null,
 series text not null check(series in ('invoice','quotation','proforma','purchase-order','delivery-challan','credit-note','debit-note')),
 next_number bigint not null default 1 check(next_number between 1 and 1000000000),
 primary key(business_id,demo,series));
alter table public.billing_document_series enable row level security;
revoke all on public.billing_document_series from public,anon,authenticated;

create function public.billing_document_series_of(doc_type text) returns text language sql immutable set search_path='' as $$
 select case when doc_type in ('quotation','proforma','purchase-order','delivery-challan','credit-note','debit-note') then doc_type else 'invoice' end $$;

-- consume=false previews the next number without using it (the editor shows it before saving).
create function public.billing_document_number_for(business uuid,data_mode boolean,doc_type text,consume boolean) returns text
language plpgsql security definer set search_path='' as $$
declare s text=public.billing_document_series_of(doc_type); prefix text; n bigint; candidate text; real_invoice boolean;
begin
 if not public.billing_can_access(business,consume) then raise exception 'Business unavailable';end if;
 if data_mode is null then raise exception 'Choose a data mode';end if;
 real_invoice=s='invoice' and not data_mode;
 if real_invoice then
  if consume then select invoice_prefix,invoice_next_number into prefix,n from public.billing_businesses where id=business for update;
  else select invoice_prefix,invoice_next_number into prefix,n from public.billing_businesses where id=business;end if;
 else
  prefix=case s when 'quotation' then 'QUO' when 'proforma' then 'PRO' when 'purchase-order' then 'PO' when 'delivery-challan' then 'DC' when 'credit-note' then 'CN' when 'debit-note' then 'DN' else (select invoice_prefix from public.billing_businesses where id=business) end;
  if consume then
   insert into public.billing_document_series(business_id,demo,series) values(business,data_mode,s) on conflict do nothing;
   select next_number into n from public.billing_document_series where business_id=business and demo=data_mode and series=s for update;
  else select coalesce((select next_number from public.billing_document_series where business_id=business and demo=data_mode and series=s),1) into n;end if;
 end if;
 if prefix is null then raise exception 'Business unavailable';end if;
 loop
  if n>999999999 then raise exception 'Document sequence exhausted';end if;
  candidate=prefix||'-'||lpad(n::text,greatest(6,length(n::text)),'0');
  exit when not exists(select 1 from public.billing_records where business_id=business and demo=data_mode and collection='documents' and not archived and data->>'number'=candidate);
  n=n+1;
 end loop;
 if consume then
  if real_invoice then update public.billing_businesses set invoice_next_number=n+1 where id=business;
  else update public.billing_document_series set next_number=n+1 where business_id=business and demo=data_mode and series=s;end if;
 end if;
 return candidate;
end $$;
revoke all on function public.billing_document_number_for(uuid,boolean,text,boolean) from public,anon;
grant execute on function public.billing_document_number_for(uuid,boolean,text,boolean) to authenticated;

-- A new document saved with numberAuto=true gets the next number of its series at the moment of saving,
-- even if someone else saved one since the editor showed its preview.
create function public.billing_document_auto_number() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.collection='documents' and new.data ? 'numberAuto' then
  if tg_op='INSERT' and new.data->>'numberAuto'='true' then
   new.data=jsonb_set(new.data,'{number}',to_jsonb(public.billing_document_number_for(new.business_id,new.demo,new.data->>'type',true)));
  end if;
  new.data=new.data-'numberAuto';
 end if;
 return new;
end $$;
create trigger billing_000_document_number before insert or update on public.billing_records for each row execute function public.billing_document_auto_number();

create or replace function public.billing_duplicate_document(source_id uuid,source_version integer,document_data jsonb) returns public.billing_records
language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records; number text;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true) then raise exception 'Document unavailable';end if;
 if source.version is distinct from source_version then raise exception 'Document changed';end if;
 number=public.billing_document_number_for(source.business_id,source.demo,coalesce(document_data->>'type',source.data->>'type'),true);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number,'status','draft'),source.demo,auth.uid()) returning * into result;
 return result;
end $$;

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
 number=public.billing_document_number_for(source.business_id,source.demo,case when document_data->>'type'='credit-note' then 'credit-note' else 'debit-note' end,true);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number),source.demo,auth.uid()) returning * into result;
 return result;
end $$;

create or replace function public.billing_crm_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_crm_commands;pipeline public.billing_crm_pipelines;lead public.billing_crm_leads;other public.billing_crm_leads;task public.billing_crm_tasks;legacy public.billing_records;client public.billing_records;stage public.billing_crm_stages;
 request jsonb;result jsonb;details jsonb;event jsonb;doc public.billing_records;item jsonb;stages jsonb='[]';ids uuid[];n bigint;day date;today date;zone text;key_name text;reason text;owner_user uuid;target uuid;lead_id uuid;pipeline_id uuid;stage_id uuid;expected integer;lead_amount numeric(18,2);candidate_ids jsonb;reviewed jsonb;due timestamptz;ends timestamptz;path text;kind text;source_snapshot jsonb;subaction text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot change CRM in this business';end if;
 if data_mode is null or command_id is null or action is null or action not in ('pipeline.save','pipeline.archive','capabilities','lead.save','lead.adopt','lead.archive','lead.merge','task.save','task.status','activity.add','file.attach','quote.create','client.link') or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Choose a valid versioned CRM command';end if;
 request=jsonb_build_object('action',action,'data',command_data);
 select * into prior from public.billing_crm_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_crm_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different CRM command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 if action='lead.adopt' then
  if coalesce(command_data->>'legacyRecordId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an exact legacy lead for adoption';end if;
  -- Existing legacy quote generation holds source-record -> business numbering.
  -- Adoption preserves that order and freezes the version before any CRM write.
  perform 1 from public.billing_records r where r.id=(command_data->>'legacyRecordId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='leads' for update;
 end if;
 perform 1 from public.billing_businesses where id=business for no key update;
 if not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your CRM permission changed while waiting; reload before writing';end if;
 select * into prior from public.billing_crm_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_crm_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different CRM command';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 select time_zone,(now() at time zone time_zone)::date into zone,today from public.billing_businesses where id=business;
 day=public.billing_payment_date(coalesce(command_data->'date',to_jsonb(today::text)));if day>today then raise exception 'CRM state changes cannot be future-dated; future follow-ups belong in due/meeting times';end if;
 n=public.billing_crm_next(business,data_mode);details=command_data;
 if action in ('pipeline.save','pipeline.archive','capabilities') then
  if not public.billing_crm_manage(business,data_mode) then raise exception using errcode='42501',message='A CRM manager must review pipeline or routing changes';end if;
  if action='capabilities' then
   if not public.billing_is_owner(business) then raise exception using errcode='42501',message='Only the business owner can grant CRM capabilities';end if;
   if command_data-array['userId','readAll','workAll','manage','date']<>'{}'::jsonb or coalesce(command_data->>'userId','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(command_data->'readAll') is distinct from 'boolean' or jsonb_typeof(command_data->'workAll') is distinct from 'boolean' or jsonb_typeof(command_data->'manage') is distinct from 'boolean' then raise exception 'Review explicit CRM capability flags';end if;
   target=(command_data->>'userId')::uuid;if not exists(select 1 from public.billing_members where business_id=business and user_id=target) and not exists(select 1 from public.billing_businesses where id=business and owner_id=target) then raise exception 'CRM capabilities require a current business member';end if;
   if (command_data->'workAll'='true'::jsonb or command_data->'manage'='true'::jsonb) and not public.billing_crm_writer(business,target) then raise exception 'CRM capabilities cannot bypass a read-only business role';end if;
   insert into public.billing_crm_capabilities(business_id,demo,user_id,read_all,work_all,manage,changed_by) values(business,data_mode,target,(command_data->>'readAll')::boolean,(command_data->>'workAll')::boolean,(command_data->>'manage')::boolean,auth.uid()) on conflict(business_id,demo,user_id) do update set read_all=excluded.read_all,work_all=excluded.work_all,manage=excluded.manage,changed_by=auth.uid();
   result=jsonb_build_object('userId',target,'readAll',command_data->'readAll','workAll',command_data->'workAll','manage',command_data->'manage');
  else
   if coalesce(command_data->>'pipelineId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'version','')!~'^[0-9]{1,9}$' then raise exception 'Choose a versioned pipeline';end if;pipeline_id=(command_data->>'pipelineId')::uuid;expected=(command_data->>'version')::integer;
   select * into pipeline from public.billing_crm_pipelines p where p.id=pipeline_id and p.business_id=business and p.demo=data_mode for update;
   if pipeline.id is null and expected<>0 or pipeline.id is not null and pipeline.version<>expected then raise exception using errcode='40001',message='Pipeline changed; reload before editing';end if;
   if action='pipeline.archive' then
    if command_data-array['pipelineId','version','date','reason']<>'{}'::jsonb or pipeline.id is null or not coalesce(length(btrim(command_data->>'reason')) between 1 and 1000,false) then raise exception 'Choose a pipeline and archive reason';end if;
    if exists(select 1 from public.billing_crm_leads where public.billing_crm_leads.pipeline_id=pipeline.id and not archived and canonical_id is null) then raise exception 'Move or explicitly archive every active lead before archiving its pipeline';end if;
    update public.billing_crm_pipelines set archived=true,version=version+1 where id=pipeline.id returning * into pipeline;
    select v.stages into stages from public.billing_crm_pipeline_versions v where v.pipeline_id=pipeline.id and v.version=expected;
    insert into public.billing_crm_pipeline_versions(pipeline_id,version,business_id,demo,name,stages,actor_id) values(pipeline.id,pipeline.version,business,data_mode,pipeline.name,stages,auth.uid());
    for item in select value from jsonb_array_elements(stages) loop insert into public.billing_crm_stages(pipeline_id,pipeline_version,id,business_id,demo,name,kind,position,probability) values(pipeline.id,pipeline.version,(item->>'id')::uuid,business,data_mode,item->>'name',item->>'kind',(item->>'position')::integer,(item->>'probability')::integer);end loop;

   else
    if command_data-array['pipelineId','version','name','stages','date']<>'{}'::jsonb or jsonb_typeof(command_data->'name') is distinct from 'string' or length(btrim(command_data->>'name')) not between 1 and 180 or jsonb_typeof(command_data->'stages') is distinct from 'array' or jsonb_array_length(command_data->'stages') not between 2 and 30 then raise exception 'Review a pipeline name and 2–30 typed stages';end if;
    ids=array[]::uuid[];expected=expected+1;
    for item in select value from jsonb_array_elements(command_data->'stages') loop
     if jsonb_typeof(item) is distinct from 'object' or item-array['id','name','kind','probability']<>'{}'::jsonb or coalesce(item->>'id','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 180 or coalesce(item->>'kind','') not in ('open','won','lost') or coalesce(item->>'probability','')!~'^[0-9]{1,3}$' or (item->>'probability')::integer>100 or (item->>'id')::uuid=any(ids) then raise exception 'Each pipeline stage needs a distinct ID, name, type and 0–100 probability';end if;
     if item->>'kind'='won' and (item->>'probability')::integer<>100 or item->>'kind'='lost' and (item->>'probability')::integer<>0 then raise exception 'Won/lost stages use 100/0 probability';end if;
     ids=array_append(ids,(item->>'id')::uuid);stages=stages||jsonb_build_array(item||jsonb_build_object('position',cardinality(ids),'name',btrim(item->>'name')));
    end loop;
    if not exists(select 1 from jsonb_array_elements(stages)s where s->>'kind'='open') or not exists(select 1 from jsonb_array_elements(stages)s where s->>'kind' in ('won','lost')) then raise exception 'A pipeline needs an open stage and a terminal won/lost stage';end if;
    if pipeline.id is not null and exists(select 1 from public.billing_crm_leads l where l.pipeline_id=pipeline.id and not l.archived and l.canonical_id is null and not(l.stage_id=any(ids))) then raise exception 'Move active leads before removing a referenced stage';end if;
    if pipeline.id is null then insert into public.billing_crm_pipelines(id,business_id,demo,name,created_by) values(pipeline_id,business,data_mode,btrim(command_data->>'name'),auth.uid()) returning * into pipeline;
    else update public.billing_crm_pipelines set name=btrim(command_data->>'name'),version=expected,archived=false where id=pipeline.id returning * into pipeline;end if;
    insert into public.billing_crm_pipeline_versions(pipeline_id,version,business_id,demo,name,stages,actor_id) values(pipeline.id,pipeline.version,business,data_mode,pipeline.name,stages,auth.uid());
    for item in select value from jsonb_array_elements(stages) loop insert into public.billing_crm_stages(pipeline_id,pipeline_version,id,business_id,demo,name,kind,position,probability) values(pipeline.id,pipeline.version,(item->>'id')::uuid,business,data_mode,item->>'name',item->>'kind',(item->>'position')::integer,(item->>'probability')::integer);end loop;
   end if;
   result=jsonb_build_object('pipeline',to_jsonb(pipeline),'stages',stages);
  end if;
 elsif action in ('lead.save','lead.adopt') then
  if command_data-array['leadId','version','pipelineId','stageId','ownerId','name','company','email','phone','amount','currency','source','notes','nextAction','reason','clientId','date','duplicatePolicy','reviewedDuplicates','legacyRecordId','legacyVersion']<>'{}'::jsonb or coalesce(command_data->>'leadId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'version','')!~'^[0-9]{1,9}$' or coalesce(command_data->>'pipelineId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'stageId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'ownerId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose a versioned lead, pipeline, stage and owner';end if;
  lead_id=(command_data->>'leadId')::uuid;owner_user=(command_data->>'ownerId')::uuid;expected=(command_data->>'version')::integer;
  select * into lead from public.billing_crm_leads l where l.id=lead_id and l.business_id=business and l.demo=data_mode for update;
  if lead.id is null and expected<>0 or lead.id is not null and lead.version<>expected then raise exception using errcode='40001',message='Lead changed; reload before saving';end if;
  if lead.id is not null and (not public.billing_crm_work_lead(lead.id) or lead.archived or lead.canonical_id is not null) then raise exception using errcode='42501',message='Choose an active lead you can work';end if;
  if not public.billing_crm_manage(business,data_mode) and (lead.id is null and owner_user<>auth.uid() or lead.id is not null and owner_user<>lead.owner_id) then raise exception using errcode='42501',message='A CRM manager must review ownership reassignment';end if;
  if not public.billing_crm_writer(business,owner_user) then raise exception 'Assign leads to a current business owner/admin/editor';end if;
  if lead.id is not null and day<lead.state_date then raise exception 'State changes cannot predate the latest lead state; backdated interactions use the timeline';end if;
  select * into pipeline from public.billing_crm_pipelines p where p.id=(command_data->>'pipelineId')::uuid and p.business_id=business and p.demo=data_mode and not p.archived;
  select * into stage from public.billing_crm_stages s where s.pipeline_id=pipeline.id and s.pipeline_version=pipeline.version and s.id=(command_data->>'stageId')::uuid;
  if stage.id is null then raise exception 'Choose a current stage in an active pipeline';end if;
  foreach key_name in array array['name','company','email','phone','source','notes','nextAction','reason'] loop
   if jsonb_typeof(command_data->key_name) is distinct from 'string' or length(command_data->>key_name)>(case key_name when 'notes' then 10000 when 'email' then 254 when 'phone' then 80 when 'source' then 180 when 'reason' then 1000 when 'nextAction' then 1000 else 500 end) then raise exception 'Review CRM contact/source/notes text lengths';end if;
  end loop;
  if length(btrim(command_data->>'name'))=0 or length(btrim(command_data->>'source'))=0 or length(btrim(command_data->>'reason'))=0 or (stage.kind='open' and length(btrim(command_data->>'nextAction'))=0) then raise exception 'Retain lead name, source, reason and an open-stage next action';end if;
  if btrim(command_data->>'email')<>'' and btrim(command_data->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(command_data->>'currency','')!~'^[A-Z]{3}$' then raise exception 'Review the lead email and separate expected-value currency';end if;
  lead_amount=public.billing_ledger_amount(command_data->'amount');
  select coalesce(jsonb_agg(l.id::text order by l.id),'[]'::jsonb) into candidate_ids from public.billing_crm_leads l where l.business_id=business and l.demo=data_mode and l.id<>lead_id and l.canonical_id is null and not l.archived and ((btrim(command_data->>'email')<>'' and lower(l.email)=lower(btrim(command_data->>'email'))) or (regexp_replace(command_data->>'phone','[^0-9]','','g')<>'' and regexp_replace(l.phone,'[^0-9]','','g')=regexp_replace(command_data->>'phone','[^0-9]','','g')));
  if candidate_ids<>'[]'::jsonb and (lead.id is null or lower(lead.email)<>lower(btrim(command_data->>'email')) or regexp_replace(lead.phone,'[^0-9]','','g')<>regexp_replace(command_data->>'phone','[^0-9]','','g')) then
   if command_data->>'duplicatePolicy' is distinct from 'allow-reviewed' or jsonb_typeof(command_data->'reviewedDuplicates') is distinct from 'array' then raise exception using errcode='23505',message='Matching enquiries require explicit duplicate ownership review; no record was merged';end if;
   select coalesce(jsonb_agg(value order by value),'[]'::jsonb) into reviewed from jsonb_array_elements(command_data->'reviewedDuplicates');
   if reviewed<>candidate_ids or exists(select 1 from jsonb_array_elements_text(candidate_ids)c where not public.billing_crm_read_lead(c::uuid)) then raise exception using errcode='40001',message='Duplicate candidates changed or require a CRM manager review';end if;
  end if;
  if command_data->'clientId' is not null and command_data->'clientId'<>'null'::jsonb then
   if coalesce(command_data->>'clientId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an exact saved client link';end if;
   select * into client from public.billing_records r where r.id=(command_data->>'clientId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='clients';
   if client.id is null or client.archived and client.id is distinct from lead.client_id then raise exception 'Client link unavailable in this business and data mode';end if;
  end if;
  if action='lead.adopt' then
   if lead.id is not null or coalesce(command_data->>'legacyRecordId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'legacyVersion','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Explicit adoption needs an unchanged legacy lead';end if;
   select * into legacy from public.billing_records r where r.id=(command_data->>'legacyRecordId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='leads' and not r.archived;
   if legacy.id is null or legacy.version<>(command_data->>'legacyVersion')::integer then raise exception using errcode='40001',message='Legacy lead changed; review adoption again';end if;
  elsif command_data?'legacyRecordId' or command_data?'legacyVersion' then raise exception 'Use explicit legacy adoption; ordinary saves cannot forge provenance';end if;
  if lead.id is null then
   insert into public.billing_crm_leads(id,business_id,demo,pipeline_id,pipeline_version,stage_id,owner_id,name,company,email,phone,amount,currency,source,notes,next_action,reason,client_id,legacy_record_id,legacy_snapshot,state_date,created_sequence,created_by)
   values(lead_id,business,data_mode,pipeline.id,pipeline.version,stage.id,owner_user,btrim(command_data->>'name'),btrim(command_data->>'company'),btrim(command_data->>'email'),btrim(command_data->>'phone'),lead_amount,command_data->>'currency',btrim(command_data->>'source'),command_data->>'notes',command_data->>'nextAction',command_data->>'reason',client.id,legacy.id,case when legacy.id is null then null else to_jsonb(legacy) end,day,n,auth.uid()) returning * into lead;
  else
   update public.billing_crm_leads set pipeline_id=pipeline.id,pipeline_version=pipeline.version,stage_id=stage.id,owner_id=owner_user,name=btrim(command_data->>'name'),company=btrim(command_data->>'company'),email=btrim(command_data->>'email'),phone=btrim(command_data->>'phone'),amount=lead_amount,currency=command_data->>'currency',source=btrim(command_data->>'source'),notes=command_data->>'notes',next_action=command_data->>'nextAction',reason=command_data->>'reason',client_id=client.id,version=version+1,state_date=day,updated_at=now() where id=lead.id returning * into lead;
  end if;
  result=jsonb_build_object('lead',public.billing_crm_lead_json(lead.id));
 else
  if coalesce(command_data->>'leadId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an exact CRM lead';end if;lead_id=(command_data->>'leadId')::uuid;
  select * into lead from public.billing_crm_leads l where l.id=lead_id and l.business_id=business and l.demo=data_mode for update;
  if lead.id is null then raise exception using errcode='P0002',message='CRM lead unavailable in this business and data mode';end if;
  if action in ('task.status') then
   if not public.billing_crm_work_lead(coalesce(public.billing_crm_canonical(lead.id),lead.id)) and not exists(select 1 from public.billing_crm_tasks t where t.id=(command_data->>'taskId')::uuid and t.lead_id=lead.id and t.assignee_id=auth.uid()) then raise exception using errcode='42501',message='Only the task assignee or a lead/CRM manager can complete it';end if;
  elsif not public.billing_crm_work_lead(lead.id) or lead.archived or lead.canonical_id is not null then raise exception using errcode='42501',message='Choose an active lead you can work';end if;
  if action<>'task.status' and (coalesce(command_data->>'version','')!~'^[1-9][0-9]{0,8}$' or lead.version<>(command_data->>'version')::integer) then raise exception using errcode='40001',message='Lead changed; reload before acting';end if;
  if action='lead.archive' then
   if command_data-array['leadId','version','date','reason']<>'{}'::jsonb or not coalesce(length(btrim(command_data->>'reason')) between 1 and 1000,false) or day<lead.state_date then raise exception 'Archive needs a current effective date and reason';end if;
   update public.billing_crm_leads set archived=true,reason=command_data->>'reason',state_date=day,version=version+1,updated_at=now() where id=lead.id returning * into lead;result=jsonb_build_object('lead',public.billing_crm_lead_json(lead.id));
  elsif action='lead.merge' then
   if not public.billing_crm_manage(business,data_mode) then raise exception using errcode='42501',message='A CRM manager must review duplicate merge and surviving ownership';end if;
   if command_data-array['leadId','version','targetId','targetVersion','ownerId','date','reason','reviewed']<>'{}'::jsonb or command_data->'reviewed' is distinct from 'true'::jsonb or coalesce(command_data->>'targetId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'targetVersion','')!~'^[1-9][0-9]{0,8}$' or coalesce(command_data->>'ownerId','')!~'^[0-9a-fA-F-]{36}$' or not coalesce(length(btrim(command_data->>'reason')) between 1 and 1000,false) then raise exception 'Review exact duplicate versions, survivor owner and reason';end if;
   target=(command_data->>'targetId')::uuid;owner_user=(command_data->>'ownerId')::uuid;select * into other from public.billing_crm_leads l where l.id=target and l.business_id=business and l.demo=data_mode for update;
   if other.id is null or other.id=lead.id or other.archived or other.canonical_id is not null or other.version<>(command_data->>'targetVersion')::integer or day<greatest(lead.state_date,other.state_date) then raise exception using errcode='40001',message='Merge sources changed or survivor is unavailable';end if;
   if not public.billing_crm_writer(business,owner_user) then raise exception 'Review an active survivor owner';end if;
   update public.billing_crm_leads set canonical_id=other.id,archived=true,reason=command_data->>'reason',state_date=day,version=version+1,updated_at=now() where id=lead.id returning * into lead;
   perform public.billing_crm_emit(business,data_mode,command_id,n,'lead.merged-source',lead.id,day,public.billing_crm_lead_json(lead.id),command_data);
   n=public.billing_crm_next(business,data_mode);update public.billing_crm_leads set owner_id=owner_user,reason=command_data->>'reason',state_date=day,version=version+1,updated_at=now() where id=other.id returning * into other;
   result=jsonb_build_object('source',public.billing_crm_lead_json(lead.id),'lead',public.billing_crm_lead_json(other.id),'historyRetainedOnSourceIds',true);lead=other;
  elsif action='task.save' then
   if command_data-array['leadId','version','taskId','taskVersion','assigneeId','title','dueAt','timeZone','date']<>'{}'::jsonb or coalesce(command_data->>'taskId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'taskVersion','')!~'^[0-9]{1,9}$' or coalesce(command_data->>'assigneeId','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(command_data->'title') is distinct from 'string' or length(btrim(command_data->>'title')) not between 1 and 500 or coalesce(command_data->>'dueAt','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or not exists(select 1 from pg_catalog.pg_timezone_names where name=command_data->>'timeZone') then raise exception 'Review an assigned follow-up with an explicit time zone/UTC offset';end if;
   owner_user=(command_data->>'assigneeId')::uuid;if not public.billing_crm_writer(business,owner_user) then raise exception 'Assign follow-ups to a current business writer';end if;due=(command_data->>'dueAt')::timestamptz;if not isfinite(due) then raise exception 'Choose a real follow-up time';end if;
   select * into task from public.billing_crm_tasks t where t.id=(command_data->>'taskId')::uuid and t.business_id=business and t.demo=data_mode and t.lead_id=lead.id for update;
   if task.id is null then if (command_data->>'taskVersion')::integer<>0 then raise exception using errcode='40001',message='Task unavailable; reload';end if;insert into public.billing_crm_tasks(id,business_id,demo,lead_id,assignee_id,title,due_at,time_zone,status,state_date,created_by) values((command_data->>'taskId')::uuid,business,data_mode,lead.id,owner_user,btrim(command_data->>'title'),due,command_data->>'timeZone','open',day,auth.uid()) returning * into task;
   else if task.version<>(command_data->>'taskVersion')::integer or day<task.state_date then raise exception using errcode='40001',message='Task changed; reload';end if;update public.billing_crm_tasks set assignee_id=owner_user,title=btrim(command_data->>'title'),due_at=due,time_zone=command_data->>'timeZone',state_date=day,status='open',version=version+1,updated_at=now() where id=task.id returning * into task;end if;
   details=details||jsonb_build_object('task',to_jsonb(task));result=jsonb_build_object('task',to_jsonb(task),'lead',public.billing_crm_lead_json(lead.id));
  elsif action='task.status' then
   if command_data-array['leadId','taskId','taskVersion','status','date','reason']<>'{}'::jsonb or coalesce(command_data->>'taskId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(command_data->>'taskVersion','')!~'^[1-9][0-9]{0,8}$' or coalesce(command_data->>'status','') not in ('done','cancelled') or not coalesce(length(btrim(command_data->>'reason')) between 1 and 1000,false) then raise exception 'Review task completion/cancellation and reason';end if;
   select * into task from public.billing_crm_tasks t where t.id=(command_data->>'taskId')::uuid and t.business_id=business and t.demo=data_mode and t.lead_id=lead.id for update;
   if task.id is null or task.version<>(command_data->>'taskVersion')::integer or day<task.state_date then raise exception using errcode='40001',message='Task changed; reload';end if;
   update public.billing_crm_tasks set status=command_data->>'status',state_date=day,version=version+1,updated_at=now() where id=task.id returning * into task;details=details||jsonb_build_object('task',to_jsonb(task));result=jsonb_build_object('task',to_jsonb(task));
  elsif action='activity.add' then
   if command_data-array['leadId','version','kind','occurredAt','endsAt','timeZone','summary','notes','date']<>'{}'::jsonb or coalesce(command_data->>'kind','') not in ('note','call','meeting','email','whatsapp') or coalesce(command_data->>'occurredAt','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or not exists(select 1 from pg_catalog.pg_timezone_names where name=command_data->>'timeZone') or jsonb_typeof(command_data->'summary') is distinct from 'string' or length(btrim(command_data->>'summary')) not between 1 and 500 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(command_data->>'notes')>10000 then raise exception 'Review a dated interaction, time zone and summary';end if;
   due=(command_data->>'occurredAt')::timestamptz;if not isfinite(due) or command_data->>'kind'<>'meeting' and due>now() then raise exception 'Future interactions must be scheduled meetings or follow-ups';end if;
   if command_data->'endsAt' is not null and command_data->'endsAt'<>'null'::jsonb then ends=(command_data->>'endsAt')::timestamptz;if ends<=due or not isfinite(ends) then raise exception 'Meeting end must follow its start';end if;end if;
   insert into public.billing_crm_activities(id,business_id,demo,lead_id,kind,occurred_at,time_zone,ends_at,summary,notes,actor_id) values(gen_random_uuid(),business,data_mode,lead.id,command_data->>'kind',due,command_data->>'timeZone',ends,btrim(command_data->>'summary'),command_data->>'notes',auth.uid()) returning to_jsonb(billing_crm_activities) into result;
   details=details||jsonb_build_object('activity',result,'delivery','logged-only-no-provider-send');result=jsonb_build_object('activity',result);
  elsif action='client.link' then
   if command_data-array['leadId','version','clientId','create','name','address','date','reason']<>'{}'::jsonb or not coalesce(length(btrim(command_data->>'reason')) between 1 and 1000,false) or day<lead.state_date then raise exception 'Review an exact client link or explicit new client creation and reason';end if;
   if command_data->'create'='true'::jsonb then
    if jsonb_typeof(command_data->'name') is distinct from 'string' or length(btrim(command_data->>'name')) not between 1 and 500 or jsonb_typeof(command_data->'address') is distinct from 'string' or length(command_data->>'address')>2000 then raise exception 'Review the new client name and address';end if;
    if exists(select 1 from public.billing_records r where r.business_id=business and r.demo=data_mode and r.collection='clients' and not r.archived and (lead.email<>'' and lower(r.data->>'email')=lower(lead.email) or regexp_replace(lead.phone,'[^0-9]','','g')<>'' and regexp_replace(r.data->>'phone','[^0-9]','','g')=regexp_replace(lead.phone,'[^0-9]','','g'))) then raise exception using errcode='23505',message='A saved client has this exact email/phone. Review and link its ID; no client was merged';end if;
    insert into public.billing_records(business_id,collection,data,demo,created_by) values(business,'clients',jsonb_build_object('name',btrim(command_data->>'name'),'address',command_data->>'address','email',lead.email,'phone',lead.phone,'crmLeadId',lead.id,'sourceRecord',lead.id),data_mode,auth.uid()) returning * into client;
   else
    if coalesce(command_data->>'clientId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an exact saved client';end if;
    select * into client from public.billing_records r where r.id=(command_data->>'clientId')::uuid and r.business_id=business and r.demo=data_mode and r.collection='clients' and not r.archived;
    if client.id is null then raise exception 'Client unavailable in this business/data mode';end if;
   end if;
   update public.billing_crm_leads set client_id=client.id,reason=command_data->>'reason',state_date=day,version=version+1,updated_at=now() where id=lead.id returning * into lead;details=details||jsonb_build_object('clientId',client.id,'created',command_data->'create'='true'::jsonb);result=jsonb_build_object('lead',public.billing_crm_lead_json(lead.id),'client',to_jsonb(client));
  elsif action='file.attach' then
   if command_data-array['leadId','version','path','name','mime','size','sha256','date']<>'{}'::jsonb or jsonb_typeof(command_data->'path') is distinct from 'string' or jsonb_typeof(command_data->'name') is distinct from 'string' or length(command_data->>'name') not between 1 and 180 or coalesce(command_data->>'mime','') not in ('application/pdf','image/png','image/jpeg','image/webp','text/csv') or coalesce(command_data->>'size','')!~'^[0-9]{1,7}$' or (command_data->>'size')::integer not between 1 and 5242880 or coalesce(command_data->>'sha256','')!~'^[0-9a-f]{64}$' then raise exception 'Review a PDF/image/CSV attachment up to 5 MB and its checksum';end if;
   path=command_data->>'path';if path not like business::text||'/crm/'||lead.id::text||'/%' or path~'\.\.' or (length(path)>300 or path!~'^[a-zA-Z0-9/._-]+$') or not exists(select 1 from storage.objects o where o.bucket_id='billing-files' and o.name=path) then raise exception 'Upload the private file under this CRM lead first';end if;
   insert into public.billing_crm_files(id,business_id,demo,lead_id,path,name,mime,size,sha256,actor_id) values(gen_random_uuid(),business,data_mode,lead.id,path,command_data->>'name',command_data->>'mime',(command_data->>'size')::integer,command_data->>'sha256',auth.uid()) returning to_jsonb(billing_crm_files) into result;details=details||jsonb_build_object('file',result);result=jsonb_build_object('file',result);
  else
   if command_data-array['leadId','version','date','description','notes']<>'{}'::jsonb or jsonb_typeof(command_data->'description') is distinct from 'string' or length(btrim(command_data->>'description')) not between 1 and 500 or jsonb_typeof(command_data->'notes') is distinct from 'string' or length(command_data->>'notes')>5000 then raise exception 'Review a draft quotation description and notes';end if;
   if lead.client_id is not null then select * into client from public.billing_records where id=lead.client_id and business_id=business and demo=data_mode and collection='clients';end if;
   source_snapshot=public.billing_crm_lead_json(lead.id);
   insert into public.billing_records(business_id,collection,data,demo,created_by) values(business,'documents',jsonb_build_object('type','quotation','number',public.billing_document_number_for(business,data_mode,'quotation',true),'status','draft','date',day,'dueDate','','currency',lead.currency,'seller',(select jsonb_build_object('name',b.name,'address',b.address,'email',b.email,'phone',b.phone,'gstin',b.gstin) from public.billing_businesses b where b.id=business),'buyer',case when client.id is null then jsonb_build_object('name',lead.name,'email',lead.email,'phone',lead.phone) else client.data end,'clientId',client.id,'taxType','NONE','gstMode','split','items',jsonb_build_array(jsonb_build_object('name',btrim(command_data->>'description'),'quantity',1,'rate',lead.amount,'taxRate',0)),'notes',command_data->>'notes','sourceRecord',lead.id,'crmLeadId',lead.id,'crmCanonicalLeadId',public.billing_crm_canonical(lead.id),'crmLeadVersion',lead.version,'crmPipelineId',lead.pipeline_id),data_mode,auth.uid()) returning * into doc;
   insert into public.billing_crm_quotes(id,business_id,demo,lead_id,document_id,lead_version,snapshot,actor_id) values(gen_random_uuid(),business,data_mode,lead.id,doc.id,lead.version,source_snapshot,auth.uid());details=details||jsonb_build_object('documentId',doc.id,'documentNumber',doc.data->>'number','draftOnly',true);result=jsonb_build_object('document',to_jsonb(doc),'lead',source_snapshot);
  end if;
 end if;
 event=public.billing_crm_emit(business,data_mode,command_id,n,action,lead.id,day,case when lead.id is null or action not in ('lead.save','lead.adopt','lead.archive','lead.merge','client.link') then null else public.billing_crm_lead_json(lead.id) end,details);
 result=result||jsonb_build_object('event',event,'replayed',false);
 insert into public.billing_crm_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_crm_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'crm.'||action,jsonb_build_object('eventId',event->>'id','sequence',event->>'sequence','leadId',lead.id,'providerSend',false));return result;
end$$;

create or replace function public.billing_sales_convert(business uuid,data_mode boolean,command_id uuid,conversion_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_sales_order_commands;source public.billing_sales_order_lines;order_row public.billing_sales_orders;first_order public.billing_sales_orders;original public.billing_sales_conversion_lines;original_doc public.billing_issued_documents;dispatch public.billing_sales_fulfillment_lines;dispatch_event public.billing_sales_fulfillment_events;
 request jsonb;result jsonb;part jsonb;items jsonb='[]';authority_rows jsonb='[]';allocation jsonb;item jsonb;document_data jsonb;created public.billing_records;document_id uuid=gen_random_uuid();conversion_id uuid=gen_random_uuid();line_id uuid;source_invoice uuid;fulfillment uuid;day date;due date;kind text;q numeric;source_ids uuid[]='{}';source_key text;keys text[]='{}';number text;reason text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='Your role cannot convert sales order lines';end if;
 if data_mode is null or command_id is null or jsonb_typeof(conversion_data) is distinct from 'object' or conversion_data-array['kind','date','dueDate','lines','allocationReviewed','reason']<>'{}'::jsonb or conversion_data->'allocationReviewed' is distinct from 'true'::jsonb then raise exception 'Review explicit source lines and cumulative component allocation before conversion';end if;
 request=jsonb_build_object('action','convert','data',conversion_data);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_convert.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales conversion';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 kind=conversion_data->>'kind';if kind is null or kind not in ('invoice','gst-invoice','commercial-invoice','delivery-challan','credit-note') then raise exception 'Choose an invoice, delivery challan or credit-note conversion';end if;
 if jsonb_typeof(conversion_data->'lines') is distinct from 'array' or jsonb_array_length(conversion_data->'lines') not between 1 and 1000 then raise exception 'Convert 1 to 1,000 explicit source lines';end if;
 for part in select value from jsonb_array_elements(conversion_data->'lines') loop
  if jsonb_typeof(part) is distinct from 'object' or part-array['orderLineId','orderVersion','quantity','sourceInvoiceLineId','fulfillmentLineId']<>'{}'::jsonb or coalesce(part->>'orderLineId','')!~'^[0-9a-fA-F-]{36}$' or coalesce(part->>'orderVersion','')!~'^[1-9][0-9]{0,8}$' then raise exception 'Each conversion needs a frozen order line, reviewed order version and exact quantity';end if;
  if kind='credit-note' then
   if coalesce(part->>'sourceInvoiceLineId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Credit conversion must identify each original invoice conversion line';end if;
  end if;
 end loop;
 if kind='credit-note' then perform 1 from public.billing_records r where r.id in(select c.document_id from jsonb_array_elements(conversion_data->'lines') x join public.billing_sales_conversion_lines l on l.id=(x->>'sourceInvoiceLineId')::uuid join public.billing_sales_document_conversions c on c.id=l.conversion_id) and r.business_id=business and r.demo=data_mode and r.collection='documents' order by r.id for update;end if;
 perform public.billing_ledger_writer_lock(business,false);
 select * into prior from public.billing_sales_order_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_sales_convert.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='Retry key was used for a different sales conversion';end if;return prior.result||jsonb_build_object('replayed',true);end if;
 day=public.billing_payment_date(conversion_data->'date');if kind='credit-note' then due=null;reason=btrim(conversion_data->>'reason');if jsonb_typeof(conversion_data->'reason') is distinct from 'string' or length(reason) not between 1 and 1000 then raise exception 'Review the credit-note conversion reason';end if;else due=public.billing_payment_date(conversion_data->'dueDate');if due<day then raise exception 'Converted document due date cannot precede its date';end if;end if;
 for part in select value from jsonb_array_elements(conversion_data->'lines') loop
  select * into source from public.billing_sales_order_lines l where l.id=(part->>'orderLineId')::uuid and l.business_id=business and l.demo=data_mode;
  select * into order_row from public.billing_sales_orders where id=source.order_id and status='issued';
  if source.id is null or order_row.id is null then raise exception 'Choose an active issued order line in this business and data mode';end if;
  if order_row.version<>(part->>'orderVersion')::integer then raise exception using errcode='40001',message='Source order changed; reload before converting';end if;
  if day<order_row.date then raise exception 'Converted documents cannot predate their commercial order';end if;
  if first_order.id is null then first_order=order_row;elsif first_order.client_id<>order_row.client_id or first_order.currency<>order_row.currency or first_order.data->'customer'<>order_row.data->'customer' or first_order.data->'business'<>order_row.data->'business' or first_order.data->>'taxType'<>order_row.data->>'taxType' or first_order.data->>'gstMode'<>order_row.data->>'gstMode' then raise exception 'Bulk conversion requires identical frozen customer, business, currency and tax context; split incompatible orders';end if;
  q=public.billing_sales_quantity(part->'quantity');source_invoice=null;fulfillment=null;original=null;
  if kind='credit-note' then
   select * into original from public.billing_sales_conversion_lines l where l.id=(part->>'sourceInvoiceLineId')::uuid and l.order_line_id=source.id and l.business_id=business and l.demo=data_mode;
   select * into original_doc from public.billing_issued_documents i where i.document_id=(select c.document_id from public.billing_sales_document_conversions c where c.id=original.conversion_id and c.kind in ('invoice','gst-invoice','commercial-invoice'));
   if original.id is null or original_doc.document_id is null or exists(select 1 from public.billing_document_cancellations x where x.document_id=original_doc.document_id) or day<original_doc.date then raise exception 'Choose a current frozen issued source invoice on or before the credit date';end if;
   if items<>'[]'::jsonb and document_data->>'originalDocumentId' is distinct from original_doc.document_id::text then raise exception 'One credit note cannot combine different parent invoices';end if;
   source_invoice=original.id;fulfillment=original.fulfillment_line_id;document_data=jsonb_build_object('originalDocumentId',original_doc.document_id,'originalDocumentNumber',original_doc.number,'originalDocumentDate',original_doc.date,'adjustmentReason',reason);
  elsif part?'fulfillmentLineId' then
   if coalesce(part->>'fulfillmentLineId','')!~'^[0-9a-fA-F-]{36}$' then raise exception 'Choose an immutable dispatch line when linking a fulfillment';end if;fulfillment=(part->>'fulfillmentLineId')::uuid;
  end if;
  if kind='delivery-challan' and fulfillment is null then raise exception 'A delivery challan must identify its actual dispatch source lines';end if;
  if fulfillment is not null then
   select * into dispatch from public.billing_sales_fulfillment_lines f where f.id=fulfillment and f.order_line_id=source.id and f.kind='dispatch';select * into dispatch_event from public.billing_sales_fulfillment_events where id=dispatch.event_id;
   if dispatch.id is null or day<dispatch_event.date then raise exception 'Document conversion must match an existing dispatch on or before its date';end if;
  end if;
  source_key=case when kind='credit-note' then source_invoice::text when kind='delivery-challan' then fulfillment::text else source.id::text end;
  if source_key=any(keys) then raise exception 'Select each fiscal source line once per target document';end if;keys=array_append(keys,source_key);source_ids=array_append(source_ids,source.id);
  line_id=gen_random_uuid();allocation=public.billing_sales_allocation_basis(source.id,source_invoice,fulfillment,kind,day,q,line_id);
  item=(source.snapshot-array['itemSnapshot','unitSnapshot','unitFactor','baseQuantity'])||jsonb_build_object('id',line_id,'quantity',q::numeric(24,6)::text,'itemId',source.item_id,'unitId',source.unit_id,'sourceOrderId',order_row.id,'sourceOrderLineId',source.id,'sourceAllocation',allocation);
  if fulfillment is not null then item=item||jsonb_build_object('fulfillmentLineId',fulfillment);end if;
  if source_invoice is not null then item=item||jsonb_build_object('sourceInvoiceLineId',source_invoice);end if;
  if kind='delivery-challan' then item=item||jsonb_build_object('taxRate','0','cessRate','0','discount','0','discountType','fixed');end if;
  items=items||jsonb_build_array(item);authority_rows=authority_rows||jsonb_build_array(jsonb_build_object('id',line_id,'sourceOrderLineId',source.id,'sourceInvoiceLineId',source_invoice,'fulfillmentLineId',fulfillment,'quantity',q::numeric(24,6)::text,'sourceAllocation',allocation,'snapshot',item));
 end loop;
 number=public.billing_document_number_for(business,data_mode,kind,true);
 document_data=coalesce(document_data,'{}'::jsonb)||jsonb_build_object('type',kind,'number',number,'status','draft','date',day,'dueDate',coalesce(due::text,''),'currency',first_order.currency,'seller',first_order.data->'business','buyer',first_order.data->'customer','clientId',first_order.client_id,'items',items,'taxType',case when kind='delivery-challan' then 'NONE' else first_order.data->>'taxType' end,'gstMode',first_order.data->>'gstMode','shipping',jsonb_build_object('amount','0'),'roundOff',false,'notes',first_order.data->>'notes','terms','','orderConversion',jsonb_build_object('version',1,'conversionId',conversion_id,'kind',kind,'policy','cumulative-proportion-final-residual'));
 document_data=document_data||public.billing_document_totals(document_data);
 insert into public.billing_sales_document_conversions(id,business_id,demo,document_id,kind,date,expected_data,actor_id) values(conversion_id,business,data_mode,document_id,kind,day,document_data,auth.uid());
 for part in select value from jsonb_array_elements(authority_rows) loop
  insert into public.billing_sales_conversion_lines(id,business_id,demo,conversion_id,order_line_id,source_invoice_line_id,fulfillment_line_id,quantity,source_allocation,snapshot) values((part->>'id')::uuid,business,data_mode,conversion_id,(part->>'sourceOrderLineId')::uuid,(part->>'sourceInvoiceLineId')::uuid,(part->>'fulfillmentLineId')::uuid,(part->>'quantity')::numeric,part->'sourceAllocation',part->'snapshot');
 end loop;
 foreach line_id in array source_ids loop perform public.billing_sales_validate_value_caps(line_id);end loop;
 insert into public.billing_records(id,business_id,collection,data,demo,created_by) values(document_id,business,'documents',document_data,data_mode,auth.uid()) returning * into created;
 result=jsonb_build_object('record',to_jsonb(created),'conversionId',conversion_id,'replayed',false);
 insert into public.billing_sales_order_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);
 insert into public.billing_ledger_audit(business_id,demo,actor_id,action,details) values(business,data_mode,auth.uid(),'sales-order.document-converted',jsonb_build_object('conversionId',conversion_id,'documentId',document_id,'sourceLineIds',to_jsonb(source_ids)));
 insert into public.billing_sales_order_outbox(business_id,demo,command_id,topic,payload) values(business,data_mode,command_id,'sales-order.document-converted',result);return result;
end$$;
