# MVP scope and availability - 27 October 2026

Release candidate for a controlled billing pilot, not a complete Refrens replica or a public-launch certification.

## Available for the limited MVP

Nine document PDF types, five PDF designs, saved documents, client records, business profile/defaults, document duplication, draft conversion workflows, and client statement exports. The PDF font remains Latin/WinAnsi. Live payment collection and message delivery are excluded.

## Basic features only

Manual inventory records, vendor directory, manual expenses, lead stages, manual recurring-invoice schedules, balanced journal entry, basic dashboard and GST review workpapers. These must not be advertised as complete accounting, inventory automation, automatic subscriptions or statutory filing.

## Coming soon

AI accounting; automated OCR/WhatsApp expense ingestion; IRN/e-Invoicing and eWay Bill government submission; external invoicing API keys/webhooks; independent MCP; IndiaMART synchronization; native Android and iOS apps. Full financial statements, vendor payables, payment entry/receipts/refunds, team management UI and unattended recurring jobs remain unfinished.

## Public launch checks still required

The Site remains owner-private. Public access and external share hosting were not enabled. Establish the product's own branding and review the copied marketing claims; restrict launch promises to tested scope. Confirm production onboarding/recovery-email delivery, privileged-secret rotation, backups/restoration and support arrangements. Responsive/mobile verification remains inconclusive because the browser viewport override did not take effect in the previous test. Dashboard status-based pending totals differ from the dated settlement model; a visible Basic overview notice now explains the limitation.

## Changes in this release

- Explicit Available / Basic / Coming soon / Category shortcut labels across 41 catalog destinations.
- Basic service titles describe their actual scope; automated expense service points to its separate manual alternative.
- Homepage MVP availability notice and dashboard limitation notice, with GST reports navigation restored on dashboard.
- Settings save/upload handlers are installed before the private logo fetch. Stale logo responses cannot overwrite a newly selected image or another rendered form.

## Verification

157 unit tests; 79 fresh API checks; 41 browser destination/label checks. Fresh demo CRUD includes edit, stale-write rejection, archive/restore and readback. Browser PDF downloads for nine document types and five templates, CSV exports for seven record modules, statements and GST workpapers; settings save/reopen and share create/revoke. All share tokens created in this run were revoked; no messages or financial transactions were sent. This is targeted smoke/regression testing, not load testing or a full security/compliance audit.

The final PDF handover and screenshots are outside the source checkout at ../reports/mvp-handover-2026-10-27 and ../output/pdf. Deployment verification is recorded there after publication.

## Catalog inventory

| Original requested entry | Launch display | Label | Exact scope |
|---|---|---|---|
| Accounting Software | Manual accounting journals | Basic | Add balanced journal entries and export CSV. Trial balance, P&L and balance sheet are coming soon. |
| AI Accounting Agent | AI Accounting Agent | Coming soon | AI accounting is not connected. Manual journals are available separately. |
| GST Billing Software | GST invoicing | Basic | Create GST invoices and review workpapers. Government filing, IRN and eWay Bill submission are coming soon. |
| Invoicing Software | Invoicing Software | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Quotation Software | Quotation Software | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| e-Invoicing Software | e-Invoicing Software | Coming soon | IRN generation and government submission are not built or connected. GST invoice PDFs are available. |
| eWay Bill Software | eWay Bill Software | Coming soon | Government eWay Bill generation is not built or connected. Delivery challan PDFs are available. |
| Inventory Software | Basic inventory records | Basic | Manage item quantities, rates and reorder levels. Automatic stock movements, warehouses and valuation are coming soon. |
| Automated Expense Recording | Automated Expense Recording | Coming soon | Automated OCR/WhatsApp expense recording is not built. Manual expense entry is available separately. |
| Vendor Management | Vendor directory | Basic | Save vendor contacts and use them in purchase orders. Vendor bills, payment allocation and payable statements are coming soon. |
| Invoicing API | Invoicing API | Coming soon | External API keys, a versioned customer API and outbound webhooks are not available. Internal signed-in APIs support this app. |
| Sales CRM | Basic sales CRM | Basic | Track leads, stages and values; create quotations. Automated lead ingestion and advanced CRM workflows are coming soon. |
| Refrens MCP | Refrens MCP | Coming soon | An independent MCP service has not been built. This app does not use Refrens MCP. |
| Lead Management Software | Basic lead management | Basic | Add leads, change stages and generate quotations. Automated ingestion is coming soon. |
| Subscription Management Software | Recurring invoice schedules | Basic | Track schedules and generate each invoice manually. Automatic runs, charging and dunning are coming soon. |
| GST Invoice Maker | GST Invoice Maker | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Invoice Generator | Invoice Generator | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Quotation Generator | Quotation Generator | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Creator Proforma Invoice | Creator Proforma Invoice | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Invoice Formats | Invoice Formats | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Create Purchase Order | Create Purchase Order | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Create Delivery Challan | Create Delivery Challan | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Quotation Templates | Quotation Templates | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Commercial Invoice | Commercial Invoice | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Download Mobile App | Download Mobile App | Coming soon | An independent Android app has not been built. Use the web workspace. |
| Download iOS App | Download iOS App | Coming soon | An independent iOS app has not been built. Use the web workspace. |
| Consulting Invoice | Consulting Invoice | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| SMBs | SMBs | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Consultants | Consultants | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Startups | Startups | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Chartered Accountant | Chartered Accountant | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Export/Import Business | Export/Import Business | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Professional Services | Professional Services | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Freelancers/Self-Employed | Freelancers/Self-Employed | Category shortcut | A shortcut to the same document and record tools. This is not a separate industry-specific product. |
| Lead to Quote Software | Lead to quotation | Basic | Create a draft quotation from a saved lead. Review customer and tax details before sending. |
| Expense Management Software | Manual expense records | Basic | Record expenses and reviewed input tax. OCR, automatic ingestion and bank reconciliation are coming soon. |
| Quote and Invoice Software | Quote and Invoice Software | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
| Pipeline Management Software | Basic sales pipeline | Basic | Manage lead stages and export records. Advanced sales automation is coming soon. |
| Indiamart CRM Integration | Indiamart CRM Integration | Coming soon | IndiaMART lead synchronization is not connected. Manual lead management is available. |
| Quote Templates in Word & Excel | PDF quotation templates | Basic | Create quotations using PDF templates. Editable Word and Excel template downloads are coming soon. |
| Tax Invoice Templates | Tax Invoice Templates | Available | Create, save, reopen and download document PDFs. Live payment collection and message delivery are not included. |
