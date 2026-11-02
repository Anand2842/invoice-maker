-- Independent typed-source amounts compared with actual control-account entries.
-- Mechanical agreement is not accountant sign-off; legacy/opening gaps remain visible.
create function public.billing_source_reconciliation(business uuid,data_mode boolean,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.billing_auto_posting_configs;ledger public.billing_ledger_configs;accounts jsonb;
 ar_expected numeric(30,2)=0;ar_actual numeric(30,2)=0;ap_expected numeric(30,2)=0;ap_actual numeric(30,2)=0;cash_expected numeric(30,2)=0;cash_actual numeric(30,2)=0;tax_expected numeric(30,2)=0;tax_actual numeric(30,2)=0;
 cash_vendor numeric(30,2)=0;unposted bigint=0;legacy bigint=0;foreign_docs bigint=0;ap_account uuid;row_count bigint;result jsonb;source_rows bigint;
begin
 if auth.uid() is null or not public.billing_can_access(business) then raise exception using errcode='42501',message='Source reconciliation unavailable in this business';end if;
 if data_mode is null or as_of is null or not isfinite(as_of) then raise exception 'Choose a valid reconciliation date';end if;
 select * into ledger from public.billing_ledger_configs where business_id=business and demo=data_mode;
 select * into config from public.billing_auto_posting_configs where business_id=business and demo=data_mode;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',type) order by code),'[]'::jsonb) into accounts from public.billing_ledger_accounts where business_id=business and demo=data_mode;
 if config.business_id is null then return jsonb_build_object('businessId',business,'demo',data_mode,'configured',false,'ledgerConfigured',ledger.business_id is not null,'canManage',public.billing_is_owner(business),'accounts',accounts,'currency',ledger.currency,'ledgerStart',ledger.start_date,'asOf',as_of,'reviewStatus','unreviewed');end if;
 with documents as(
  select i.*,case when i.type='credit-note' then -1 else 1 end as sign,c.date as cancelled_on from public.billing_issued_documents i left join public.billing_document_cancellations c on c.document_id=i.document_id
  where i.business_id=business and i.demo=data_mode and i.date>=config.cutover_date and i.date<=as_of and i.snapshot->>'currency'=config.currency and i.type in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note')
 ) select coalesce(sum((snapshot->'totals'->>'total')::numeric*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),coalesce(sum(((snapshot->'totals'->>'tax')::numeric+(snapshot->'totals'->>'cess')::numeric)*sign) filter(where cancelled_on is null or cancelled_on>as_of),0),count(*) into ar_expected,tax_expected,source_rows from documents;
 select ar_expected-coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0),coalesce(sum(case when p.kind='receipt' then p.amount else -p.amount end),0) into ar_expected,cash_expected
 from public.billing_payment_events p join public.billing_issued_documents i on i.document_id=p.document_id
 where p.business_id=business and p.demo=data_mode and p.transaction_date between config.cutover_date and as_of and p.currency=config.currency and i.date>=config.cutover_date;
 select coalesce(sum(e.charge-e.credit),0) into ap_expected from public.billing_vendor_statement_events e where e.business_id=business and e.demo=data_mode and e.date<=as_of;
 select coalesce(sum(p.amount) filter(where p.date<=as_of),0)-coalesce(sum(p.amount) filter(where r.date<=as_of),0) into cash_vendor from public.billing_vendor_payments p left join public.billing_ledger_batches r on r.reverses_id=p.batch_id where p.business_id=business and p.demo=data_mode and p.account_id=config.cash_account;
 cash_expected=cash_expected-cash_vendor;
 select id into ap_account from public.billing_ledger_accounts where business_id=business and demo=data_mode and code='2000' and type='liability';
 select coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.receivable_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=ap_account),0),coalesce(sum(e.debit-e.credit) filter(where e.account_id=config.cash_account),0),coalesce(sum(e.credit-e.debit) filter(where e.account_id=config.tax_account),0) into ar_actual,ap_actual,cash_actual,tax_actual
 from public.billing_ledger_entries e join public.billing_ledger_batches b on b.id=e.batch_id where e.business_id=business and e.demo=data_mode and b.date<=as_of;
 select count(*) filter(where i.document_id is null),count(*) filter(where i.document_id is not null and not exists(select 1 from public.billing_source_postings p where p.source_id=r.id and p.kind='document.issue')),count(*) filter(where r.data->>'currency'<>config.currency)
 into legacy,unposted,foreign_docs from public.billing_records r left join public.billing_issued_documents i on i.document_id=r.id
 where r.business_id=business and r.demo=data_mode and r.collection='documents' and not r.archived and r.data->>'type' in ('invoice','gst-invoice','commercial-invoice','credit-note','debit-note') and (r.data->>'status' in ('sent','paid') or r.data->>'status'='cancelled' and i.document_id is not null) and (r.data->>'date')::date<=as_of;
 return jsonb_build_object('businessId',business,'demo',data_mode,'configured',true,'ledgerConfigured',true,'canManage',public.billing_is_owner(business),'config',to_jsonb(config),'currency',config.currency,'asOf',as_of,'accounts',accounts,'controls',jsonb_build_array(
 jsonb_build_object('code','AR','name','Accounts receivable','expected',ar_expected::text,'ledger',ar_actual::text,'difference',(ar_actual-ar_expected)::text),
 jsonb_build_object('code','AP','name','Accounts payable','expected',ap_expected::text,'ledger',ap_actual::text,'difference',(ap_actual-ap_expected)::text),
 jsonb_build_object('code','CASH','name','Cash / bank','expected',cash_expected::text,'ledger',cash_actual::text,'difference',(cash_actual-cash_expected)::text),
 jsonb_build_object('code','TAX','name','Output tax payable','expected',tax_expected::text,'ledger',tax_actual::text,'difference',(tax_actual-tax_expected)::text)),
 'unpostedManagedDocuments',unposted,'legacyDocumentsNeedingOpeningReview',legacy,'foreignDocumentsNeedingFxReview',foreign_docs,'managedDocumentsThroughDate',source_rows,'arithmeticAgrees',ar_actual=ar_expected and ap_actual=ap_expected and cash_actual=cash_expected and tax_actual=tax_expected and unposted=0 and legacy=0 and foreign_docs=0,'reviewStatus','unreviewed',
 'limitations',jsonb_build_array('Mechanical control-account comparison only; personal review decisions are recorded separately and this result does not assert sign-off.','Expected AR/output tax uses frozen managed documents and dated receipt/cancellation events after cutover. No paid flag becomes cash.','Expected AP uses explicit Folio vendor bills/payments/reversals. Legacy expenses, advances, credits and manual journals are not invented.','Manual/opening control-account entries can cause differences and need reviewed mappings. FX, inventory and additional expense sources remain separate work.'));
end$$;
revoke all on function public.billing_source_reconciliation(uuid,boolean,date) from public,anon,authenticated;
grant execute on function public.billing_source_reconciliation(uuid,boolean,date) to authenticated;
notify pgrst,'reload schema';
