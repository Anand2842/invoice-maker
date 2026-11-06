-- Supabase default privileges grant EXECUTE on new public functions to anon. The access helpers were only revoked
-- from PUBLIC, so anonymous RPC callers could still invoke them. Every policy using them is scoped to authenticated.
revoke execute on function public.billing_can_access(uuid,boolean),public.billing_is_owner(uuid) from anon;
