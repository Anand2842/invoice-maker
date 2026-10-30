-- A business calendar setting affects new defaults, never stored document dates.
alter table public.billing_businesses add column time_zone text not null default 'Asia/Kolkata';
create function public.billing_business_time_zone_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if length(new.time_zone)>100 or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Select a valid IANA business time zone';end if;
 return new;
end $$;
create trigger billing_business_time_zone_guard before insert or update of time_zone on public.billing_businesses for each row execute function public.billing_business_time_zone_guard();
notify pgrst,'reload schema';
