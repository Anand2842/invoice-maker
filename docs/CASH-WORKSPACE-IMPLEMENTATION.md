# Cash and allocation implementation checkpoint

Local source only, 1 November 2026. No migration from this continuation has been applied to staging or production. Full T06/T11/T12/T19/T20 completion is not claimed.

## Implemented kernel

- `202611010006_cash_allocations.sql`: explicit owner-reviewed cutover and five distinct chart mappings; immutable external customer receipts/vendor disbursements; cash authority separate from allocations; 1–50 target allocation commands; dated partial releases; full record reversals after all allocations are released; exact actor/payload retry; authorization recheck under the business lock; atomic journals/audit/command/outbox.
- Incoming: cash debit/customer advance credit; allocations move customer advances to AR. Outgoing: vendor advance debit/cash credit; allocations move AP to vendor advances. New commands require explicit outside-Folio paid confirmation. No external transfer or mock-provider success creates real cash.
- All effective-date prefixes are validated, including later recorded settlements. Valid backdates are allowed. Target/cash history cannot become negative. AR target locks precede business/config locks, in sorted UUID order; AP preserves business/config ordering.
- Existing direct payments, bill reversals and managed document corrections are guarded against over-settlement of allocated targets. Legacy recorded incoming amounts are retained; no Paid flag becomes cash. General GL reversal cannot bypass cash/allocation authority.
- `202611010007_cash_reports.sql`: scoped cash/advance review RPC, exact target lookup, independent seven-control reconciliation, dated vendor statement/payables allocation events/history and AR report projection. AR report keyset pages freeze a posted-sequence ceiling; a backdated concurrent insertion stays outside that report snapshot.
- Client statements and dashboard load typed allocations separately from receipt records. The report loader fails closed for unavailable migrations, malformed scope/order/amounts/releases/cursors and record limits. Unapplied cash stays outside invoice/bill aging. The source report always remains unreviewed by an accountant.

## Cash workspace source added

`/cash/` and `/api/cash` now implement reviewed account setup, explicit external cash recording, multi-target allocation, dated partial release and full record reversal. Scoped persistent pending commands retain exact retry payloads after uncertain responses. Safe auth/navigation routes, exact cash/target access, dated list/detail balances, CSV and UTF-8 browser receipt print are wired. Cash receipts now freeze business contact details alongside party/method/reference; later profile/contact edits do not rewrite them. API/model validation rejects inconsistent cash/journal/scope/history/amount/total confirmations. The preview is wired to these handlers and typed report allocations, but its listener still fails with EPERM.

Latest integrated full verification:395 tests, syntax, TypeScript and production build passed; browser/mobile-web/actual PostgreSQL concurrency remain unverified. See `../../reports/folio-cash-workspace-2026-11-01/REPORT.md`.

## Next required source work

1. Browser/mobile-web/accessibility QA remains. Scoped payment-modal settlement/context, full keyset cash/advance statements, supplier credits, customer credit-note refunds and demo mock dispatch are now integrated in unpublished source; see the parallel-financial-workflow report. Existing direct receipts remain immutable.
2. Full paged dated cash/advance statements, bulk receipt exports and downloadable server Unicode PDFs. Browser Print / Save PDF and CSV are present locally; actual print shaping/pagination is unverified. Existing v14 receipt PDFs remain single-invoice receipts; never relabel allocations as new receipts.
3. Credit/refund/reservation/lease/ack/failure workflows are locally implemented/tested, restricted to manual external confirmations or explicitly demo mock effects. Actual provider activation and hosted/production proof remain unverified. Refund cash postings remain distinct from allocation releases/record reversals.
4. Expand SQL/API/UI reports and failure/race tests with these new sources, preserving every prefix and keeping old receipts readable. Legacy direct-payment modal must present remaining balances from the same allocation model. No automatic conversion of existing receipt rows into advances.
5. Browser/mobile-web/print shaping, actual PostgreSQL overlapping connections, isolated staging/backup/recovery and publication gates remain open. PGlite single-engine tests do not establish these gates. Existing document-source future-date behavior also needs a deliberate trusted-source policy instead of exposing an unrestricted future-journal flag.

The cash read RPC explicitly labels list caps (200 cash rows, 500 parties/targets); exact cash/target IDs are supported. A cash detail with more than 1,000 allocation movements rejects partial history until paged detail is added. Full report history has a 10,000-allocation bound and explicit error, with immutable keyset paging within it. These bounds are not full large-workspace parity.
