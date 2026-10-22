-- Independent application data. Supabase Auth owns identities; every row is scoped to a business.
create table public.billing_businesses (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 180), currency text not null default 'INR' check(currency ~ '^[A-Z]{3}$'),
 created_at timestamptz not null default now()
);
create table public.billing_members (
 business_id uuid not null references public.billing_businesses(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','admin','editor','viewer')), created_at timestamptz not null default now(),
 primary key(business_id,user_id)
);
create function public.billing_can_access(b uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
 or exists(select 1 from public.billing_members where business_id=b and user_id=(select auth.uid()) and (not writing or role in ('owner','admin','editor')))
$$;
create function public.billing_is_owner(b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
$$;
revoke all on function public.billing_can_access(uuid,boolean), public.billing_is_owner(uuid) from public;
grant execute on function public.billing_can_access(uuid,boolean), public.billing_is_owner(uuid) to authenticated;
create table public.billing_records (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.billing_businesses(id),
 collection text not null check(collection in ('documents','clients','vendors','items','expenses','leads','subscriptions','journals','payments','shipments','settings')),
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=524288),
 demo boolean not null default false, archived boolean not null default false,
 version integer not null default 1 check(version>0), created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint billing_positive_amount check(collection not in ('expenses','payments','subscriptions') or (data->>'amount')::numeric>=0),
 constraint billing_positive_stock check(collection<>'items' or (data->>'quantity')::numeric>=0)
);
create index billing_records_lookup on public.billing_records(business_id,collection,demo,archived,updated_at desc);
create unique index billing_document_numbers on public.billing_records(business_id,demo,(data->>'type'),(data->>'number')) where collection='documents' and not archived;
create table public.billing_audit (
 id bigint generated always as identity primary key, business_id uuid not null references public.billing_businesses(id), record_id uuid not null,
 actor_id uuid default auth.uid(), action text not null, version integer not null, created_at timestamptz not null default now()
);
create function public.billing_record_guard() returns trigger language plpgsql set search_path='' as $$
 begin
  if tg_op='UPDATE' then
   if new.business_id<>old.business_id or new.collection<>old.collection or new.created_by<>old.created_by or new.demo<>old.demo then raise exception 'Record identity cannot be changed'; end if;
   new.version=old.version+1; new.created_at=old.created_at;
  else new.version=1; end if;
  new.updated_at=now(); return new;
 end
$$;
create trigger billing_record_guard before insert or update on public.billing_records for each row execute function public.billing_record_guard();
create function public.billing_record_audit() returns trigger language plpgsql security definer set search_path='' as $$
 begin
  insert into public.billing_audit(business_id,record_id,actor_id,action,version)
  values(new.business_id,new.id,auth.uid(),case when tg_op='INSERT' then 'created' when new.archived then 'archived' else 'updated' end,new.version);
  return new;
 end
$$;
create trigger billing_record_audit after insert or update on public.billing_records for each row execute function public.billing_record_audit();
alter table public.billing_businesses enable row level security;
alter table public.billing_members enable row level security;
alter table public.billing_records enable row level security;
alter table public.billing_audit enable row level security;
revoke all on public.billing_businesses, public.billing_members, public.billing_records, public.billing_audit from anon;
revoke all on public.billing_businesses, public.billing_members, public.billing_records, public.billing_audit from authenticated;
grant select,insert,update on public.billing_businesses, public.billing_records to authenticated;
grant select,insert,update,delete on public.billing_members to authenticated;
grant select on public.billing_audit to authenticated;
create policy business_read on public.billing_businesses for select to authenticated using(public.billing_can_access(id));
create policy business_create on public.billing_businesses for insert to authenticated with check(owner_id=(select auth.uid()));
create policy business_update on public.billing_businesses for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy member_read on public.billing_members for select to authenticated using(public.billing_can_access(business_id));
create policy member_create on public.billing_members for insert to authenticated with check(public.billing_is_owner(business_id));
create policy member_update on public.billing_members for update to authenticated using(public.billing_is_owner(business_id)) with check(public.billing_is_owner(business_id));
create policy member_remove on public.billing_members for delete to authenticated using(public.billing_is_owner(business_id));
create policy record_read on public.billing_records for select to authenticated using(public.billing_can_access(business_id));
create policy record_create on public.billing_records for insert to authenticated with check(public.billing_can_access(business_id,true) and created_by=(select auth.uid()));
create policy record_update on public.billing_records for update to authenticated using(public.billing_can_access(business_id,true)) with check(public.billing_can_access(business_id,true));
create policy audit_read on public.billing_audit for select to authenticated using(public.billing_can_access(business_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('billing-files','billing-files',false,5242880,array['application/pdf','image/png','image/jpeg','image/webp','text/csv']) on conflict(id) do nothing;
create policy billing_file_read on storage.objects for select to authenticated using(bucket_id='billing-files' and public.billing_can_access(((storage.foldername(name))[1])::uuid));
create policy billing_file_create on storage.objects for insert to authenticated with check(bucket_id='billing-files' and public.billing_can_access(((storage.foldername(name))[1])::uuid,true));
create policy billing_file_remove on storage.objects for delete to authenticated using(bucket_id='billing-files' and public.billing_can_access(((storage.foldername(name))[1])::uuid,true));
notify pgrst,'reload schema';
