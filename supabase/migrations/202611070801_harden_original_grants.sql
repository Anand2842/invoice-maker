-- The original tables kept Supabase's default grants on production: anon could INSERT, UPDATE, DELETE and TRUNCATE
-- them (row security blocked row writes, but TRUNCATE is not subject to it) and run the first payment, share and
-- numbering definers. Every policy is "to authenticated" and every definer checks access itself, so nothing used
-- these grants; this removes them so permissions, not only row security, keep anonymous callers out.
do $$
declare t record; f record;
begin
 for t in select tablename from pg_tables where schemaname='public' loop
  execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from anon', t.tablename);
  execute format('revoke truncate, references, trigger on table public.%I from authenticated', t.tablename);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p
  where p.pronamespace='public'::regnamespace and p.prosecdef
   and p.proname in ('billing_payment_readiness','billing_create_share','billing_record_payment','billing_reverse_payment','billing_revoke_share','billing_next_document_number')
 loop
  execute format('revoke execute on function %s from public, anon', f.sig);
  execute format('grant execute on function %s to authenticated', f.sig);
 end loop;
end $$;

alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;
