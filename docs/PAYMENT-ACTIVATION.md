# Payment foundation — activation and remaining gates

30 October 2026. Implemented and tested locally; **the production payment migration has not been applied**. Existing hosted data has not been rewritten. The Supabase dashboard is signed out and no database credentials are available in this execution session.

## Delivered source

- Single-invoice incoming payment commands with an authenticated business/demo boundary, expected invoice version, exact positive amounts and a stable command UUID.
- One transaction creates the immutable typed payment event, report-compatible record, numbered receipt, existing audit record and outbox entry. No email, gateway charge or refund runs in that transaction.
- Full linked reversals add a positive event on their own effective date; the statement debits that event and retains the original receipt. Historical as-of balances remain unchanged before the reversal date.
- New events and compatibility rows cannot be edited or archived directly. Invoices with recorded payments retain their financial identity; corrections use adjustments and reversals.
- Committed same-payload retries return the same receipt before checking a subsequently stale invoice version. A changed request with the same key conflicts. Scope checks precede parent locks, and new commands preserve the invoice-to-business lock order used by existing adjustment/numbering functions.
- The payment dialog keeps uncertain requests and exact retry keys in account/business/invoice/demo-scoped session storage. A failed storage write blocks submission. Generic transport failures remain uncertain; a later authorization error does not erase an earlier uncertain request.
- Payment history and snapshot receipt PDFs, with explicit demo labeling and full-reversal annotations. Existing unnamed legacy payments remain identifiable as legacy and do not acquire invented receipt numbers.
- Generic `/api/records` payment writes are blocked at the application boundary. Database enforcement requires the new migration; existing direct authenticated REST grants remain a legacy boundary until it is applied.

## Verification retained

224 automated tests pass, including actual PostgreSQL SQL/PLpgSQL and RLS checks in an in-memory PGlite engine. The payment dependency migrations are executed unchanged in that engine; unrelated sharing/pgcrypto is excluded and Supabase auth/storage scaffolding is modeled locally. PGlite uses one exclusive connection: **these checks do not establish multi-connection lock behavior or hosted Supabase parity**.

Browser QA used `node scripts/payment-preview.mjs --lose-first-confirmation` with a disposable SQL database. A synthetic INR 250 payment committed, its first confirmation was intentionally replaced by a 502, the request survived dialog close and reload, and retry returned the single original receipt. The PDF downloaded; a full reversal restored the invoice balance and retained the original receipt. A separate run with `--commands-unavailable` confirmed that history stays readable and entry/reversal controls stay unavailable.

Syntax, TypeScript and the full production build are separate release checks. Physical phone-width QA, live permission checks and actual database concurrency remain outstanding.

## Production sequence

1. Obtain access to the existing Supabase project `digewoxoqblxlfnekjmc`. Preserve its current audience, business ownership and grants unless a reviewed migration changes them.
2. Run the read-only `scripts/payment-preflight.mjs` with its private JSON stdin protocol. It inspects migration versions when a ledger exists, functions, triggers, grants/policies and up to 100,000 current document/payment rows in one repeatable-read read-only transaction. More records fail the audit explicitly. The report includes record IDs and issue codes, without contact values or raw snapshots. Credentials stay in memory, never arguments/files/output.
3. Confirm the nine existing migration dependencies and the effective grants/triggers. Resolve orphan/cross-context/invalid/archived payments, report-invalid parents and paid-without-settlement cases through an explicit reviewed policy; do not synthesize payments, delete history or silently normalize data. Back up and rehearse restore.
4. Apply only `supabase/migrations/202610290001_payment_commands.sql` to staging. Do not reapply old migrations. Reconcile each demo/real business and currency before and after the additive migration.
5. On real multi-connection PostgreSQL, test same-key parallel retries, different-payload conflicts, simultaneous distinct payments, simultaneous reversals, payment versus adjustment/duplication/numbering and payment versus invoice edits/cancellation. Check no duplicate event/receipt/audit/outbox, no deadlock, all-or-none rollback, and tenant/viewer/anonymous denial through direct REST as well as the app.
6. Apply to production only after those gates pass. `billing_payment_readiness` API version 1 enables entry for permitted roles; absence of that function leaves the hosted payment history read-only. Run authenticated, isolated demo smoke checks, dated statement/dashboard reconciliation, receipt download and reversal checks before calling payment recording activated.

## Deliberate remaining scope

This slice is not full R0/R1 completion or a general ledger. Multi-invoice allocation, unapplied-advance allocation, cash refunds, fiscal locks, automatic balanced accounting postings, real outbox dispatch, gateway collection, full currency exponents and Unicode PDF fonts remain separate work. Existing reports still read bounded current records rather than an immutable historical accounting ledger. Receipt sequences are per business/demo mode; broader fiscal numbering policy remains to be specified.
