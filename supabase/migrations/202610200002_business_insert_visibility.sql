-- INSERT ... RETURNING must be able to read its new owner row in the same command.
drop policy business_read on public.billing_businesses;
create policy business_read on public.billing_businesses for select to authenticated
using(owner_id=(select auth.uid()) or public.billing_can_access(id));
notify pgrst,'reload schema';
