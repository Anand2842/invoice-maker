# Folio reconstruction notes

Reference: https://www.refrens.com/ — inspected 19 October 2026.

## Scope

The user selected billing and invoices. Folio is an independent implementation, with its own name, layout, design, code, and sample records. The build prioritizes invoice creation, client records, partial payments, invoice previews, and browser print/PDF. Supporting screens cover expenses, monthly reporting, and business settings.

## REA evidence ledger

- `ev_2c846f95d257fec7f70903f2bc03ce745d6af2dd422c216c82a576185f8c9c90`: controlled Chrome scenario opened https://www.refrens.com/free-online-invoice-generator and waited 1.5 seconds. The accessible page exposed the details → design/share sequence and the “Create Your First Invoice” action. The public explanatory content described business/client details, quantity/rate line items, tax, notes and PDF output.
- `ev_788911d5175d8ec280ca0fb938f16c4aedf080cfa49978491158fe35a27e6deb`: REA clicked “Create Your First Invoice” and waited one second. The resulting accessibility snapshot exposed invoice number, invoice date, add due date, and custom fields. Some editor content was still loading. We do not claim the full editor or an authenticated workflow was exercised.

These are runtime observations of public pages. They do not establish Refrens backend implementation, authenticated behavior, network contracts, or product completeness. The temporary browser profiles were terminated by REA after capture.

## Official feature references

- https://www.refrens.com/free-online-invoice-generator — public invoice workflow and advertised features.
- https://www.refrens.com/free-online-invoicing-software — invoice tracking and payment features, advertised.
- https://help.refrens.com/en/article/how-to-show-the-due-amount-on-the-invoice-1lmo7ug/ — documented payment recording and due balances.
- https://help.refrens.com/en/article/how-to-view-download-the-client-statement-and-vendor-statement-1ie63y7/ — documented client statements.
- https://www.refrens.com/free-expense-management-software — expense feature reference, advertised.
- https://help.refrens.com/en/article/how-to-create-your-own-custom-reports-11fzdnw/ — documented reporting concepts.

## Implementation choices

Browser-local storage, INR currency, the Folio dashboard, original sample studio data, date/status conventions, CSV export and JSON backups are independent design choices. Invoiced/collected chart figures are grouped by invoice issue month. Payment tracking records amounts; it does not process a payment or send email. Tax is a configurable single percentage on subtotal minus absolute discount; this build does not implement statutory GST filing, e-invoicing, split CGST/SGST, or tax jurisdiction decisions.

## Validation

Meaningful calculation and persistence tests live in tests/data.test.mjs. Browser verification covers invoice creation/edit/draft/issue/payment/delete, print iframe population, persistence, client selection and mobile overflow. See README for running the app and data storage behavior.
