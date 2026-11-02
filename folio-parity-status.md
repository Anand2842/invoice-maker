# Folio web parity — delivery status

As of 1 November 2026, Asia/Kolkata. Full scope remains the [master plan](../reports/folio-parity-plan-2026-10-29/MASTER-PLAN.md): **93 capability groups,56 packages; only native iOS/Android are excluded. Full parity and releases R0/R1/R2 are not complete.**

## Last confirmed live

Last Site confirmation: owner-private v14,31 October 2026, https://folio-billing-rp.bubblybull1.chatgpt.site/ . Live source at activation: `ea8b01730a4d53c3d91fd7b73013e65af36eb6fd`. No new publication occurred in this continuation. Team/invitation/document tokens do not bypass the hosting gate, and no audience was widened.

V14 includes the existing document/auth/workspace/catalog/report foundations, single-invoice incoming receipts and full dated reversals, business time zones, GST review workpapers and share-privilege fixes. Payment records/corrections do not charge or refund funds. See [payment activation](docs/PAYMENT-ACTIVATION.md) and [v14 evidence](../reports/folio-payment-foundation-2026-10-30/LIVE-ACTIVATION.md). Production migrations remain applied only through `202610300002_business_time_zone.sql`; do not rerun them.

No production records were changed. The88-record preservation proof belongs to v14 and was not represented as a fresh audit. One legacy inherited-currency warning remains; no backfill was fabricated.

## Unpublished source

HEAD remains `5e121352a4443576af0aabca7db270def1a9a41d`; all continuation work remains uncommitted/unpublished. Original staged banking index content is preserved exactly. Passing local tests and route existence do not prove hosted activation.

| Area | Local implementation | Remaining scope/gates |
| --- | --- | --- |
| Ledger/lifecycle | Manual/opening journals, cutover, chart, locks, paged GL, frozen issue/adoption/cancellation, automatic invoice/tax/rounding/payment source postings | Full numbering/correction/opening/FX/inventory policy, actual concurrency, migration and production verification remain. No historic invoices or Paid flags are replayed as cash. |
| Paid expenses | Explicit external paid/tax review, frozen source/currency provenance, balanced expense/cash/ITC journal and dated reversal, report/GST correction review flags | Reverse-charge/employee claims/FX/full tax handling and actual accountant proof remain. No transfer occurs. |
| Cash/allocations | Independent cash/advance authority, multi-invoice/multi-bill allocation, partial releases/full record reversals, full dated-prefix checks, scoped UI/API/retry, receipt browser print/CSV | Full operational scale/FX/server Unicode exports/browser/actual concurrent/prod gates remain. Old direct receipts stay separate and immutable. |
| Supplier credits/refunds | Frozen bill/vendor/source-cost/input-tax credit caps, multi-bill allocation/release, external vendor/customer advance refunds, source corrections and AP history | Complete procurement/claims/inventory-return/tax amendment/provider and production journeys remain. Credit issuance is not cash receipt. |
| Customer credit refunds | Explicit frozen note/parent/client source, note and negative-AR caps, Dr AR/Cr cash, refund-aware note/receipt/allocation corrections, UI/API/exports | Actual gateway/hosted/FX/production gates remain. Valid credits after allocated payments remain reportable; new settlements cannot consume later capacity. |
| Mock refund jobs | Demo-only reservations, leases/expiry, stable retries/provider ID, timeout/failure/cancel/needs-review/ack, private simulation authority | No actual provider effect. Real-record simulated financial requests are denied; mock successes remain visibly simulated and are not outside-Folio confirmations. General scheduled/outbox delivery remains incomplete. |
| Statements/dashboard | Scoped invoice-payment context/modal, one-snapshot AR allocation/refund projection, full paged cash/advance/credit controls, vendor statements/aging, JSON/CSV/print | Book balances and current reservations stay separate. Large-scale/recovery/phone/print shaping and whole formal reporting remain unverified. |
| Human review | Immutable scoped evidence/fingerprints, explicit personal attestation/capability, period/source checks, drift invalidation, packet JSON/CSV/print | Self-asserted credentials; no actual production accountant sign-off or whole-books certification. Inventory/FX/openings/filing/audit/recovery remain outside this packet and in the full plan. |
| Team/permissions | Owner-managed hashed verified-email invitations and role/revoke/remove, writer authorization recheck and private helpers | Actual waiting-writer/revocation races, provider delivery and outside-owner hosted access remain unverified. |
| Banking | Reviewed CSV mapping/import, immutable typed lines, exact match/unmatch and persistent retry | Manual only; feeds/splits/automatic cash reconciliation/concurrency/browser proof remain. |
| Client/editor/print | Client overview, canonical draft values with retained HTML, Unicode browser-print paths | Complete editor migration/accessibility/reload/resize/phone/PDF stress remains. Downloadable server PDFs still have Latin/WinAnsi limits. |
| Inventory | Scratch source preserved at `docs/drafts/inventory-commands.sql.draft`, outside migration scanner | **Not installed or verified. No working inventory migration/API/UI/tests delivered.** Complete movements/costing/warehouses/tracking/fulfillment/recost remains required. |

## Current verification

Latest combined checkpoint: **395 tests passed, zero failures/skips; syntax, TypeScript, production build and git diff check passed.** See [parallel financial workflow evidence](../reports/folio-parallel-financial-workflows-2026-11-01/REPORT.md), [cash workspace evidence](../reports/folio-cash-workspace-2026-11-01/REPORT.md) and earlier reports linked there.

The user explicitly requested multiple agents. Customer refund, mock dispatch and scoped-statement work were developed in parallel. The agents later hit usage limits and stopped. Root independently reviewed/integrated their completed work, finished review API/UI/tests and preserved the unfinished inventory source as a draft. Neither partial files nor historical test counts establish completion.

The synthetic preview still cannot bind `127.0.0.1:5180` (`listen EPERM`). Browser/mobile-web/accessibility/print shaping remain unverified. No actual PostgreSQL server/privileged reusable connection is available for overlapping-connection proof. Site source synchronization previously failed DNS for `git.chatgpt-team.site`; no publication attempt followed. The user's choice to continue without repeating authenticated hosted Folio sign-in requests is retained.

All expanded source migrations remain **unapplied to production**. Accounting/team0003–0004 remain isolated staging-only per the [handoff](../CODEX-CLI-HANDOFF-2026-10-31.md). Later0005–0009 and November0001–0012/0014/0015 are not applied to staging or production in this flow. Inventory0013 remains absent while its source is a draft. Inspect actual definitions/grants, back up/rehearse/reconcile records and verify actual races before activation; do not blindly reapply existing objects.

## Whole-plan work still required

Canonical editor/shared fields/accessibility/responsive/Unicode exports; full fiscal/document correction/collections; inventory/sales orders/partial-bulk fulfillment/costing/UOM/warehouses/batch/serial/expiry/revaluation; complete CRM/forms/booking/RFQ/supplier portal; tax masters/2B/TDS/IRN/e-way/regional compliance; recurrence/reminders/approvals/notifications/general outbox dispatch; protected recipient host, email/WhatsApp/gateway/bank/FX/calendar/commerce/marketplace integration mocks and subsequent approved activation; versioned API/credentials/webhooks/MCP; OCR/intake/financial AI/digests; profiles/Growth/marketing/network/greetings/HRMS; SaaS entitlements/usage/billing/support/import/monitoring/load/independent recovery and final acceptance. Actual accountant-reviewed full books and production activation gates remain.

User configuration: **Folio Business Pvt Ltd, India; production domain later; all external providers mocked.** Existing businesses are not renamed. Simulations remain labelled; no provider account/KYC/real message/charge/refund/filing or public-hosting change is inferred. Native iOS/Android alone are excluded; no other unfinished web feature is silently dropped.
