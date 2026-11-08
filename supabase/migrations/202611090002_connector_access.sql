-- AI connector apps (Claude, ChatGPT) sign in through Supabase's OAuth server. Their tokens are ordinary user tokens plus
-- a client_id claim, so the limits must live in the database. Rules:
--  * a token with a client_id reaches a business only through an active grant the user created in their own web session;
--  * it can READ what the grant covers (and only while the user still has access themselves);
--  * it can never pass a write check, so every existing command (issue, cancel, payments, team, settings, sharing,
--    payment links, automation, deleting a business) is refused for it automatically;
--  * it can never be an owner, create or edit a business, or manage grants.
-- Connector writes (drafts) will be separate, narrow functions added in a later migration.
create table public.billing_connector_grants(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 business_id uuid not null references public.billing_businesses(id),
 client_id text not null check(length(client_id) between 1 and 200),
 can_draft boolean not null default false,
 created_at timestamptz not null default now(),
 revoked_at timestamptz
);
create unique index billing_connector_grants_active on public.billing_connector_grants(user_id,business_id,client_id) where revoked_at is null;
alter table public.billing_connector_grants enable row level security;
revoke all on public.billing_connector_grants from public, anon, authenticated;

create function public.billing_connector_client() returns text language sql stable set search_path='' as $$
 select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id','')
$$;

create function public.billing_connector_grant(b uuid, need_draft boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_connector_grants g
  where g.user_id=(select auth.uid()) and g.business_id=b and g.client_id=public.billing_connector_client() and g.revoked_at is null and (not need_draft or g.can_draft))
$$;

-- Same rule as before for web sessions. A connector token additionally needs an active read grant and can never write.
create or replace function public.billing_can_access(b uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.billing_business_deletions d where d.business_id=b) and (
  case when public.billing_connector_client() is not null then
   not writing and public.billing_connector_grant(b) and (
    exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
    or exists(select 1 from public.billing_members where business_id=b and user_id=(select auth.uid())))
  else
   exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
   or exists(select 1 from public.billing_members where business_id=b and user_id=(select auth.uid()) and (not writing or role in ('owner','admin','editor')))
  end)
$$;
create or replace function public.billing_is_owner(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.billing_connector_client() is null
  and exists(select 1 from public.billing_businesses where id=b and owner_id=(select auth.uid()))
  and not exists(select 1 from public.billing_business_deletions d where d.business_id=b)
$$;
create or replace function public.billing_crm_writer(business uuid,user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.billing_connector_client() is null and (
  exists(select 1 from public.billing_businesses b where b.id=business and b.owner_id=user_id)
  or exists(select 1 from public.billing_members m where m.business_id=business and m.user_id=billing_crm_writer.user_id and m.role in ('owner','admin','editor')))
$$;

drop policy business_create on public.billing_businesses;
create policy business_create on public.billing_businesses for insert to authenticated
 with check(owner_id=(select auth.uid()) and public.billing_connector_client() is null);
drop policy business_update on public.billing_businesses;
create policy business_update on public.billing_businesses for update to authenticated
 using(owner_id=(select auth.uid()) and not public.billing_business_deleted(id) and public.billing_connector_client() is null)
 with check(owner_id=(select auth.uid()));
drop policy business_read on public.billing_businesses;
create policy business_read on public.billing_businesses for select to authenticated
 using(public.billing_can_access(id) or (owner_id=(select auth.uid()) and not public.billing_business_deleted(id) and public.billing_connector_client() is null));

-- This function checked ownership directly instead of through billing_is_owner, so it needs its own refusal.
create or replace function public.billing_delete_business(business uuid, confirm_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.billing_businesses%rowtype;
begin
 -- Deleting a business is a website action by its owner; an AI connector token can never do it.
 if public.billing_connector_client() is not null then raise exception using errcode='P0002', message='Business unavailable'; end if;
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

-- Accounting reviewers decide review packets; a connector token must never count as a reviewer.
create or replace function public.billing_accounting_can_review(business uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.billing_connector_client() is null and auth.uid() is not null and public.billing_can_access(business)
  and (public.billing_is_owner(business) or exists(select 1 from public.billing_accounting_reviewers r where r.business_id=business and r.user_id=auth.uid() and r.enabled))
$$;

-- Managing grants: only the user's own web session (no client_id), only for a business they can reach.
create function public.billing_connector_grant_set(business uuid, app text, allow_draft boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare g uuid;
begin
 if (select auth.uid()) is null or public.billing_connector_client() is not null then raise exception 'Only you, signed in on the website, can manage app access' using errcode='42501'; end if;
 if not public.billing_can_access(business) then raise exception 'Business unavailable' using errcode='42501'; end if;
 if app is null or length(app) not between 1 and 200 then raise exception 'Invalid app' using errcode='22023'; end if;
 update public.billing_connector_grants set revoked_at=now() where user_id=(select auth.uid()) and business_id=business and client_id=app and revoked_at is null;
 insert into public.billing_connector_grants(user_id,business_id,client_id,can_draft) values((select auth.uid()),business,app,coalesce(allow_draft,false)) returning id into g;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(business,(select auth.uid()),g,'connector_granted:'||case when coalesce(allow_draft,false) then 'draft' else 'read' end);
 return g;
end $$;
create function public.billing_connector_grant_revoke(grant_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare b uuid;
begin
 if (select auth.uid()) is null or public.billing_connector_client() is not null then raise exception 'Only you, signed in on the website, can manage app access' using errcode='42501'; end if;
 update public.billing_connector_grants set revoked_at=now() where id=grant_id and user_id=(select auth.uid()) and revoked_at is null returning business_id into b;
 if b is null then return false; end if;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(b,(select auth.uid()),grant_id,'connector_revoked');
 return true;
end $$;
create function public.billing_connector_grants_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or public.billing_connector_client() is not null then raise exception 'Only you, signed in on the website, can manage app access' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'business',b.name,'businessId',g.business_id,'app',g.client_id,'canDraft',g.can_draft,'createdAt',g.created_at,'revokedAt',g.revoked_at) order by g.created_at desc)
  from public.billing_connector_grants g join public.billing_businesses b on b.id=g.business_id where g.user_id=(select auth.uid())),'[]'::jsonb);
end $$;

revoke all on function public.billing_connector_client(), public.billing_connector_grant(uuid,boolean), public.billing_connector_grant_set(uuid,text,boolean),
 public.billing_connector_grant_revoke(uuid), public.billing_connector_grants_list() from public, anon;
-- Policies call this as the signed-in role; it only reports the caller's own client_id claim.
grant execute on function public.billing_connector_client() to authenticated;
grant execute on function public.billing_connector_grant_set(uuid,text,boolean), public.billing_connector_grant_revoke(uuid), public.billing_connector_grants_list() to authenticated;
