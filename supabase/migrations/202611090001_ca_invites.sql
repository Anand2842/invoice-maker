-- An accountant invites a client by link. The client opens the link, creates (or already owns) a business, and agrees
-- on screen; redeeming the link adds the accountant to that business as admin (records only; the owner alone manages
-- team and settings). Raw link secrets are never stored, only a hash. Every step is audited in billing_team_audit.
create table public.billing_ca_invites(
 id uuid primary key default gen_random_uuid(),
 ca_user_id uuid not null references auth.users(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 used_at timestamptz,
 used_by uuid references auth.users(id),
 used_business uuid references public.billing_businesses(id)
);
alter table public.billing_ca_invites enable row level security;
revoke all on public.billing_ca_invites from public, anon, authenticated;

-- Tokens issued to AI connector apps carry a client_id claim; they may never create or redeem these links.
create function public.billing_ca_is_connector() returns boolean language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id','')<>''
$$;

create function public.billing_ca_invite_create(raw_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invite uuid;
begin
 if (select auth.uid()) is null or public.billing_ca_is_connector() then raise exception 'Sign in with your own account to invite clients' using errcode='42501'; end if;
 if raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 if (select count(*) from public.billing_ca_invites where ca_user_id=(select auth.uid()) and used_at is null and revoked_at is null and expires_at>now())>=20 then
  raise exception 'You have 20 open client links. Revoke one before making another' using errcode='22023'; end if;
 insert into public.billing_ca_invites(ca_user_id,token_hash,expires_at)
 values((select auth.uid()),encode(sha256(convert_to(raw_token,'UTF8')),'hex'),now()+interval '7 days') returning id into invite;
 return invite;
end $$;

-- What the client sees before agreeing: who is asking. Reveals nothing unless the secret link is valid.
create function public.billing_ca_invite_info(raw_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.billing_ca_invites%rowtype; who text;
begin
 if (select auth.uid()) is null or public.billing_ca_is_connector() then raise exception 'Sign in with your own account' using errcode='42501'; end if;
 select * into i from public.billing_ca_invites where token_hash=encode(sha256(convert_to(coalesce(raw_token,''),'UTF8')),'hex');
 if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at<=now() then return jsonb_build_object('valid',false); end if;
 select coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),u.email) into who from auth.users u where u.id=i.ca_user_id;
 return jsonb_build_object('valid',true,'accountant',who,'selfInvite',i.ca_user_id=(select auth.uid()));
end $$;

create function public.billing_ca_invite_redeem(raw_token text, business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.billing_ca_invites%rowtype; existing text;
begin
 if (select auth.uid()) is null or public.billing_ca_is_connector() then raise exception 'Sign in with your own account' using errcode='42501'; end if;
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can add their accountant' using errcode='42501'; end if;
 select * into i from public.billing_ca_invites where token_hash=encode(sha256(convert_to(coalesce(raw_token,''),'UTF8')),'hex') for update;
 if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at<=now() then raise exception 'This invitation link is not valid any more' using errcode='22023'; end if;
 if i.ca_user_id=(select auth.uid()) then raise exception 'You cannot use your own client link' using errcode='22023'; end if;
 select role into existing from public.billing_members where business_id=business and user_id=i.ca_user_id for update;
 if existing is null then insert into public.billing_members(business_id,user_id,role) values(business,i.ca_user_id,'admin'); end if;
 update public.billing_ca_invites set used_at=now(),used_by=(select auth.uid()),used_business=business where id=i.id;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(business,(select auth.uid()),i.ca_user_id,'accountant_added');
 return jsonb_build_object('business',business,'accountantId',i.ca_user_id,'role',coalesce(existing,'admin'),'alreadyMember',existing is not null);
end $$;

create function public.billing_ca_invite_revoke(invite uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or public.billing_ca_is_connector() then raise exception 'Sign in with your own account' using errcode='42501'; end if;
 update public.billing_ca_invites set revoked_at=now() where id=invite and ca_user_id=(select auth.uid()) and used_at is null and revoked_at is null;
 return found;
end $$;

create function public.billing_ca_invite_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or public.billing_ca_is_connector() then raise exception 'Sign in with your own account' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'createdAt',i.created_at,'expiresAt',i.expires_at,'revokedAt',i.revoked_at,'usedAt',i.used_at,
   'business',case when m.user_id is not null then b.name end) order by i.created_at desc)
  from (select * from public.billing_ca_invites where ca_user_id=(select auth.uid()) order by created_at desc limit 50) i
  left join public.billing_businesses b on b.id=i.used_business
  left join public.billing_members m on m.business_id=i.used_business and m.user_id=(select auth.uid())),'[]'::jsonb);
end $$;

revoke all on function public.billing_ca_is_connector(), public.billing_ca_invite_create(text), public.billing_ca_invite_info(text),
 public.billing_ca_invite_redeem(text,uuid), public.billing_ca_invite_revoke(uuid), public.billing_ca_invite_list() from public, anon;
grant execute on function public.billing_ca_invite_create(text), public.billing_ca_invite_info(text),
 public.billing_ca_invite_redeem(text,uuid), public.billing_ca_invite_revoke(uuid), public.billing_ca_invite_list() to authenticated;
