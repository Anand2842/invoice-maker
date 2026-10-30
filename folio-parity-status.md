# Folio web parity — delivery status
**As of 30 October 2026 · Source baseline `55b7f5a` · Current HEAD `1119675`**

> This is the live "what is built / what to do next" layer on top of the [parity plan](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/MASTER-PLAN.md). It does not replace the plan; it resolves the question _"check what built, what to do."_

---

## What has been shipped (two iterations, versions 12 + 13)

### Iteration 1 — receivables read layer (v12 · commit `2437ec6`)

| Area | What is live |
|---|---|
| `/receivables/` route | Business/demo/currency/balance-date selector; outstanding/overdue/credit/net cards; invoice search + settlement filters; CSV export; all edge states (loading, empty, retry, sign-in) |
| Statement calculation | Per-invoice dated balances derived from charges + adjustments + payments, independent of legacy `status` field; future-dated payments do not settle past balances |
| Payment parser | Shared exact two-decimal parser used by both report projection and API validation |
| Payment write gate | `POST /api/records` verifies visible, active, issued invoice in same business/demo; rejects currency/direction mismatch; saves explicit currency/direction |
| Navigation | Receivables added to sidebar, document list, dashboard quick actions; sign-in return paths updated |
| Tests | 183 automated tests pass (9 new payment/receivables cases) |

**Gaps declared at v12:** No DB migration applied; no payment-entry UI; no idempotency; no receipts; no reversals; no GL; no recipient portal.

---

### Iteration 2 — payment foundation (v13 · commit `1119675` · deployment `appgdep_6ae497f4…`)

| Area | What is live in source + locally verified |
|---|---|
| DB migration (additive, not yet applied to production) | Typed immutable receipt/reversal events; command idempotency table; separate real/demo receipt sequences; report-compatible payment projection rows; atomic audit + outbox |
| Payment commands | Validate business/demo/type/currency/date/amount/snapshot identity; reject direct payment table changes; freeze invoice financial identity once payments exist |
| Reversal command | Dated full reversal restores amount-due; retains original receipt; idempotent; linked audit event |
| Browser resilience | Session-storage retry key scoped to account/business/invoice/demo; lost confirmation stays uncertain even on auth-error replay |
| Receipt PDFs | Party/invoice snapshot, positive original amount, reversal annotation, pagination, demo watermark; Latin/WinAnsi font range |
| Payments UI | History panel with legacy-record distinctions; entry + reversal forms conditionally shown when command available + role permits; missing-command state keeps history visible |
| In-memory SQL tests | PGlite: atomic event/projection/audit/outbox; stable replay before stale-version rejection; altered-payload conflict; viewer/foreign-tenant denial; invalid money/parents; real/demo separation; legacy reversal; invoice freeze; injected-failure rollback |
| Browser QA | INR 2,250 → receipt committed with lost confirmation → reload + same-key retry → single receipt → PDF download → reversal restores INR 2,250 |
| Tests | 224 automated tests pass |

**Gaps declared at v13:** Production DB migration not yet applied (payment writes not live). Multi-connection concurrency and live Supabase behaviour not tested. Multi-invoice allocations, advance allocation, cash refunds, fiscal locks, GL postings, outbox dispatch, gateway collection not yet built. Physical phone-width browser QA outstanding.

---

## Task state (from EXECUTION-BACKLOG + progress.json, 30 October)

| Task | Title | State | Blocking |
|---|---|---|---|
| **T01** | Freeze web parity target and discovery | In progress | HRMS/Growth/regional scope still open |
| **T02** | Audit production schema, migrations, data | In progress | Needs authenticated DB access to run preflight |
| **T03** | Provider, domain, infrastructure readiness | **Planned** | No provider gate started; this blocks T13/T14/T41 |
| **T04** | Golden journeys, staging and migration rehearsal | In progress | Full cross-module gates + restore rehearsal pending |
| **T05** | Canonical lifecycle, money and command contracts | In progress | Complete domain/command/schema contract pending |
| **T06** | Transaction, posting, allocation and outbox kernel | In progress | Full posting + live activation pending |
| **T07** | Business roles, invites and permission enforcement | **Planned** | Needs EXT-EMAIL; blocks recipient portal |
| **T08** | Shared Folio UI and canonical editor adapter | **Planned** | Blocks all editor migration work |
| **T09** | Progressive editor migration and document review | **Planned** | Depends on T08 |
| **T10** | Invoice issue/correct/cancel and numbering | **Planned** | Depends on T06 |
| **T11** | Dated payments, allocations, advances, reversals | In progress | Multi-invoice + advances + cash refunds remaining |
| **T12** | Payment entry, receipt PDF and collections UI | In progress | Live DB migration gate remaining |
| **T13** | Recipient service and protected portal | **Planned** | Needs EXT-HOST (no public boundary yet) |
| **T14** | Email delivery history, templates, webhooks | **Planned** | Needs EXT-EMAIL provider verification |
| **T15** | Documents/customer workspace, filters, search | **Planned** | Depends on T09, T11 |
| T16–T55 | All subsequent tasks | **Planned** | See backlog |

> [!IMPORTANT]
> No task is **Done**. T06, T11, T12 are furthest along. Every task with a provider gate (T03, T07, T13, T14, T41…) needs EXT-* account/credential/sandbox work started **today** — approval time can exceed coding time.

---

## R1 gate — what is missing before "invoice to cash" can ship

R1 target: ~weeks 6–12 from implementation start (start = 29 Oct, so roughly Dec–Jan).

| Missing capability | Blocking task | Notes |
|---|---|---|
| Production DB migration applied + preflight clear | T02, T06 | Run `scripts/payment-preflight.mjs` with DB access first |
| Live Supabase multi-connection concurrency test | T06 | Local PGlite only; needs real concurrent REST test |
| Business roles enforced (invite/revoke/viewer) | T07 | Needs EXT-EMAIL for invite flow |
| Shared component system + canonical editor adapter | T08 | Currently ad-hoc per page |
| Invoice issue/correct/cancel commands | T10 | Versioned snapshots + reversal |
| Multi-invoice allocation + advances | T11 | Single invoice only today |
| Numbered receipt series (live, not demo) | T12 | Migration gate |
| Protected recipient portal (separate host) | T13 | EXT-HOST needed |
| Email send + delivery tracking | T14 | EXT-EMAIL; adapter exists but unverified live |
| Customer workspace + indexed server-side search | T15 | No server-side pagination yet |
| R1 reconciliation gate (T17) | T17 | Journey + migration + external recipient proof |

---

## Immediate next actions (Days 1–5 from now)

### 🔴 Must not wait — start today

1. **Run the payment preflight script** against production Supabase:
   - Sign in to the Supabase dashboard.
   - Run `node scripts/payment-preflight.mjs` with read-only credentials via stdin.
   - Classify legacy orphan/overprecision payments; choose quarantine policy before migration.

2. **Open every external-dependency gate (T03)**:
   - **EXT-HOST**: Choose and provision the public/recipient hosting boundary and domain (separate from owner workspace). 
   - **EXT-EMAIL**: Apply for approved sender domain; set up inbound routing and delivery event webhooks.
   - **EXT-PAY**: Start Razorpay/gateway merchant KYC and sandbox separation.
   - **EXT-TAX**: IRP sandbox account for e-invoice.
   - _Each of these can take days to weeks for approval. File today._

3. **Apply the payment-foundation DB migration to staging** (not production yet):
   - Restore a production snapshot to staging.
   - Apply `scripts/payment-preflight.mjs` to classify issues.
   - Apply the migration; verify triggers, grants, RLS.
   - Run the full automated test suite against live Supabase (not PGlite).

### 🟡 Next in parallel (Days 3–10)

4. **T08 — shared component system**: Create one accessible field/form component system. Block all further editor/UI work on this contract so no one patches the same editor file in parallel.

5. **T07 — roles/invites**: Once EXT-EMAIL sandbox is available, implement team invite, role enforcement (owner/admin/viewer) across document and payment commands. This unblocks T13 (portal), T14 (email), T37 (approvals).

6. **T10 — invoice lifecycle commands**: Issue/correct/cancel with versioned snapshots and number-series. Blocks T11 (final allocations), T15 (customer workspace), T17 (R1 gate).

7. **T11 — complete allocations**: Multi-invoice allocation, advance credits, unapplied credit balance. Currently only single-invoice full receipt + reversal exists.

8. **T13 — recipient portal**: Separate provisioned host, scoped share token reading, password/expiry/revoke. Requires EXT-HOST first.

---

## Feature coverage snapshot (93 capability groups)

| Status | Count | Examples |
|---|---|---|
| **In progress** | 4 | F023 (dated payment entry), F025 (reversal/credit), + T06/T11 progress |
| **Existing foundation** | ~8 | Auth, multi-business, document nine-types, number series, share API, PDF, item records |
| **Partial** | ~18 | Auth recovery, business setup, roles (DB only), CRM stages, GST workpapers, responsive, attachments |
| **Missing** | ~63 | Sales orders, full AP/GL/banking, all inventory costing/batch/serial, CRM forms/booking, full tax, automation/approvals, API/MCP, OCR/AI, profiles/HRMS/regional, SaaS billing |

> [!NOTE]
> "Existing foundation" means the DB schema or a read-path exists. It does **not** mean the feature passes its acceptance gate.

---

## External gates register (start all in R0)

| Gate | Needed for | Status |
|---|---|---|
| EXT-HOST | Recipient portal, public profiles, embedded forms | ❌ Not started |
| EXT-EMAIL | Invite flow, send/delivery, reminders, approvals | ❌ Not started |
| EXT-PAY | Online collection links, gateway reconciliation, payout | ❌ Not started |
| EXT-TAX | e-Invoice/e-Way IRN sandbox + production | ❌ Not started |
| EXT-VERIFY | GSTIN verification, supplier KYC, signing | ❌ Not started |
| EXT-FEEDS | Bank feed, FX rates, marketplace leads, calendar, commerce | ❌ Not started |
| EXT-AI | OCR, financial assistant, WhatsApp Eagle intake | ❌ Not started |
| EXT-WA | WhatsApp Business number + approved templates | ❌ Not started |
| EXT-HR | HRMS partner/module scope decision | ❌ Not started |
| EXT-OPS | Support tooling, SaaS billing policy, admin ops | ❌ Not started |

> [!WARNING]
> Every one of these is unstarted. The longest approval paths (EXT-PAY KYC, EXT-WA Business access, EXT-TAX IRP production, EXT-EMAIL domain reputation) can take weeks and block R1–R4 hard dates.

---

## What is _not_ built yet (for clarity)

- **No GL / double-entry postings** — the journal kernel (T06/T18) is designed but not wired to automatic postings. Balance sheet, P&L, trial balance are missing.
- **No AP / vendor model** — vendor bills, vendor payments, expense claims, vendor aging are all Missing.
- **No inventory movements** — opening stock exists as a scalar; append-only movement ledger, commitments, costing, warehouses, batch/serial are all Missing.
- **No approvals, recurring jobs, reminders** — workflow engine not built.
- **No external API / webhooks / MCP** — internal authenticated API only; no versioned public API, no webhook relay, no MCP server.
- **No OCR / AI intake** — no upload pipeline, extraction, or financial assistant.
- **No profiles, marketplace, HRMS, Growth Suite** — discovery required before estimation.
- **No SaaS billing / entitlements** — no metering, no plan enforcement.
- **No recipient portal** — share API exists but no separate public hosting boundary.

---

## Evidence links

| Document | Path |
|---|---|
| Iteration 1 progress | [IMPLEMENTATION-PROGRESS.md](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/IMPLEMENTATION-PROGRESS.md) |
| Payment foundation report (v13) | [REPORT.md](file:///Users/raunakpatel/Downloads/bill/reports/folio-payment-foundation-2026-10-30/REPORT.md) |
| R0 source audit | [R0-SOURCE-AUDIT.md](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/R0-SOURCE-AUDIT.md) |
| Execution backlog | [EXECUTION-BACKLOG.csv](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/EXECUTION-BACKLOG.csv) |
| Feature matrix | [FEATURE-MATRIX.csv](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/FEATURE-MATRIX.csv) |
| Architecture + migration detail | [architecture-plan.md](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/architecture-plan.md) |
| Payment activation runbook | [PAYMENT-ACTIVATION.md](file:///Users/raunakpatel/Downloads/bill/folio/docs/PAYMENT-ACTIVATION.md) |
| Progress JSON | [progress.json](file:///Users/raunakpatel/Downloads/bill/reports/folio-parity-plan-2026-10-29/progress.json) |
