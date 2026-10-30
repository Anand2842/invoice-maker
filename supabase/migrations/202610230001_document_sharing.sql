-- Frozen PDF snapshots; tokens are only returned to the creator, never stored raw.
create extension if not exists pgcrypto with schema extensions;
create table public.billing_shares (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.billing_businesses(id),
 record_id uuid not null references public.billing_records(id), record_version integer not null,
 token_hash text not null unique check(length(token_hash)=64), password_hash text,
 pdf_base64 text not null check(length(pdf_base64) between 8 and 6000000),
 filename text not null check(filename ~ '^[a-zA-Z0-9._-]{1,180}\.pdf$'),
 allow_download boolean not null default true, expires_at timestamptz not null,
 revoked_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 views integer not null default 0, failures integer not null default 0, blocked_until timestamptz
);
alter table public.billing_shares enable row level security;
create policy billing_shares_read on public.billing_shares for select to authenticated using(public.billing_can_access(business_id,false));
revoke all on public.billing_shares from public,anon,authenticated;
grant select on public.billing_shares to authenticated;
create function public.billing_create_share(source_id uuid, source_version integer, raw_token text, pdf text, file_name text, expires timestamptz, password_text text default '', downloading boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.billing_records; new_id uuid;
begin
 select * into source from public.billing_records where id=source_id for share;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true) then raise exception 'Document unavailable';end if;
 if source.version is distinct from source_version then raise exception 'Document changed';end if;
 if raw_token is null or raw_token !~ '^[a-f0-9]{64}$' or pdf is null or length(pdf)>6000000 or pdf !~ '^[A-Za-z0-9+/=]+$' then raise exception 'Invalid share';end if;
 if expires is null or expires<=now() or expires>now()+interval '90 days' then raise exception 'Expiry must be within 90 days';end if;
 if password_text is null or (password_text<>'' and (length(password_text)<12 or octet_length(password_text)>72)) then raise exception 'Password must have 12 characters and at most 72 bytes';end if;
 insert into public.billing_shares(business_id,record_id,record_version,token_hash,password_hash,pdf_base64,filename,expires_at,allow_download,created_by)
 values(source.business_id,source.id,source.version,encode(extensions.digest(raw_token,'sha256'),'hex'),case when password_text='' then null else extensions.crypt(password_text,extensions.gen_salt('bf',8)) end,pdf,file_name,expires,coalesce(downloading,true),auth.uid()) returning id into new_id;
 return new_id;
end $$;
create function public.billing_revoke_share(share_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.billing_shares set revoked_at=coalesce(revoked_at,now()) where id=share_id and public.billing_can_access(business_id,true);
 return found;
end $$;
create function public.billing_open_share(raw_token text,password_text text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_shares;
begin
 if raw_token is null or raw_token !~ '^[a-f0-9]{64}$' or octet_length(coalesce(password_text,''))>72 then return null;end if;
 select * into s from public.billing_shares where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 if s.id is null or s.revoked_at is not null or s.expires_at<=now() or s.blocked_until>now() then return null;end if;
 if s.password_hash is not null and (coalesce(password_text,'')='' or extensions.crypt(password_text,s.password_hash)<>s.password_hash) then
   if coalesce(password_text,'')<>'' then update public.billing_shares set failures=case when failures>=9 then 0 else failures+1 end,blocked_until=case when failures>=9 then now()+interval '5 minutes' else null end where id=s.id;end if;
   return jsonb_build_object('requires_password',true);
 end if;
 update public.billing_shares set views=views+1,failures=0,blocked_until=null where id=s.id;
 return jsonb_build_object('pdf_base64',s.pdf_base64,'filename',s.filename,'allow_download',s.allow_download);
end $$;
revoke all on function public.billing_create_share(uuid,integer,text,text,text,timestamptz,text,boolean) from public,anon;
revoke all on function public.billing_revoke_share(uuid) from public,anon;
revoke all on function public.billing_open_share(text,text) from public;
grant execute on function public.billing_create_share(uuid,integer,text,text,text,timestamptz,text,boolean) to authenticated;
grant execute on function public.billing_revoke_share(uuid) to authenticated;
grant execute on function public.billing_open_share(text,text) to anon,authenticated;
