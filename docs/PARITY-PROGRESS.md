# Web parity implementation — iteration 1

29 October 2026. First foundation/receivables increment; this is not completion of R0 or R1.

## Implemented

- `/receivables/`: business, demo/real, currency and balance-date selection; outstanding/overdue/customer-credit/net totals; invoice search and settlement filters; invoice/client-statement links; filtered CSV export; loading, sign-in, setup, empty and retry states.
- Statement calculation now returns per-invoice balances. Settlement state is derived from dated charges, adjustments and payments independently of the legacy document status. Future invoice prepayments remain credits; future receipts cannot settle earlier balances.
- One exact two-decimal payment parser is shared by reports and application validation. Existing single-invoice payment writes through `/api/records` verify a visible, active, issued invoice in the same business/demo context, reject currency/direction mismatches and save an explicit inherited currency/direction.
- Client-statement links retain business, client, currency, period and data mode. Failed client selection blocks generation until retried rather than silently switching a requested client to All clients.
- Added Receivables navigation to the workspace, document list and dashboard quick actions. Sign-in return paths include the new page.

## Verification

- 183 automated tests passed, including nine new payment/receivables cases; source syntax and TypeScript checks pass.
- Real local application guest/sign-in state verified. Synthetic read-only browser fixture verified partial-payment filtering, invoice search, paid-without-settlement warning and client-statement context/totals.
- Golden fixture: outstanding INR 3,050; overdue INR 2,250; separate credits INR 250; net INR 2,800. The client statement reconciles to the same figures.
- `node scripts/receivables-preview.mjs` serves synthetic QA data on loopback port 5180. It is a development tool, never a production API. The normal app uses authenticated Supabase-backed endpoints.

## Boundaries and next gate

No existing records were rewritten and no database migration was applied. Source inventory covers nine migration files; actual production migration state, records, effective grants, invalid/orphan payments and backup/restore readiness remain to be audited with database access.

Application validation does not prevent direct authenticated PostgREST writes or a parent changing between validation and save. Database guards/atomic commands, idempotency, immutable issued snapshots, postings/outbox, numbered receipts, reversals and multi-invoice allocations remain required before production payment entry is exposed. Existing generic payment edits/archive behavior remains a legacy gap; no new payment-entry UI is claimed here.

Reports still use current active records and dates, with the existing 10,000-record bound and two-decimal document model. They are not immutable historical ledger snapshots. Full currency exponents, server-side aggregation/pagination and physical phone-width browser QA remain outstanding.

## Backlog disposition

T02: source inventory complete; production audit pending. T04: initial dated financial fixtures added; staging/restore and full journey gates pending. T05: compatible payment/read contract implemented; full command/schema contracts pending. T12: read-only collections view implemented; entry/receipt/correction flows pending. No whole parity task is marked Done by this increment.

## 30 October 2026 — iteration 2

Implemented payment history, locally tested atomic payment/receipt/reversal commands, exact retry recovery, receipt PDFs and reversal-aware statements/dashboard. 224 tests pass. See [PAYMENT-ACTIVATION.md](PAYMENT-ACTIVATION.md) for evidence, the read-only preflight and production activation gates. The new migration has not been applied to production; entry remains unavailable until database verification and activation. No whole parity package is marked Done.
