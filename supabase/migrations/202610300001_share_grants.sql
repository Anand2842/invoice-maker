-- Supabase default privileges can grant TRUNCATE, which bypasses row-level security.
-- Sharing writes stay behind the existing checked SECURITY DEFINER commands.
-- Preserve member-scoped reads; narrow privileges without rewriting any shares.
revoke all on public.billing_shares from public,anon,authenticated;
grant select on public.billing_shares to authenticated;
notify pgrst,'reload schema';
