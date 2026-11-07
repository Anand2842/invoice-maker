-- Owners can delete a business. Journals, payments and the audit trail are append-only by design, so the rows stay in
-- place; the business is marked deleted, every membership is removed and every access check treats it as gone.
-- Anything that reaches outside Folio is switched off: reminders, recurring invoices, payment links, share links
-- and queued emails.
create table public.billing_business_deletions(
 business_id uuid primary key references public.billing_businesses(id),
 deleted_by uuid not null references auth.users(id),
 business_name text not null,
 deleted_at timestamptz not null default now()
);
alter table public.billing_business_deletions enable row level security;
revoke all on public.billing_business_deletions from public, anon, authenticated;

create function public.billing_business_deleted(b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_business_deletions d where d.business_id=b)
$$;
revoke all on function public.billing_business_deleted(uuid) from public, anon;
grant execute on function public.billing_business_deleted(uuid) to authenticated;

create or replace function public.billing_can_access(b uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.billing_business_deletions d where d.business_id=b) and (
  exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
  or exists(select 1 from public.billing_members where business_id=b and user_id=(select auth.uid()) and (not writing or role in ('owner','admin','editor'))))
$$;
create or replace function public.billing_is_owner(b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
  and not exists(select 1 from public.billing_business_deletions d where d.business_id=b)
$$;

drop policy business_read on public.billing_businesses;
create policy business_read on public.billing_businesses for select to authenticated
 using(public.billing_can_access(id) or (owner_id=(select auth.uid()) and not public.billing_business_deleted(id)));
drop policy business_update on public.billing_businesses;
create policy business_update on public.billing_businesses for update to authenticated
 using(owner_id=(select auth.uid()) and not public.billing_business_deleted(id))
 with check(owner_id=(select auth.uid()));

create function public.billing_delete_business(business uuid, confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.billing_businesses%rowtype;
begin
 select * into b from public.billing_businesses where id=business for update;
 if not found or b.owner_id is distinct from (select auth.uid())
    or exists(select 1 from public.billing_business_deletions d where d.business_id=business) then
  raise exception using errcode='P0002', message='Business unavailable';
 end if;
 if confirm_name is null or btrim(confirm_name)<>btrim(b.name) then
  raise exception using errcode='22023', message='Type the business name exactly to confirm';
 end if;
 insert into public.billing_business_deletions(business_id,deleted_by,business_name) values(business,(select auth.uid()),b.name);
 delete from public.billing_members where business_id=business;
 update public.billing_automation_settings set reminders_enabled=false, recurring_enabled=false, updated_by=(select auth.uid()), updated_at=now() where business_id=business;
 update public.billing_gateway_settings set enabled=false, updated_by=(select auth.uid()), updated_at=now() where business_id=business;
 update public.billing_payment_links set status='cancelled' where business_id=business and status='open';
 if to_regclass('public.billing_shares') is not null then
  execute 'update public.billing_shares set revoked_at=now() where business_id=$1 and revoked_at is null' using business;
 end if;
 update public.billing_email_outbox set status='cancelled' where business_id=business and status='queued';
 return jsonb_build_object('business',business,'deleted',true);
end $$;
revoke all on function public.billing_delete_business(uuid,text) from public, anon;
grant execute on function public.billing_delete_business(uuid,text) to authenticated;
