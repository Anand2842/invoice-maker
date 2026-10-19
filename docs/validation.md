# Validation — 19 October 2026

- Node calculation/persistence suite: 14 passing tests. Covers currency rounding, discounts/tax, status dates, schema validation, invoice CRUD/numbering, restore/clear, corrupt raw data recovery, denied/quota storage, and prevention of stale cross-tab overwrites.
- Chrome browser checks: two-line invoice creation, editing, draft/issue, partial/full payment, overpayment prevention, validation, deletion confirmation, reload persistence, escaping user text, populated print iframe and invoked print operation. No uncaught errors.
- Supporting browser flows: add/edit client; add/delete expense; save business profile; search/filter/pagination; CSV downloads and formula escaping.
- Backup browser checks: download, clear while preserving business, reload and restore 12 invoices; corrupt saved JSON downloads a recovery file containing the original raw string. No uncaught errors.
- Layout checks: all six screens stay within the viewport at 1440px and 390px. Mobile line item and invoice tables intentionally scroll within their containers. All six revenue months fit within the mobile chart.
- Visual inspection: desktop and mobile dashboard screenshots. Invoice module checked at desktop and mobile widths.

The hosted application is static. Hosting does not add a database, payment processor, or cross-device data synchronization. Final native deployment status verifies publication separately from the local checks above.
