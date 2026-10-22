-- Existing business_update RLS already limits profile changes to the owner.
alter table public.billing_businesses
 add column logo_path text,
 add column address text not null default '', add column phone text not null default '',
 add column email text not null default '', add column gstin text not null default '', add column pan text not null default '',
 add column bank_name text not null default '', add column bank_account text not null default '',
 add column bank_ifsc text not null default '', add column bank_upi text not null default '',
 add column default_terms text not null default '', add column default_notes text not null default '',
 add column default_tax_rate numeric not null default 0 check(default_tax_rate between 0 and 100),
 add column invoice_prefix text not null default 'INV' check(invoice_prefix ~ '^[A-Za-z0-9-]{1,20}$'),
 add column invoice_next_number bigint not null default 1 check(invoice_next_number between 1 and 999999999),
 add column brand_color text not null default '#3c136b' check(brand_color ~ '^#[0-9a-fA-F]{6}$'),
 add column profile_version integer not null default 1,
 add column updated_at timestamptz not null default now(),
 add constraint billing_logo_scope check(logo_path is null or split_part(logo_path,'/',1)=id::text);
create function public.billing_profile_stamp() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now();new.profile_version=old.profile_version+1;return new;end $$;
create trigger billing_profile_stamp before update on public.billing_businesses for each row execute function public.billing_profile_stamp();
create function public.billing_next_document_number(business uuid) returns text
language plpgsql security definer set search_path='' as $$
declare b public.billing_businesses; candidate text;
begin
 if not public.billing_can_access(business,true) then raise exception 'Business unavailable';end if;
 select * into b from public.billing_businesses where id=business for update;
 loop
  if b.invoice_next_number>999999999 then raise exception 'Document sequence exhausted';end if;
  candidate=b.invoice_prefix||'-'||lpad(b.invoice_next_number::text,greatest(6,length(b.invoice_next_number::text)), '0');
  b.invoice_next_number=b.invoice_next_number+1;
  exit when not exists(select 1 from public.billing_records where business_id=business and collection='documents' and data->>'number'=candidate);
 end loop;
 update public.billing_businesses set invoice_next_number=b.invoice_next_number where id=business;
 return candidate;
end $$;
revoke all on function public.billing_next_document_number(uuid) from public,anon;
grant execute on function public.billing_next_document_number(uuid) to authenticated;
create function public.billing_duplicate_document(source_id uuid,source_version integer,document_data jsonb) returns public.billing_records
language plpgsql security invoker set search_path='' as $$
declare source public.billing_records; result public.billing_records; number text;
begin
 select * into source from public.billing_records where id=source_id for update;
 if source.id is null or source.collection<>'documents' or source.archived or not public.billing_can_access(source.business_id,true) then raise exception 'Document unavailable';end if;
 if source.version<>source_version then raise exception 'Document changed';end if;
 number=public.billing_next_document_number(source.business_id);
 insert into public.billing_records(business_id,collection,data,demo,created_by)
 values(source.business_id,'documents',document_data||jsonb_build_object('number',number,'status','draft'),source.demo,auth.uid()) returning * into result;
 return result;
end $$;
revoke all on function public.billing_duplicate_document(uuid,integer,jsonb) from public,anon;
grant execute on function public.billing_duplicate_document(uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
