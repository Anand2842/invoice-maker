-- Imported portal statements and reconciliation decisions are append-only.
create table public.billing_gstr2b_imports(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.billing_businesses(id),demo boolean not null,period text not null check(period~'^(0[1-9]|1[0-2])[0-9]{4}$'),gstin text not null,file_sha256 text not null,rows jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(id,business_id,demo)
);
create table public.billing_gstr2b_decisions(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,demo boolean not null,import_id uuid not null,row_key text not null,decision text not null check(decision in ('accept','follow-up','ignore')),actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),foreign key(import_id,business_id,demo) references public.billing_gstr2b_imports(id,business_id,demo)
);
create table public.billing_gstr2b_commands(
 business_id uuid not null references public.billing_businesses(id),demo boolean not null,command_id uuid not null,actor_id uuid not null references auth.users(id),request jsonb not null,result jsonb not null,primary key(business_id,demo,command_id)
);
DO $$declare t text;begin foreach t in array array['billing_gstr2b_imports','billing_gstr2b_decisions','billing_gstr2b_commands'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('create trigger %I before update or delete on public.%I for each row execute function public.billing_ledger_immutable()',t||'_immutable',t);
 execute format('create policy %I on public.%I for select to authenticated using(public.billing_can_access(business_id))',t||'_read',t);if t<>'billing_gstr2b_commands' then execute format('grant select on public.%I to authenticated',t);end if;
 end loop;end$$;
-- Independently normalize the source file inside the RPC, so direct callers cannot
-- substitute rows or a different GSTIN/period for an imported document.
create function public.billing_gstr2b_parse(document jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare d jsonb; doc jsonb; section text; g jsonb; e jsonb; item jsonb; gi integer; ei integer; gst text; fp text; ctin text; number text; day text; typ text; itc text; sign integer; vals jsonb; amount numeric; key text; source text; rows jsonb='[]'::jsonb;
begin
 d=document->'data';doc=d->'docdata';gst=upper(btrim(coalesce(nullif(d->>'gstin',''),document->>'gstin')));fp=btrim(coalesce(nullif(d->>'rtnprd',''),nullif(d->>'fp',''),nullif(document->>'fp',''),document->>'rtnprd'));
 if jsonb_typeof(document) is distinct from 'object' or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(doc) is distinct from 'object' or coalesce(gst,'')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' or coalesce(fp,'')!~'^(0[1-9]|1[0-2])[0-9]{4}$' or substring(fp,3,4)::integer<1900 or substring(gst,1,2) not in ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','97','99') then raise exception 'Invalid GSTR-2B document, GSTIN or period';end if;
 foreach section in array array['b2b','cdnr'] loop
  if jsonb_typeof(case when doc->section is null or doc->section in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then '[]'::jsonb else doc->section end) is distinct from 'array' then raise exception 'Invalid GSTR-2B supplier list';end if;gi=0;
  for g in select value from jsonb_array_elements(case when doc->section is null or doc->section in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then '[]'::jsonb else doc->section end) loop
   ctin=upper(btrim(g->>'ctin'));if jsonb_typeof(g) is distinct from 'object' or coalesce(ctin,'')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' or substring(ctin,1,2) not in ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38','97','99') or jsonb_typeof(g->case when section='b2b' then 'inv' else 'nt' end) is distinct from 'array' then raise exception 'Invalid supplier documents';end if;ei=0;
   for e in select value from jsonb_array_elements(g->case when section='b2b' then 'inv' else 'nt' end) loop
    number=btrim(coalesce(nullif(e->>'inum',''),e->>'nt_num'));day=coalesce(nullif(e->>'dt',''),e->>'nt_dt');itc=upper(btrim(e->>'itcavl'));typ=case when section='b2b' then 'invoice' else upper(btrim(coalesce(nullif(e->>'ntty',''),e->>'typ'))) end;sign=case when section='cdnr' and typ in ('C','CR','CREDIT') then -1 else 1 end;
    if jsonb_typeof(e) is distinct from 'object' or coalesce(length(number),0) not between 1 and 100 or coalesce(day,'')!~'^[0-9]{2}-[0-9]{2}-[0-9]{4}$' or coalesce(itc,'') not in ('Y','N') or section='cdnr' and coalesce(typ,'') not in ('C','D','CR','DR','CREDIT','DEBIT') or jsonb_typeof(e->'items') is distinct from 'array' or jsonb_typeof(e->'val') is distinct from 'number' then raise exception 'Invalid GSTR-2B invoice';end if;
    begin if to_char(to_date(day,'DD-MM-YYYY'),'DD-MM-YYYY')<>day then raise exception 'Invalid invoice date';end if;exception when others then raise exception 'Invalid invoice date';end;
    amount=(e->>'val')::numeric;if amount<0 or amount>90071992547409.91 or trunc(amount,2)<>amount then raise exception 'Invalid invoice value';end if;
    vals='{"txval":0,"iamt":0,"camt":0,"samt":0,"csamt":0}'::jsonb;
    for item in select value from jsonb_array_elements(e->'items') loop
     if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'rt') is distinct from 'number' or (item->>'rt')::numeric<0 then raise exception 'Invalid item rate';end if;
     foreach key in array array['txval','iamt','camt','samt','csamt'] loop source=case key when 'iamt' then 'igst' when 'camt' then 'cgst' when 'samt' then 'sgst' when 'csamt' then 'cess' else key end;
      if item->source is not null and item->source<>'null'::jsonb and jsonb_typeof(item->source) is distinct from 'number' then raise exception 'Invalid item amount';end if;
      amount=coalesce((item->>source)::numeric,0);if amount<0 or amount>90071992547409.91 or trunc(amount,2)<>amount then raise exception 'Invalid item amount';end if;vals=jsonb_set(vals,array[key],to_jsonb((vals->>key)::numeric+amount*sign));
     end loop;
    end loop;
    rows=rows||jsonb_build_array(jsonb_build_object('rowKey',section||':'||gi||':'||ei,'gstin',ctin,'name',case when jsonb_typeof(g->'trdnm')='string' then g->>'trdnm' else '' end,'number',number,'date',to_char(to_date(day,'DD-MM-YYYY'),'YYYY-MM-DD'),'type',typ,'val',(e->>'val')::numeric,'pos',case when jsonb_typeof(e->'pos')='string' then e->>'pos' else '' end,'reverseCharge',case when e->'rev' is null or e->'rev' in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then '""'::jsonb else e->'rev' end,'itcAvailable',itc,'reason',case when jsonb_typeof(e->'rsn')='string' then e->>'rsn' else '' end)||vals);ei=ei+1;
   end loop;gi=gi+1;
  end loop;
 end loop;return jsonb_build_object('gstin',gst,'period',fp,'rows',rows);
end$$;
create function public.billing_gstr2b_command(business uuid,data_mode boolean,command_id uuid,action text,command_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_gstr2b_commands; request jsonb; result jsonb; snapshot public.billing_gstr2b_imports; decision_row public.billing_gstr2b_decisions; raw text; document jsonb; file_hash text; row_key text;
begin
 if auth.uid() is null or not public.billing_can_access(business,true) then raise exception using errcode='42501',message='You cannot change GSTR-2B reconciliation in this business';end if;
 perform public.billing_ledger_writer_lock(business,false);
 if data_mode is null or command_id is null or action not in ('import','decision') or action is null or jsonb_typeof(command_data) is distinct from 'object' then raise exception 'Review the GSTR-2B command';end if;
 request=jsonb_build_object('action',action,'data',command_data);
 select * into prior from public.billing_gstr2b_commands c where c.business_id=business and c.demo=data_mode and c.command_id=billing_gstr2b_command.command_id;
 if prior.command_id is not null then if prior.actor_id<>auth.uid() or prior.request<>request then raise exception using errcode='40001',message='This retry key was used for a different command';end if;return prior.result;end if;
 if action='import' then
  if command_data-array['raw','period','gstin','rows']<>'{}'::jsonb or jsonb_typeof(command_data->'raw') is distinct from 'string' or jsonb_typeof(command_data->'rows') is distinct from 'array' or jsonb_array_length(command_data->'rows')>50000 or coalesce(command_data->>'period','')!~'^(0[1-9]|1[0-2])[0-9]{4}$' or coalesce(command_data->>'gstin','')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then raise exception 'Review the GSTR-2B file, period and GSTIN';end if;
  raw=command_data->>'raw';if octet_length(raw)>4194304 or octet_length(raw)=0 then raise exception 'GSTR-2B JSON must be at most 4 MB';end if;
  begin document=raw::jsonb;exception when others then raise exception 'GSTR-2B file is not valid JSON';end;
  if public.billing_gstr2b_parse(document)<>jsonb_build_object('gstin',command_data->>'gstin','period',command_data->>'period','rows',command_data->'rows') then raise exception 'Parsed GSTR-2B rows or scope do not match the uploaded file';end if;
  if upper(coalesce((select b.gstin from public.billing_businesses b where b.id=business),''))<>command_data->>'gstin' then raise exception 'The file GSTIN does not match the selected business';end if;
  if exists(select 1 from jsonb_array_elements(command_data->'rows') r where jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'rowKey') is distinct from 'string' or length(r->>'rowKey') not between 1 and 300) or (select count(*)<>count(distinct r->>'rowKey') from jsonb_array_elements(command_data->'rows') r) then raise exception 'Imported document rows need unique identifiers';end if;
  file_hash=encode(sha256(convert_to(raw,'UTF8')),'hex');
  insert into public.billing_gstr2b_imports(business_id,demo,period,gstin,file_sha256,rows,actor_id) values(business,data_mode,command_data->>'period',command_data->>'gstin',file_hash,command_data->'rows',auth.uid()) returning * into snapshot;
  result=jsonb_build_object('import',to_jsonb(snapshot),'replayed',false);
 else
  if command_data-array['importId','rowKey','decision']<>'{}'::jsonb or coalesce(command_data->>'importId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or coalesce(command_data->>'decision','') not in ('accept','follow-up','ignore') or jsonb_typeof(command_data->'rowKey') is distinct from 'string' or length(command_data->>'rowKey') not between 1 and 300 then raise exception 'Choose an import, reconciliation row and decision';end if;
  select * into snapshot from public.billing_gstr2b_imports i where i.id=(command_data->>'importId')::uuid and i.business_id=business and i.demo=data_mode;
  if snapshot.id is null then raise exception using errcode='P0002',message='GSTR-2B import unavailable in this business and data mode';end if;
  row_key=command_data->>'rowKey';
  if not exists(select 1 from jsonb_array_elements(snapshot.rows) r where r->>'rowKey'=row_key) and not exists(select 1 from public.billing_vendor_bills b where 'book:bill:'||b.id::text=row_key and b.business_id=business and b.demo=data_mode and b.status='issued' and to_char((b.data->>'date')::date,'MMYYYY')=snapshot.period) and not exists(select 1 from public.billing_posted_expenses e where 'book:expense:'||e.expense_id::text=row_key and e.business_id=business and e.demo=data_mode and to_char(e.date,'MMYYYY')=snapshot.period and e.snapshot->'accounting'->>'taxTreatment'='reviewed-itc') then raise exception 'Reconciliation row is not in this import or its books';end if;
  insert into public.billing_gstr2b_decisions(business_id,demo,import_id,row_key,decision,actor_id) values(business,data_mode,snapshot.id,row_key,command_data->>'decision',auth.uid()) returning * into decision_row;
  result=jsonb_build_object('decision',to_jsonb(decision_row),'replayed',false);
 end if;
 insert into public.billing_gstr2b_commands(business_id,demo,command_id,actor_id,request,result) values(business,data_mode,command_id,auth.uid(),request,result);return result;
end$$;
create function public.billing_gstr2b_read(business uuid,data_mode boolean,period text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare imports jsonb; decisions jsonb; bills jsonb; expenses jsonb; period_end date;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='GSTR-2B reconciliation unavailable in this business';end if;
 if data_mode is null or coalesce(period,'')!~'^(0[1-9]|1[0-2])[0-9]{4}$' then raise exception 'Choose a valid return period';end if;
 period_end=(to_date(period,'MMYYYY')+interval '1 month - 1 day')::date;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc,i.id desc),'[]'::jsonb) into imports from public.billing_gstr2b_imports i where i.business_id=business and i.demo=data_mode and i.period=billing_gstr2b_read.period;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at,d.id),'[]'::jsonb) into decisions from public.billing_gstr2b_decisions d join public.billing_gstr2b_imports i on i.id=d.import_id where d.business_id=business and d.demo=data_mode and i.period=billing_gstr2b_read.period;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'data',b.data) order by b.id),'[]'::jsonb) into bills from public.billing_vendor_bills b where b.business_id=business and b.demo=data_mode and b.status='issued' and to_char((b.data->>'date')::date,'MMYYYY')=billing_gstr2b_read.period and not exists(select 1 from public.billing_ledger_batches r where r.reverses_id=b.issued_batch and r.date<=period_end);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.expense_id,'data',e.snapshot) order by e.expense_id),'[]'::jsonb) into expenses from public.billing_posted_expenses e where e.business_id=business and e.demo=data_mode and to_char(e.date,'MMYYYY')=billing_gstr2b_read.period and e.snapshot->'accounting'->>'taxTreatment'='reviewed-itc' and not exists(select 1 from public.billing_expense_reversals r where r.expense_id=e.expense_id and r.date<=period_end);
 return jsonb_build_object('business',business,'demo',data_mode,'period',period,'canWrite',public.billing_can_access(business,true),'imports',imports,'decisions',decisions,'bills',bills,'expenses',expenses);
end$$;
revoke all on function public.billing_gstr2b_parse(jsonb) from public,anon,authenticated;
revoke all on function public.billing_gstr2b_command(uuid,boolean,uuid,text,jsonb),public.billing_gstr2b_read(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.billing_gstr2b_command(uuid,boolean,uuid,text,jsonb),public.billing_gstr2b_read(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
