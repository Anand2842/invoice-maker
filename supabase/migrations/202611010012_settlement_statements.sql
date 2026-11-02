-- Full ledger-backed cash/advance paging and exact invoice payment context.
-- Read-only; no legacy cash is posted or existing records rewritten.
create view public.billing_cash_statement_events with(security_barrier=true) as
select j.business_id,j.demo,j.id as batch_id,j.date,j.number,substring(j.number from '([0-9]+)$')::bigint as sequence,j.description,
 case when rf.id is not null then 'refund-'||rf.kind when ce.id is not null then 'cash-'||ce.kind when ca.id is not null then 'cash-'||ca.kind
 when vc.id is not null then 'supplier-credit' when vr.id is not null then 'supplier-credit-reversal' when va.id is not null then 'credit-'||va.kind
 when pe.id is not null then 'payment-'||pe.kind when vp.id is not null then 'vendor-payment' when vpr.id is not null then 'vendor-payment-reversal'
 when ex.expense_id is not null then 'paid-expense' when sx.kind='expense.reversal' then 'paid-expense-reversal' else 'manual-ledger' end as kind,
 coalesce(rf.id,ce.id,ca.id,vc.id,vr.id,va.id,pe.id,vp.id,vpr.id,ex.expense_id,sx.source_id,j.id) as source_id,
 coalesce(rf.snapshot->>'providerMode',ce.snapshot->>'providerMode',cao.snapshot->>'providerMode','accounting-record') as provider_mode,
 coalesce(rf.snapshot->'simulationOnly'='true'::jsonb,false) as simulation,
 coalesce(rf.party_id,ce.party_id,cao.party_id,vc.vendor_id,vro.vendor_id,vac.vendor_id,
 case when coalesce(pe.snapshot->>'clientId','')~'^[0-9a-fA-F-]{36}$' then (pe.snapshot->>'clientId')::uuid end,vpb.vendor_id,vprb.vendor_id) as party_id,
 coalesce(rf.snapshot->'party'->>'name',ce.snapshot->'party'->>'name',cao.snapshot->'party'->>'name',vc.snapshot->'vendor'->>'name',vro.snapshot->'vendor'->>'name',vac.snapshot->'vendor'->>'name',pe.snapshot->'buyer'->>'name',vp.data->'vendor'->>'name',vpr.data->'vendor'->>'name','') as party_name,
 coalesce(rf.snapshot->>'reference',ce.snapshot->>'reference',cao.number,vc.number,vro.number,vac.number,pe.number,vp.data->>'reference',vpr.data->>'reference',j.description) as reference,
 coalesce(case when coalesce(rf.snapshot->>'parentDocumentId',rf.snapshot->>'documentId','')~'^[0-9a-fA-F-]{36}$' then coalesce(rf.snapshot->>'parentDocumentId',rf.snapshot->>'documentId')::uuid end,ca.target_id,va.bill_id,pe.document_id,vp.bill_id,vpr.bill_id) as document_id,
 (coalesce(amounts.cash,0))::numeric(30,2) as cash_delta,(coalesce(amounts.customer,0))::numeric(30,2) as customer_delta,
 (coalesce(amounts.vendor,0))::numeric(30,2) as vendor_delta,(coalesce(amounts.credit,0))::numeric(30,2) as credit_delta
from public.billing_ledger_batches j join public.billing_cash_configs cfg on cfg.business_id=j.business_id and cfg.demo=j.demo
cross join lateral(select sum(e.debit-e.credit) filter(where e.account_id=cfg.cash_account) cash,
 sum(e.credit-e.debit) filter(where e.account_id=cfg.customer_advance_account) customer,
 sum(e.debit-e.credit) filter(where e.account_id=cfg.vendor_advance_account) vendor,
 sum(e.debit-e.credit) filter(where a.code='1450' and a.type='asset') credit
 from public.billing_ledger_entries e join public.billing_ledger_accounts a on a.id=e.account_id where e.batch_id=j.id) amounts
left join public.billing_refund_events rf on rf.batch_id=j.id
left join public.billing_cash_events ce on ce.batch_id=j.id
left join public.billing_cash_allocations ca on ca.batch_id=j.id
left join public.billing_cash_events cao on cao.id=ca.cash_id
left join public.billing_vendor_credits vc on vc.batch_id=j.id
left join public.billing_vendor_credit_reversals vr on vr.batch_id=j.id
left join public.billing_vendor_credits vro on vro.id=vr.credit_id
left join public.billing_vendor_credit_allocations va on va.batch_id=j.id
left join public.billing_vendor_credits vac on vac.id=va.credit_id
left join public.billing_source_postings sx on sx.batch_id=j.id
left join public.billing_payment_events pe on pe.id=sx.source_id and sx.kind in ('payment.receipt','payment.reversal')
left join public.billing_vendor_payments vp on vp.batch_id=j.id
left join public.billing_vendor_bills vpb on vpb.id=vp.bill_id
left join public.billing_vendor_payments vpr on vpr.batch_id=j.reverses_id
left join public.billing_vendor_bills vprb on vprb.id=vpr.bill_id
left join public.billing_posted_expenses ex on ex.batch_id=j.id
where coalesce(amounts.cash,0)<>0 or coalesce(amounts.customer,0)<>0 or coalesce(amounts.vendor,0)<>0 or coalesce(amounts.credit,0)<>0;
revoke all on public.billing_cash_statement_events from public,anon,authenticated;

create function public.billing_cash_statement(business uuid,data_mode boolean,from_date date,to_date date,party_id uuid default null,
 after_date date default null,after_sequence bigint default null,page_size integer default 100,snapshot_number bigint default null)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare customer_reserved numeric(30,2)=0;vendor_reserved numeric(30,2)=0;credit_reserved numeric(30,2)=0;legacy_count bigint=0;config public.billing_cash_configs;party public.billing_records;business_name text;ceiling bigint;current_ceiling bigint;rows jsonb;next_cursor jsonb=null;total_rows bigint;unassigned bigint;
 opening_cash numeric(30,2);opening_customer numeric(30,2);opening_vendor numeric(30,2);opening_credit numeric(30,2);
 closing_cash numeric(30,2);closing_customer numeric(30,2);closing_vendor numeric(30,2);closing_credit numeric(30,2);
 cash_in numeric(30,2);cash_out numeric(30,2);customer_add numeric(30,2);customer_use numeric(30,2);vendor_add numeric(30,2);vendor_use numeric(30,2);credit_add numeric(30,2);credit_use numeric(30,2);
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Cash statement unavailable in this business';end if;
 if data_mode is null or from_date is null or to_date is null or not isfinite(from_date) or not isfinite(to_date) or from_date>to_date or page_size is null or page_size not between 1 and 200 or num_nonnulls(after_date,after_sequence) not in (0,2) then raise exception 'Choose a valid cash statement period and complete cursor';end if;
 select * into config from public.billing_cash_configs where business_id=business and demo=data_mode;
 if config.business_id is null then raise exception 'Configure reviewed cash and advance controls before generating this statement';end if;
 if party_id is not null then select * into party from public.billing_records r where r.id=billing_cash_statement.party_id and r.business_id=business and r.demo=data_mode and r.collection in ('clients','vendors');if party.id is null then raise exception using errcode='P0002',message='Statement party unavailable in this business and data mode';end if;end if;
 select name into business_name from public.billing_businesses where id=business;
 select next_number-1 into current_ceiling from public.billing_ledger_configs where business_id=business and demo=data_mode;
 if after_date is not null and snapshot_number is null then raise exception 'Continue cash statement pages with their original snapshot';end if;
 ceiling=coalesce(snapshot_number,current_ceiling);if ceiling<0 or ceiling>current_ceiling then raise exception 'Cash statement snapshot is invalid';end if;
 if after_date is not null and (not isfinite(after_date) or after_date<from_date or after_date>to_date or not exists(select 1 from public.billing_cash_statement_events e where e.business_id=business and e.demo=data_mode and (billing_cash_statement.party_id is null or e.party_id=billing_cash_statement.party_id) and e.date=after_date and e.sequence=after_sequence and e.sequence<=ceiling)) then raise exception 'Cash statement cursor does not belong to this scope/period';end if;
 select coalesce(sum(e.cash_delta) filter(where e.date<from_date),0),coalesce(sum(e.customer_delta) filter(where e.date<from_date),0),coalesce(sum(e.vendor_delta) filter(where e.date<from_date),0),coalesce(sum(e.credit_delta) filter(where e.date<from_date),0),
 coalesce(sum(e.cash_delta),0),coalesce(sum(e.customer_delta),0),coalesce(sum(e.vendor_delta),0),coalesce(sum(e.credit_delta),0),
 coalesce(sum(greatest(e.cash_delta,0)) filter(where e.date>=from_date),0),coalesce(sum(greatest(-e.cash_delta,0)) filter(where e.date>=from_date),0),
 coalesce(sum(greatest(e.customer_delta,0)) filter(where e.date>=from_date),0),coalesce(sum(greatest(-e.customer_delta,0)) filter(where e.date>=from_date),0),
 coalesce(sum(greatest(e.vendor_delta,0)) filter(where e.date>=from_date),0),coalesce(sum(greatest(-e.vendor_delta,0)) filter(where e.date>=from_date),0),
 coalesce(sum(greatest(e.credit_delta,0)) filter(where e.date>=from_date),0),coalesce(sum(greatest(-e.credit_delta,0)) filter(where e.date>=from_date),0),
 count(*) filter(where e.date>=from_date),count(*) filter(where e.party_id is null and e.date>=from_date)
 into opening_cash,opening_customer,opening_vendor,opening_credit,closing_cash,closing_customer,closing_vendor,closing_credit,cash_in,cash_out,customer_add,customer_use,vendor_add,vendor_use,credit_add,credit_use,total_rows,unassigned
 from public.billing_cash_statement_events e where e.business_id=business and e.demo=data_mode and e.date<=to_date and e.sequence<=ceiling and (billing_cash_statement.party_id is null or e.party_id=billing_cash_statement.party_id);
 with running as(select e.*,opening_cash+sum(cash_delta) over(order by e.date,e.sequence rows unbounded preceding) cash_balance,
 opening_customer+sum(customer_delta) over(order by e.date,e.sequence rows unbounded preceding) customer_balance,
 opening_vendor+sum(vendor_delta) over(order by e.date,e.sequence rows unbounded preceding) vendor_balance,
 opening_credit+sum(credit_delta) over(order by e.date,e.sequence rows unbounded preceding) credit_balance
 from public.billing_cash_statement_events e where e.business_id=business and e.demo=data_mode and e.date between from_date and to_date and e.sequence<=ceiling and (billing_cash_statement.party_id is null or e.party_id=billing_cash_statement.party_id)),page as(select * from running where after_date is null or (date,sequence)>(after_date,after_sequence) order by date,sequence limit page_size+1)
 select coalesce(jsonb_agg(jsonb_build_object('date',date,'sequence',sequence::text,'batchId',batch_id,'number',number,'kind',kind,'sourceId',source_id,'providerMode',provider_mode,'simulation',simulation,'partyId',page.party_id,'partyName',party_name,'reference',reference,'documentId',document_id,'description',description,
 'cashDelta',cash_delta::text,'customerDelta',customer_delta::text,'vendorDelta',vendor_delta::text,'creditDelta',credit_delta::text,
 'cashBalance',cash_balance::numeric(30,2)::text,'customerBalance',customer_balance::numeric(30,2)::text,'vendorBalance',vendor_balance::numeric(30,2)::text,'creditBalance',credit_balance::numeric(30,2)::text) order by date,sequence),'[]'::jsonb) into rows from page;
 if jsonb_array_length(rows)>page_size then next_cursor=jsonb_build_object('date',rows->(page_size-1)->>'date','sequence',rows->(page_size-1)->>'sequence','snapshot',ceiling::text);rows=rows-page_size;end if;
 select coalesce(sum(public.billing_mock_refund_reserved(business,data_mode,'cash',c.id,to_date)) filter(where c.direction='incoming'),0),coalesce(sum(public.billing_mock_refund_reserved(business,data_mode,'cash',c.id,to_date)) filter(where c.direction='outgoing'),0) into customer_reserved,vendor_reserved from public.billing_cash_events c where c.business_id=business and c.demo=data_mode and c.kind='cash' and (billing_cash_statement.party_id is null or c.party_id=billing_cash_statement.party_id);
 select coalesce(sum(public.billing_mock_refund_reserved(business,data_mode,'vendor-credit',c.id,to_date)),0) into credit_reserved from public.billing_vendor_credits c where c.business_id=business and c.demo=data_mode and (billing_cash_statement.party_id is null or c.vendor_id=billing_cash_statement.party_id);
 select count(*) into legacy_count from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and not exists(select 1 from public.billing_source_postings j where j.source_id=p.id and j.kind in ('payment.receipt','payment.reversal')) and (billing_cash_statement.party_id is null or p.data->>'clientId'=billing_cash_statement.party_id::text);
 return jsonb_build_object('businessId',business,'businessName',business_name,'demo',data_mode,'currency',config.currency,'party',case when party.id is null then null else jsonb_build_object('id',party.id,'name',party.data->>'name','kind',party.collection,'archived',party.archived) end,
 'from',from_date,'to',to_date,'snapshotNumber',ceiling::text,'opening',jsonb_build_object('cash',opening_cash::text,'customer',opening_customer::text,'vendor',opening_vendor::text,'credit',opening_credit::text),
 'closing',jsonb_build_object('cash',closing_cash::text,'customer',closing_customer::text,'vendor',closing_vendor::text,'credit',closing_credit::text),
 'additions',jsonb_build_object('cash',cash_in::text,'customer',customer_add::text,'vendor',vendor_add::text,'credit',credit_add::text),'uses',jsonb_build_object('cash',cash_out::text,'customer',customer_use::text,'vendor',vendor_use::text,'credit',credit_use::text),
 'totalRows',total_rows::text,'unassignedRows',unassigned::text,'rows',rows,'next',next_cursor,'reviewStatus','unreviewed','reservations',jsonb_build_object('customer',customer_reserved::text,'vendor',vendor_reserved::text,'credit',credit_reserved::text),'reservationCheckedAt',now(),'legacyPaymentRecordsNeedingOpeningReview',legacy_count::text,'partyScoped',party_id is not null,
 'limitations',jsonb_build_array('Balances come from the reviewed cash and advance control accounts. Unapplied customer/vendor cash and supplier credits remain separate from AR/AP.','Without a party filter, all posted cash/control movements including openings, manual entries and paid expenses are included. With a party filter, cash is source-scoped net movement and is not a bank account balance.','Unknown/manual/expense parties are unassigned; a contact name never fabricates a saved party link. Original source names remain frozen; the selector contact name is current.','Only posted ledger history is included; retained legacy receipts without source journals require opening review and are never replayed as cash.','Cash amounts are accounting records, not provider settlement or bank clearance. Reservations use current operational state through the selected effective date, separately from immutable posted-snapshot book balances. No accountant sign-off has been recorded.'));
end$$;
revoke all on function public.billing_cash_statement(uuid,boolean,date,date,uuid,date,bigint,integer,bigint) from public,anon,authenticated;
grant execute on function public.billing_cash_statement(uuid,boolean,date,date,uuid,date,bigint,integer,bigint) to authenticated;

-- Legacy-current documents retain their explicit compatibility read, without
-- changing legacy rows or inventing a managed issue snapshot.
create function public.billing_invoice_context_movements(invoice uuid) returns table(date date,delta numeric) language sql stable security definer set search_path='' as $$
 select m.date,m.delta from public.billing_settlement_movements(invoice,'incoming')m
 union all select (r.data->>'date')::date,(public.billing_document_totals(r.data)->'totals'->>'total')::numeric from public.billing_records r where r.id=invoice and not exists(select 1 from public.billing_issued_documents where document_id=r.id) and r.data->>'status' in ('sent','paid','partially_paid')
 union all select (n.data->>'date')::date,(public.billing_document_totals(n.data)->'totals'->>'total')::numeric*case when n.data->>'type'='credit-note' then -1 else 1 end from public.billing_records n join public.billing_records r on r.id=invoice and n.business_id=r.business_id and n.demo=r.demo where n.collection='documents' and not n.archived and n.data->>'originalDocumentId'=invoice::text and n.data->>'type' in ('credit-note','debit-note') and n.data->>'status' in ('sent','paid','partially_paid') and not exists(select 1 from public.billing_issued_documents where document_id=n.id)
$$;
revoke all on function public.billing_invoice_context_movements(uuid) from public,anon,authenticated;

create function public.billing_invoice_payment_context(business uuid,data_mode boolean,invoice_id uuid,as_of date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare payment public.billing_records;original public.billing_records;source public.billing_records;issued public.billing_issued_documents;day date;currency text;balance numeric(30,2);recordable numeric(30,2);total numeric(30,2);payments jsonb;allocations jsonb;refunds jsonb;payment_count bigint;allocation_count bigint;refund_count bigint;inherited bigint;active boolean;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Invoice settlement unavailable in this business';end if;
 if data_mode is null or invoice_id is null or as_of is not null and not isfinite(as_of) then raise exception 'Choose a valid invoice settlement scope/date';end if;
 select * into source from public.billing_records r where r.id=invoice_id and r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in ('invoice','gst-invoice','commercial-invoice');
 if source.id is null then raise exception using errcode='P0002',message='Invoice unavailable in this business and data mode';end if;
 select * into issued from public.billing_issued_documents where document_id=source.id;
 active=issued.document_id is not null or source.data->>'status' in ('sent','paid','partially_paid');
 select coalesce(as_of,(now() at time zone time_zone)::date) into day from public.billing_businesses where id=business;
 currency=source.data->>'currency';if coalesce(currency,'')!~'^[A-Z]{3}$' then raise exception 'Review the invoice currency before using its settlement balance';end if;
 if exists(select 1 from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text and (coalesce(p.data->>'currency','')<>'' and p.data->>'currency'<>currency or coalesce(p.data->>'direction','incoming')<>'incoming' or coalesce(p.data->>'kind','receipt') not in ('receipt','reversal'))) then raise exception 'A payment currency, direction or kind needs review; no partial balance is shown';end if;
 if exists(select 1 from public.billing_records n where n.business_id=business and n.demo=data_mode and n.collection='documents' and not n.archived and n.data->>'originalDocumentId'=source.id::text and n.data->>'type' in ('credit-note','debit-note') and (n.data->>'status' in ('sent','paid','partially_paid') or exists(select 1 from public.billing_issued_documents i where i.document_id=n.id)) and n.data->>'currency' is distinct from currency) then raise exception 'Adjustment currency differs from its invoice; no partial balance is shown';end if;
 for payment in select * from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text loop
  perform public.billing_payment_amount(payment.data->'amount');perform public.billing_payment_date(payment.data->'date');
  if payment.data->>'kind'='reversal' then
   if coalesce(payment.data->>'reversalOf','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'A payment reversal has no valid original reference';end if;
   select * into original from public.billing_records p where p.id=(payment.data->>'reversalOf')::uuid and p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text;
   if original.id is null or coalesce(original.data->>'kind','receipt')<>'receipt' or public.billing_payment_amount(original.data->'amount')<>public.billing_payment_amount(payment.data->'amount') or public.billing_payment_date(payment.data->'date')<public.billing_payment_date(original.data->'date') then raise exception 'A payment reversal differs from its full original receipt';end if;
  end if;
 end loop;
 if exists(select 1 from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text and p.data->>'kind'='reversal' group by lower(p.data->>'reversalOf') having count(*)>1) then raise exception 'Conflicting payment reversals need review before showing balances';end if;
 select count(*),count(*) filter(where coalesce(data->>'currency','')='') into payment_count,inherited from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb) into payments from(select * from public.billing_records p where p.business_id=business and p.demo=data_mode and p.collection='payments' and not p.archived and p.data->>'documentId'=source.id::text order by p.created_at desc,p.id desc limit 1000)p;
 select count(*) into allocation_count from public.billing_cash_allocation_report a where a.business_id=business and a.demo=data_mode and a.data->>'documentId'=source.id::text;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.data->>'date',a.id),'[]'::jsonb) into allocations from(select * from public.billing_cash_allocation_report a where a.business_id=business and a.demo=data_mode and a.data->>'documentId'=source.id::text order by a.data->>'date' desc,a.id desc limit 1000)a;
 select count(*) into refund_count from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.source_kind='customer-credit-note' and coalesce(f.snapshot->>'parentDocumentId',f.snapshot->>'documentId')=source.id::text;
 select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('amount',f.amount::text) order by f.date,f.created_at,f.id),'[]'::jsonb) into refunds from(select * from public.billing_refund_events f where f.business_id=business and f.demo=data_mode and f.source_kind='customer-credit-note' and coalesce(f.snapshot->>'parentDocumentId',f.snapshot->>'documentId')=source.id::text order by f.date desc,f.created_at desc,f.id desc limit 1000)f;
 if active then
  total=(public.billing_document_totals(coalesce(issued.snapshot,source.data))->'totals'->>'total')::numeric;
  select coalesce(sum(m.delta),0) into balance from public.billing_invoice_context_movements(source.id)m where m.date<=day;
  with daily as(select date,sum(delta) delta from public.billing_invoice_context_movements(source.id) group by date union all select day,0),running as(select date,sum(sum(delta)) over(order by date) balance from daily group by date)
  select greatest(coalesce(min(running.balance) filter(where running.date>=day),0),0) into recordable from running;
 else balance=null;recordable=0;total=(public.billing_document_totals(source.data)->'totals'->>'total')::numeric;end if;
 return jsonb_build_object('businessId',business,'demo',data_mode,'invoiceId',source.id,'asOf',day,'currency',currency,'invoice',to_jsonb(source),'issued',active,'snapshotKind',case when issued.document_id is not null then 'managed' else 'legacy-current' end,'total',total::text,'balance',balance::text,'recordableAmount',recordable::text,'payments',payments,'allocations',allocations,'refunds',refunds,
 'paymentCount',payment_count,'allocationCount',allocation_count,'refundCount',refund_count,'paymentsTruncated',payment_count>1000,'allocationsTruncated',allocation_count>1000,'refundsTruncated',refund_count>1000,'inheritedCurrencyWarnings',inherited,'canWrite',public.billing_can_access(business,true));
end$$;
revoke all on function public.billing_invoice_payment_context(uuid,boolean,uuid,date) from public,anon,authenticated;
grant execute on function public.billing_invoice_payment_context(uuid,boolean,uuid,date) to authenticated;
notify pgrst,'reload schema';
