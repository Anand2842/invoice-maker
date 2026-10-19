# Folio

An original personal billing workspace inspired by the public Refrens invoice workflow. Built with plain JavaScript, CSS, and native browser dialogs. No application dependencies or build step.

## Run

```sh
npm run dev
```

Open http://127.0.0.1:4173. The deployable application is in `dist/`.

```sh
npm run check
npm test
```

## Included

- Monthly dashboard with invoice totals, outstanding balances, overdue amounts and six/three-month revenue charts.
- Invoice creation/editing, multiple line items, configurable tax, absolute discounts, draft/issued states and derived payment status.
- Client directory and invoice history, optional GSTIN and business profile.
- Partial/full payment recording and printable A4 invoice previews. Use the browser print dialog to save as PDF.
- Search, status filters, pagination, selection and spreadsheet-safe CSV exports.
- Expense ledger, monthly reports, JSON backup/restore and an explicit clear-workspace action.
- Responsive desktop/mobile layouts and keyboard-accessible native dialogs.

## Your records

The app starts with fictional sample records for October 2026. Update the business profile in Settings, then use Clear workspace to start your own records. Data is stored in this browser under `folio.workspace.v1`, on this device and origin. Private hosting controls who can open the app; there is no server-side database or cross-device sync. Download a backup from Settings for portability. Restore replaces the current workspace only after confirmation. Storage failures are surfaced and mutations roll back.

Amounts are INR. Taxes are a single configurable percentage after discount. Payments are manually recorded amounts, not bank transactions. The app does not send invoices by email, process payments, perform GST filing, or provide statutory accounting reports. Collections in charts/reports use invoice issue month rather than payment date.

Public reference observations, official sources, REA Evidence IDs and investigation limitations are recorded in `docs/reconstruction.md`.
