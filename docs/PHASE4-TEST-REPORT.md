# Phase 4 report — 26 October 2026

**Outcome: database monetary hardening and client statements/receivables aging implemented and tested. Full Refrens parity remains incomplete.**

## What changed

1. Supabase now recalculates document monetary totals before credit/debit-note guards. Direct authenticated writes cannot forge a total or disguise an adjustment with type casing. Existing data was audited read-only; all 43 documents matched the calculation. No records were backfilled.
2. Client statements at `/reports/statements/` and `/api/reports/statement` show opening balance, dated invoices/notes/payments, running balance and closing balance. Filters cover business, client ID, period, currency and demo/real data.
3. Receivables aging shows current, 1–30, 31–60, 61–90, over 90 days and undated buckets. Credit balances remain visible separately.
4. JSON, CSV and PDF export; workspace/dashboard navigation. Filter changes disable stale downloads.

## Verification results

| Check | Outcome | Evidence |
|---|---|---|
| Complete unit suite | 157 passed, 0 failed (35 new statement tests) | [Unit results](unit-tests.txt) |
| SQL/editor calculation parity | 126 cases passed | [Database tests](money-database-tests.json) |
| Invalid monetary inputs | 9 exact-reason rejections passed | Same database evidence |
| Existing active totals | All 43 audited documents agree; no invalid payloads | Same database evidence |
| Authenticated direct-write tampering | 3 checks passed | Same database evidence |
| Adjustment caps and concurrency | 12 passed, exact rejection reasons checked | [Concurrency results](adjustment-concurrency-tests.json) |
| Statement API | 16 passed, including auth/isolation and exports | [API results](statement-api-tests.json) |
| Syntax, TypeScript, production build | Passed | [Syntax](source-check.txt), [TypeScript](typecheck.txt), [Build](build.txt) |
| Browser statement generation | Passed; expected 3 movements, zero fixture issues | [Screenshot](statement-desktop.png) |
| Browser PDF download | Passed; one page, expected balances and references; rendered and visually reviewed | [PDF](browser-statement.pdf), [Rendered PDF](statement-page-1.png), [Extracted text](browser-statement-text.txt) |
| Browser CSV download | Passed; byte-identical to API CSV | [CSV](browser-statement.csv) |
| Filter changes | PDF and CSV disabled until regeneration | Browser observation |
| Mobile viewport | Inconclusive: requested 390×844; actual remained 1280px, including fresh-tab/reload attempts | [Actual captured viewport](viewport-attempt-desktop.png) |

## Exact synthetic example

Selected client: Statement Demo Client 28026823. October 1–26, INR, demo records.

- Prior invoice: 1,000; opening balance 1,000.
- October invoice: 500.
- Issued credit note: 100.
- Dated incoming demo payment: 350.
- Closing: **1,000 + 500 − 100 − 350 = 1,050**.
- Aging: 1,000 at 31–60 days; 50 at 1–30 days.

The demo receipt reference is test data, not evidence that receipt numbering or payment entry UI is built. Synthetic fixtures are listed in [fixtures.json](fixtures.json). No real payment, email, WhatsApp message or government filing was sent.

## Where it still lags

1. Payment entry/allocations, numbered receipt PDFs, refunds/advances handling and database payment-parent guards need implementation. The statement consumes existing API payment records.
2. Vendor bills, outgoing payments, payable aging and vendor statements remain unbuilt. Purchase orders are not liabilities.
3. Dashboard pending balances still use the earlier paid-status behavior; unify them with the dated payment model next. Statements deliberately flag paid invoices lacking dated settlements.
4. Historical accuracy is limited to current active records and transaction dates. Archiving/current cancellation removes records; there is no immutable period ledger or period locking.
5. P&L, balance sheet, trial balance and sales reports remain. Full Indian HSN/rates, portal-schema GST files and government adapters remain.
6. Team invitations/roles UI, audit viewer, external API keys/webhooks, AI, IndiaMART, MCP, automated recurring runs and native apps remain.
7. Live provider work remains blocked by unavailable accounts. Signed-in Refrens behavior remains unverified under the guest-only constraint. Exact full-source fidelity is not established.
8. PDF supports Latin/WinAnsi text; other writing systems must use CSV. Reports stop at 10,000 source records, PDF at 2,000 movements. No exchange rates are assumed.

## Performance and release

The fixture JSON request took **1954 ms** in one local-development request against hosted Supabase. This is not a benchmark or load test. No production signed-in workflow or concurrent report load test has yet been run in this batch.

The money migration is installed on Supabase. App checks refer to the local release candidate; the exact private Site deployment is recorded separately in [release-verification.json](release-verification.json) after publication. Access is to remain owner-private.

## Next build order

1. Payment/receipt workflow and database guards; reconcile dashboard calculations.
2. Vendor bills, payment allocation, statements and payable aging.
3. Journal-backed trial balance, P&L and balance sheet; period/history rules.
4. Remaining GST statutory formats/rates and provider adapters.
5. Team/audit UI, external API/webhooks/MCP and automation.

## Screenshots

![Client statement](statement-desktop.png)

![Downloaded PDF](statement-page-1.png)
