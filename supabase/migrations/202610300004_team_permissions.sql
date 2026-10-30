-- Owner-managed team membership. Invitation secrets are never persisted in clear text.
create table public.billing_team_invites (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.billing_businesses(id),
 email text not null check(length(email) between 3 and 254), role text not null check(role in ('admin','editor','viewer')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 revoked_at timestamptz, accepted_at timestamptz, accepted_by uuid references auth.users(id)
);
create table public.billing_team_audit (
 id bigint generated always as identity primary key, business_id uuid not null references public.billing_businesses(id),
 actor_id uuid not null references auth.users(id), subject_id uuid, action text not null, created_at timestamptz not null default now()
);
alter table public.billing_team_invites enable row level security;
alter table public.billing_team_audit enable row level security;
revoke all on public.billing_team_invites,public.billing_team_audit from public,anon,authenticated;
-- Raw membership writes would bypass owner invariants and audit; commands are authoritative.
revoke insert,update,delete,truncate,references,trigger on public.billing_members from authenticated;
create function public.billing_team_list(business uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501'; end if;
 return jsonb_build_object('ownerId',(select owner_id from public.billing_businesses where id=business),
 'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role)) from public.billing_members m join auth.users u on u.id=m.user_id where m.business_id=business),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'expiresAt',i.expires_at,'revokedAt',i.revoked_at,'acceptedAt',i.accepted_at) order by i.created_at desc) from public.billing_team_invites i where i.business_id=business),'[]'::jsonb));
end $$;
create function public.billing_team_invite(business uuid,invite_email text,invite_role text,raw_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation uuid;
begin
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 perform 1 from public.billing_businesses where id=business for update;
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 if invite_role is null or invite_role not in ('admin','editor','viewer') or invite_email is null or length(invite_email)>254 or lower(trim(invite_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid team invitation' using errcode='22023';end if;
 -- Reissuing invalidates older outstanding links for this address.
 update public.billing_team_invites set revoked_at=now() where business_id=business and email=lower(trim(invite_email)) and accepted_at is null and revoked_at is null;
 insert into public.billing_team_invites(business_id,email,role,token_hash,expires_at,created_by)
 values(business,lower(trim(invite_email)),invite_role,encode(sha256(convert_to(raw_token,'UTF8')),'hex'),now()+interval '7 days',auth.uid()) returning id into invitation;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(business,auth.uid(),invitation,'invited');
 return invitation;
end $$;
create function public.billing_team_change(business uuid,member_id uuid,member_role text default null,remove_member boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare owner_user uuid; existing_role text;
begin
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 select owner_id into owner_user from public.billing_businesses where id=business for update;
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 select role into existing_role from public.billing_members where business_id=business and user_id=member_id for update;
 if member_id=owner_user or existing_role='owner' then raise exception 'Owner membership cannot be changed' using errcode='22023';end if;
 if existing_role is null then raise exception 'Team member unavailable' using errcode='22023';end if;
 if remove_member then delete from public.billing_members where business_id=business and user_id=member_id;
 else
  if member_role is null or member_role not in ('admin','editor','viewer') then raise exception 'Invalid team role' using errcode='22023';end if;
  update public.billing_members set role=member_role where business_id=business and user_id=member_id;
 end if;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(business,auth.uid(),member_id,case when remove_member then 'removed' else 'role_changed:'||member_role end);
 return true;
end $$;
create function public.billing_team_revoke(business uuid,invitation_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 perform 1 from public.billing_businesses where id=business for update;
 if not public.billing_is_owner(business) then raise exception 'Only the business owner can manage the team' using errcode='42501';end if;
 update public.billing_team_invites set revoked_at=coalesce(revoked_at,now()) where id=invitation_id and business_id=business and accepted_at is null;
 if not found then raise exception 'Invitation unavailable' using errcode='22023';end if;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(business,auth.uid(),invitation_id,'invite_revoked');
 return true;
end $$;
create function public.billing_team_accept(raw_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.billing_team_invites; target_business uuid; verified_email text;
begin
 if auth.uid() is null then raise exception 'Sign in to accept this invitation' using errcode='42501';end if;
 if raw_token is null or raw_token !~ '^[a-f0-9]{64}$' then raise exception 'Invitation unavailable or expired' using errcode='22023';end if;
 select business_id into target_business from public.billing_team_invites where token_hash=encode(sha256(convert_to(raw_token,'UTF8')),'hex');
 -- All mutations lock business before invitation to avoid lock-order inversions.
 perform 1 from public.billing_businesses where id=target_business for update;
 select * into invitation from public.billing_team_invites where token_hash=encode(sha256(convert_to(raw_token,'UTF8')),'hex') for update;
 select lower(trim(email)) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if invitation.id is null or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at<=now() or verified_email is null or verified_email<>invitation.email then raise exception 'Invitation unavailable, expired, or for a different verified email' using errcode='22023';end if;
 -- Existing members retain their current permissions; an invite never overwrites a role.
 if not public.billing_is_owner(invitation.business_id) then
  insert into public.billing_members(business_id,user_id,role) values(invitation.business_id,auth.uid(),invitation.role) on conflict(business_id,user_id) do nothing;
 end if;
 update public.billing_team_invites set accepted_at=now(),accepted_by=auth.uid() where id=invitation.id;
 insert into public.billing_team_audit(business_id,actor_id,subject_id,action) values(invitation.business_id,auth.uid(),auth.uid(),'invite_accepted');
 return invitation.business_id;
end $$;
revoke all on function public.billing_team_list(uuid),public.billing_team_invite(uuid,text,text,text),public.billing_team_change(uuid,uuid,text,boolean),public.billing_team_revoke(uuid,uuid),public.billing_team_accept(text) from public,anon;
grant execute on function public.billing_team_list(uuid),public.billing_team_invite(uuid,text,text,text),public.billing_team_change(uuid,uuid,text,boolean),public.billing_team_revoke(uuid,uuid),public.billing_team_accept(text) to authenticated;
notify pgrst,'reload schema';
