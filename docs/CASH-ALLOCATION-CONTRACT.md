# Next user-priority domain: cash, allocations, credits and refunds

Required implementation after the paid-expense checkpoint. This contract does not mark the domain built. Keep all original payment/receipt rows immutable and readable; do not migrate them by guessing cash or replaying income.

## Separate money from allocation

A new cash receipt/disbursement has one party, business, data mode, currency, effective date, immutable party/method/reference snapshot and stable command identity. An incoming customer receipt initially credits a reviewed customer-advance liability; outgoing vendor advances initially debit a reviewed vendor-advance asset. Each invoice/bill allocation has its own date and source link, consumes available funds and moves the advance control to AR/AP. One cash event must never become multiple fictional receipts merely because it covers several invoices/bills.

Old v14 single-invoice receipts and vendor payments stay as existing direct settlements. New reports must combine their dated effects with new allocations exactly once. New allocation projections must have explicit kinds/links; they cannot masquerade as old authoritative payment events.

## Invariants

- Tenant, party, mode, currency and source identity must match. No merging by a matching name. Missing historical client/vendor links need explicit review.
- Lock AR invoice targets in sorted UUID order before business/config locks, preserving v14 invoice → business ordering. Existing AP writers use business → config → bill ordering; new AP allocation commands must keep that order. Mixed AR/AP targets are not one command.
- Commands, immutable events, projected report rows, balanced journals, audit and outbox commit atomically. Same actor/key/exact payload returns the original result before mutable version/period checks. Altered/foreign keys conflict. Recheck authorization after waiting for business locks.
- Multi-target allocations cannot exceed available funds or a source balance. Validate the full dated event history, including later already-recorded events, so a backdated allocation cannot make any intermediate balance negative. Do not permanently substitute a blanket backdate prohibition for the planned dated workflow.
- Unallocate/reverse preserves original events and records its own effective date. It restores availability and AR/AP only from that date. Reversing a cash receipt requires allocations/refunds to be reversed/released first, with date ordering that preserves every as-of balance.
- Unapplied advances and credit balances stay separate from invoice/bill balances and aging. A future-dated event cannot settle an earlier report. Current document status never fabricates cash.
- Every source/reversal has an authoritative journal link (or explicit zero-effect provenance), and generic GL reversal cannot bypass its domain correction command.

## Credits and refunds

Vendor credit issuance freezes the reviewed source bill/reference, vendor, amounts, expense/input-tax reversal accounts and original link. Cap credit issuance against the reviewed source instead of double-crediting after cancellation. Unapplied vendor credit is distinct from bill settlement; explicit allocations reduce AP. Credit reversal/refund and source bill reversal obey chronological availability constraints.

A refund is a cash event, not an allocation reversal. Support explicitly confirmed outside-Folio cash refund records and a mock gateway request/reservation/acknowledgment path. Provider request retries use stable idempotency identities and leased outbox dispatch; reserved funds cannot be allocated/refunded twice. Provider failure/timeout is not success and must not mutate settlement based on a browser callback.

All external providers are user-selected mocks. Mock gateway success must never pretend real money moved. Provider simulations affecting financial projections belong to demo/simulation mode. Real-record cash changes require explicit outside-Folio payment/refund confirmation; otherwise return a clear unavailable state. Customer credit-note refunds need an explicit source-credit/AR movement; do not infer an available advance merely from a Paid flag.

## Journeys and proof

Build complete UI/API/SQL/receipt/report paths for: one receipt → several invoices → unapplied remainder → later allocation; one vendor disbursement → several bills/advance; partial unallocation/reversal; credit issuance → allocation/refund → correction; refund request → duplicate/timeout/failure → final mock acknowledgment without duplicate cash. Reports/aging/GL controls and receipt PDFs/print must reconcile on dates before, on and after each event.

Cover real/demo/party/currency/role denial, exact retry and altered keys, stale versions, amount/exponent precision, closed periods, backdated history, injected rollback at each projection/audit/outbox stage and actual overlapping connections when infrastructure is available. Retain the explicit browser/phone/concurrency/production gates; passing an in-memory SQL suite is not proof of all of them.
