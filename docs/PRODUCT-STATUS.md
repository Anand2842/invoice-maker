# Product status, 8 November 2026

Source of truth for what inbill does today. The website catalog (`public/service-catalog.json`), the Roadmap page (`public/roadmap/index.html`), the page for accountants (`public/for-cas/index.html`) and the home page must agree with this file. `tests/catalog-status.test.mjs` guards the catalog.

Status words: **Available** works and was tested. **Basic** works with limits. **Simulated** (shown as "Practice only") is a rehearsal with no outside connection. **Coming soon** is not built or waits on a connection.

| Area | Feature | Status | Scope today |
| --- | --- | --- | --- |
| Sales | Invoices, quotations, proforma, sales orders, delivery challans, credit notes | Available | Create, save, issue (final), duplicate, convert, dated cancellation; five PDF designs |
| Sales | Payments, receipts, client statements, advances | Available | Part payments, reversals, statements |
| Sales | Share by link | Available | View link |
| Sales | Email sending | Coming soon | Waits on an email service |
| Sales | Online payment | Coming soon | Payment link page pays in simulation only; waits on a payment provider |
| Purchases | Vendors, bills to pay, expenses, vendor statements, debit notes, purchase orders | Available | Manual entry |
| Purchases | Scan a bill, bulk upload | Coming soon | CSV import exists for some lists |
| Accounting | Chart of accounts, ledger, journals, trial balance, P&L, balance sheet | Available | Posting from sales and payments once set up |
| Accounting | Day book, cash flow statement | Coming soon | |
| GST | GSTR-1, GSTR-3B, HSN summary, GSTR-2B reconciliation | Basic | Prepared for the CA; not filed |
| GST | e-Invoice, e-Way Bill | Simulated | Practice values, not government registrations |
| GST | HSN and SAC finder | Available | 1,796 codes |
| Banking | Bank matching | Basic | By hand; no live feeds |
| Stock | Items, warehouses, movements, valuation | Basic | Few ready-made reports |
| Leads | Leads, stages, lead to quotation | Basic | No forms, meetings or templates |
| TDS | Records and certificates | Basic | Manual |
| Automation | Recurring invoices, reminders | Basic | Email sending not switched on |
| Team | Roles, activity log, delete a business (two steps) | Available | |
| Accountants | All businesses overview; invite a client by link (accountant added as admin after the client agrees) | Basic | First release (9 Nov 2026): no per-client GST readiness, no bulk actions |
| Setup | Getting started, sample data, page guides | Available | |
| Coming soon | CA view extras (GST readiness per client, bulk actions), Claude and ChatGPT connector, search, reports page, approvals, editor extras, IndiaMART sync, public API, phone apps | Coming soon | |
| Not planned | Payroll and HR, greetings, reviews, growth suite | | |
