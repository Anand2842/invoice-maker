# Implementation status — 23 October 2026

The target is an independent application with Refrens feature parity. **Full parity has not been achieved.** The supplied six-phase roadmap is retained in IMPLEMENTATION-ROADMAP.md. Its week estimates are planning labels, not a delivery commitment.

## Phase 1

Implemented and published in Site version 3:
- Owner-managed business profile, private logo, bank fields, tax/default notes/terms, prefix/sequence, brand color.
- Profile version checks reject stale writes. Existing owner-only RLS reused.
- Authenticated dashboard, business selector, separate demo data, twelve-month Recharts comparison, recent documents, overdue invoices, upcoming subscriptions, quick actions.
- Revenue means issued invoice value before tax. Drafts/quotes/orders are excluded. Pending includes tax and subtracts recorded payments. Foreign currencies are disclosed and excluded rather than silently combined.
- Database-locked numbering and duplication; duplicate becomes a draft without payment/IRN state or old editor markup.
- Selected CSV export; bulk archive/restore with partial-failure reporting.
- Workspace navigation added; all-services catalog retained for the requested product/tool inventory.
- New invoice prefill uses business settings and reserves a sequence number.

Implementation adaptations: dashboard uses a React route/component for the requested Recharts library instead of a raw HTML route. A duplicate UPDATE policy was not added because the existing policy already restricts settings to the owner. The dashboard has an explicit 10,000-record limit and fails rather than returning partial totals.

## Foundations delivered before Phase 1

Supabase Auth, business membership schema, business-scoped RLS, private Storage, optimistic record versions and audit events; record CRUD for clients, vendors, inventory, expenses, leads, subscriptions and balanced manual journals; seven downloadable document types; guest downloads; save/reopen including optional editor details; lead-to-quotation and quotation-to-invoice conversion; transactional manual recurring invoice generation; archive/restore; responsive layouts.

These are functional foundations, not complete products. Service navigation passing is not evidence that every advertised product capability exists.

## Remaining roadmap

- Phase 2: core implementation and local verification completed; live email and outside-recipient sharing remain blocked as described below.
- Phase 3: cess/round-off/HSN enhancements, credit/debit notes, GST reports, verified gateway adapters for IRN/eWay Bill. Existing per-item GST, CGST/SGST, IGST and VAT are already implemented.
- Phase 4: payment gateway/webhooks, client/vendor statements and financial reports. Recording a payment is not payment collection.
- Phase 5: team invitation UI/API, audit history UI. Membership RLS and audit storage exist.
- Phase 6: API keys/versioned API, AI integration, IndiaMART sync, MCP, unattended recurring execution and native mobile apps.

## Known verification limits

Official Refrens account-only behavior remains blocked by the user's guest-only test instruction. No claim of exact signed-in source fidelity is made. No real email, WhatsApp message, payment, government submission or external lead sync has been sent. Live provider accounts/configuration are needed for those integration tests.

PDF export uses Latin/WinAnsi fonts and explicitly rejects unsupported Unicode. PNG/JPEG logos and signatures now embed in PDFs; product thumbnails do not. Server rendering of a profile-only WebP logo needs conversion through the editor. Record lists and pickers paginate up to an explicit 10,000-record ceiling. Elegant can put a signature on its own continuation page; Compact fits the tested signed invoice on one page.

## Phase 2 delivered

- Five selectable PDF templates: Classic, Modern, Minimal, Elegant and Compact; live preview and saved template preference.
- PNG/JPEG logo and signature embedding, bank details, private business logo prefill; remote artwork URLs rejected.
- Authenticated editor, saved-client/vendor and item pickers, session refresh, save-in-progress protection, and corrected purchase-order parties.
- Business-scoped saved-document PDF preview and download. Anonymous and cross-business access are rejected.
- Frozen PDF shares with expiring random tokens stored only as hashes, optional hashed passwords, temporary password lockout, view metadata and revocation. Anonymous direct table enumeration is denied.
- Email drafts (.eml) with attached PDFs, recipient/header validation, and a Resend send adapter with idempotency keys. No live provider account is configured and no message was sent. Acceptance by a provider would not prove delivery.
- WhatsApp URL construction is implemented and unit-tested; the UI keeps sharing blocked because the existing Site is owner-private. Outside recipients cannot use hosted share links until an appropriate public recipient surface is configured. Site access has not been widened.

The application share endpoint works without a business login, but the private hosting access gate still applies on the deployed Site. Hiding a download button is not copy protection. Revoking a link cannot recall a file already downloaded.

## Evidence

- ../reports/remediation-2026-10-20 (outside checkout): seven browser-downloaded PDFs, additional conversion/mobile downloads, screenshots for 41 local service links, Supabase isolation results.
- ../reports/phase1-2026-10-21 (outside checkout): profile/storage/numbering tests, role permission tests, dashboard fixtures, UI screenshots, selected CSV and duplicated PDF.
- ../reports/phase2-2026-10-22: 15 backend assertions; three PDF template previews; catalog/editor browser evidence.
- ../reports/phase2-2026-10-23: 29 sharing assertions, 10 session/expiry/lockout assertions, 85 unit tests, browser-downloaded PDFs/email draft, desktop/mobile screenshots and detailed report. These counts cover specific assertions, not a percentage of Refrens parity.

Credentials are excluded from reports and application source. Runtime requests use the publishable key plus each user's JWT so RLS stays active. Privileged credentials supplied in chat should be rotated by the project owner.
