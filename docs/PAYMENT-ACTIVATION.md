# Payment foundation — production status and remaining scope

30 October 2026. **The production payment command migration is applied** to Supabase project `digewoxoqblxlfnekjmc`. Readiness API version 1 enables single-invoice incoming receipts and full dated reversals for existing permitted roles. No funds were moved, no provider messages were sent and none of the 88 existing records were rewritten. The hosted Site remains owner-private.

## Production evidence

- A repeatable-read read-only browser SQL audit inspected existing records, functions, triggers, RLS and effective grants. There is no migration ledger; dependencies were checked against actual schema objects. All 88 records were demo data; 70 were documents/payments. One retained payment lacks currency and continues to inherit its linked invoice currency with a review warning. No payment history was normalized or fabricated.
- Full business/member/record/audit copies are retained in a private, RLS-enabled backup schema. A restore rehearsal copied all 88 records and a bidirectional `EXCEPT ALL` comparison found zero differences. This is an in-database restore rehearsal, not an independent disaster-recovery backup.
- An isolated schema on the actual PostgreSQL 17.11 project exercised the migration, authenticated owner/viewer/outsider/anonymous roles, exact amounts/dates, immutability, same-key replay, altered requests, stale versions, currency/demo boundaries and full reversal behavior.
- Two overlapping connections returned one receipt for the same command. A second overlapping pair exercised invoice lock → adjustment numbering → payment, stale retry, distinct receipt, duplicate reversal, altered replay and cancellation rejection. Distinct backend PIDs and overlapping start/finish times are retained. Four events reconciled to three receipts, one reversal and INR 70 net, without a deadlock. Further overlapping pairs proved one correction for simultaneous reversals and five unique receipt numbers for five receipts after distinct concurrent commands.
- An injected outbox failure rolled back command, sequence, event and projection. The public records still matched the backup.
- The additive payment migration then applied to `public`. A production smoke transaction created an isolated synthetic demo business/invoice, verified receipt/reversal and permission behavior, and rolled back. Production retains zero newly created payment events and all 88 original records unchanged.
- Live audit also found excessive default privileges on `billing_shares`. `202610300001_share_grants.sql` removes direct write/TRUNCATE grants while retaining authenticated member-scoped SELECT and checked share commands. Fresh installation SQL has the same restriction.

SQL scripts and timestamped results are retained outside the checkout in `../reports/folio-payment-foundation-2026-10-30/`. Private raw audit snapshots are outside source and release archives.

## Application behavior

One command transaction creates the immutable typed event, numbered snapshot receipt, report-compatible record, audit and outbox. Committed exact retries return the original receipt before checking a now-stale invoice version. Direct payment edits/archive are rejected; corrections add a full linked reversal on its own effective date. Invoice financial identity freezes after a receipt. Recording and reversing records do not collect or refund money.

The payment dialog preserves exact uncertain requests in account/business/invoice/demo-scoped session storage, blocks submission when persistence fails and retains uncertainty across later authorization errors. Receipt PDFs use recorded parties and invoice identity, paginate and label demo data. Legacy payments do not acquire invented receipt numbers.

## Verification and limits

229 automated tests pass. Local browser SQL QA established lost-confirmation recovery, receipt download and reversal reconciliation; unavailable commands preserve readable history. Actual hosted PostgreSQL tests establish the concurrency and role results listed above. They do not replace authenticated end-to-end HTTP/browser QA on the hosted Site: that requires a Folio user session, which was unavailable during this run. Physical phone-width QA remains outstanding.

Business time-zone support is applied separately in `202610300002_business_time_zone.sql`. Existing businesses retain India as the explicit default; owners can choose an IANA zone. New document/workflow/payment defaults, dashboard balances and report defaults use that business calendar. Explicit report dates and stored document/payment dates are preserved. Midnight/daylight-saving cases, SQL validation and owner-only changes are tested. A synthetic browser fixture in Pacific/Kiritimati showed the next-day receivables and payment defaults and the selected settings value.

## Remaining scope

This is not full R0/R1 or Refrens parity. Multi-invoice allocation, advance allocation, cash refunds, fiscal locks, balanced accounting postings, outbox dispatch, gateway collection, full currency exponents and Unicode PDF fonts remain separate work. Reports use bounded current records rather than an immutable historical ledger. Receipt sequences are per business/demo; broader fiscal numbering policy remains open. Email, WhatsApp, payment and tax providers still need their own configured accounts and verification.

For a fresh installation, apply migrations in order. Do not reapply old migrations to this project. In another existing environment, repeat the read-only audit, private backup/restore comparison, isolated role/concurrency tests and reconciliation before activating commands. Absence of readiness API version 1 keeps payment history read-only.
