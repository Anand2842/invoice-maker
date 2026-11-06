-- Read-only audit trail across record, ledger, bank, inventory and team audit tables.
-- Members with access see record, ledger, bank and inventory entries for the chosen data mode; team membership
-- changes are shown to the owner only (they already have no member read policy). Newest first, keyset paginated.
create index if not exists billing_audit_business_created on public.billing_audit(business_id,created_at desc);
create index if not exists billing_ledger_audit_business_created on public.billing_ledger_audit(business_id,demo,created_at desc);
create index if not exists billing_bank_audit_business_created on public.billing_bank_audit(business_id,demo,created_at desc);
create index if not exists billing_inventory_audit_business_created on public.billing_inventory_audit(business_id,demo,created_at desc);
create index if not exists billing_team_audit_business_created on public.billing_team_audit(business_id,created_at desc);

create function public.billing_audit_trail(business uuid,data_mode boolean,area text default null,cursor_at timestamptz default null,cursor_key text default null,page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner boolean;rows jsonb;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='You do not have access to this business'; end if;
 if area is not null and area not in ('records','ledger','bank','inventory','team') then raise exception 'Choose a valid audit area'; end if;
 if page_size is null or page_size<1 or page_size>200 then raise exception 'Page size must be between 1 and 200'; end if;
 if (cursor_at is null)<>(cursor_key is null) then raise exception 'Invalid audit cursor'; end if;
 owner:=public.billing_is_owner(business);
 with entries as (
  select a.created_at at,'records:'||lpad(a.id::text,20,'0') key,'records' area,a.actor_id,a.action,
   jsonb_build_object('collection',r.collection,'record',r.id,'label',coalesce(nullif(r.data->>'number',''),nullif(r.data->>'name',''),r.collection),'version',a.version) details
  from public.billing_audit a join public.billing_records r on r.id=a.record_id and r.business_id=a.business_id
  where a.business_id=business and r.demo=data_mode and (area is null or area='records')
  union all
  select l.created_at,'ledger:'||lpad(l.id::text,20,'0'),'ledger',l.actor_id,l.action,l.details from public.billing_ledger_audit l where l.business_id=business and l.demo=data_mode and (area is null or area='ledger')
  union all
  select b.created_at,'bank:'||lpad(b.id::text,20,'0'),'bank',b.actor_id,b.action,b.details from public.billing_bank_audit b where b.business_id=business and b.demo=data_mode and (area is null or area='bank')
  union all
  select i.created_at,'inventory:'||i.id::text,'inventory',i.actor_id,i.action,i.details from public.billing_inventory_audit i where i.business_id=business and i.demo=data_mode and (area is null or area='inventory')
  union all
  select t.created_at,'team:'||lpad(t.id::text,20,'0'),'team',t.actor_id,t.action,jsonb_build_object('subject',t.subject_id) from public.billing_team_audit t where owner and t.business_id=business and (area is null or area='team')
 ), page as (
  select e.* from entries e where cursor_at is null or (e.at,e.key)<(cursor_at,cursor_key) order by e.at desc,e.key desc limit page_size+1
 )
 select coalesce(jsonb_agg(jsonb_build_object('at',p.at,'key',p.key,'area',p.area,'action',p.action,'details',p.details,'actor',coalesce(to_jsonb(u)->>'email',p.actor_id::text,'System')) order by p.at desc,p.key desc),'[]') into rows
 from page p left join auth.users u on u.id=p.actor_id;
 return jsonb_build_object('owner',owner,'entries',(select coalesce(jsonb_agg(x),'[]') from (select x from jsonb_array_elements(rows) with ordinality t(x,n) where n<=page_size order by n) s),
  'next',case when jsonb_array_length(rows)>page_size then jsonb_build_object('at',rows->(page_size-1)->>'at','key',rows->(page_size-1)->>'key') end);
end $$;
revoke all on function public.billing_audit_trail(uuid,boolean,text,timestamptz,text,integer) from public,anon;
grant execute on function public.billing_audit_trail(uuid,boolean,text,timestamptz,text,integer) to authenticated;
