-- Direct customer receipts were only checked against the invoice obligation when the cash workspace was configured,
-- so serialized retries with distinct keys could overpay a legacy or non-cash invoice (found by scripts/pg-race-tests.mjs).
-- Excess customer cash belongs in the explicit cash/advance workflow, as the cash-mode guard already requires.
create function public.billing_receipt_obligation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare total numeric;
begin
 if exists(select 1 from public.billing_issued_documents where document_id=new.document_id) then
  perform public.billing_validate_customer_settlement(new.document_id,new.transaction_date);
 else
  -- Legacy invoices have no dated obligation movement, so treat the invoice total as owed from the start and check the
  -- running balance on every effective date from this receipt onward (a later reversal must not license an earlier overpayment).
  select (public.billing_document_totals(r.data)->'totals'->>'total')::numeric into total from public.billing_records r where r.id=new.document_id;
  if total is null or exists(select 1 from(select date,total+sum(sum(m.delta)) over(order by date) balance from public.billing_settlement_movements(new.document_id,'incoming') m group by date)x where x.date>=new.transaction_date and x.balance<0)
  then raise exception 'Settlement exceeds the dated invoice obligation; record excess customer cash through the explicit cash/advance workflow';end if;
 end if;
 return new;
end$$;
create trigger receipt_obligation_guard after insert on public.billing_payment_events for each row when (new.kind='receipt') execute function public.billing_receipt_obligation_guard();
revoke all on function public.billing_receipt_obligation_guard() from public,anon,authenticated;
