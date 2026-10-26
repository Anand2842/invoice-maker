# Phase 3 implementation and test report

**Completed local verification: 26 October 2026 (Asia/Kolkata).** Work began on 25 October; the evidence folder retains that start date.

**Verdict: this is still a partial Refrens reconstruction, not a complete independent replica.** This batch adds usable GST workpapers, a searchable reference catalog and adjustment-limit evidence. It does not complete statutory filing or Phases 4–6.

## Release and environment

| Surface | Verified state |
|---|---|
| Local application | New features implemented and exercised at http://127.0.0.1:4173 |
| Supabase | Existing business-scoped auth/RLS used; adjustment-limit migration applied and tested with synthetic demo records |
| Production build | Passed using the Sites 1.1.2 build helper |
| Publicly hosted application | No new release confirmed. Last confirmed deployment is owner-private Site version 4 / Phase 2 |
| Publication preparation | Initial Sites authentication failed; a fresh credential and owner-private access were subsequently verified. Final deployment result is recorded in release-verification.json |
| Source | Source helper packaging/publication follows local validation. Final commit and deployment identifiers are recorded in release-verification.json |

The new calculation/reporting paths use this application's code and the user's Supabase backend. They do not call a Refrens accounting backend. Exact signed-in Refrens behavior remains unverified because source testing is guest-only by instruction.

## Requested immediate steps

| Request | Outcome | Remaining gap |
|---|---|---|
| Synchronize implementation status | Done locally | Publication remains blocked |
| Adjustment limits and concurrency verification | Passed 12 database assertions with exact exception checks | Bounded concurrency test, not a load/soak test or proof against all direct database payload tampering |
| HSN/SAC searchable reference and picker | Implemented: 1,796 unique codes, keyboard selection, descriptions, format validation | Not a complete Indian tariff/rate master. Only five conditional IT-service rate suggestions are populated |
| GSTR-1 / GSTR-3B engine, API, UI, JSON and CSV | Implemented and tested as review workpapers | GST portal-schema upload files and filing validation remain unimplemented |

## What was built

### Adjustment notes and tax calculations

The current local app supports percentage cess per line, optional INR rupee rounding, invoice-linked credit/debit notes, original-invoice references, and HSN summaries in PDFs. Issued credits cannot exceed the original invoice plus issued debit notes in the tested application workflow. The database serializes competing adjustments on the parent invoice. It prevents reductions of that invoice and cancellation of debit notes when they would invalidate existing credits. Notes remain linked to the original currency and parties.

The test uses an invoice of INR 1,180. An initial INR 1,000 credit succeeds; another INR 200 is rejected. An issued INR 100 debit permits the additional INR 200 credit. Two simultaneous INR 700 credits against a separate INR 1,180 invoice result in exactly one successful issue and one explicit cap rejection. The rejected transaction is checked to ensure it did not merely time out or deadlock.

These tests use application-validated amounts. The SQL cap currently reads stored totals; independent recomputation of every monetary field for arbitrary direct Supabase writes remains hardening work. RLS restricts business access but does not replace calculation validation.

### HSN/SAC catalog

- 1,229 four-digit HS 2022 goods headings plus 567 six-digit SAC service classifications.
- 1,796 unique entries; 306,932-byte JSON; approximately 56 KB gzip, below the requested 80 KB target.
- Searches by code prefix or description, with up to 20 displayed matches.
- Arrow keys, Enter and Escape; combobox/listbox semantics.
- Selecting a code fills an empty description. Existing descriptions are preserved.
- Five IT-service entries suggest 18% conditionally. All other rates are null and leave the entered tax rate unchanged, with a review message.
- Server validates 4/6/8-digit format. Unknown codes are not falsely declared invalid solely because the bundled catalog is incomplete; reports flag codes missing from the reference.
- Explicit supply classification, two-digit place of supply, and item unit code are saved with the invoice. Notes use the original invoice classification.

This does **not** satisfy the stronger requirement for a fully verified, current Indian 6/8-digit HSN master with comprehensive GST/cess rates, exemptions and notifications.

### GST reports

The authenticated API is `GET /api/reports/gst` with business, from, to, type (`gstr-1` or `gstr-3b`), demo and format (`json` or `csv`). Business access is checked with the signed-in user's Supabase token. Responses are not cached. Anonymous access is rejected and another account cannot report on the owner's business. The API has an explicit 10,000-record ceiling and fails rather than showing partial totals.

Supported workpaper aggregation:

- B2B, B2CL, B2CS, registered notes (CDNR), applicable unregistered notes (CDNUR), basic export and nil/exempt/non-GST categories.
- B2CS credits are netted against their supply category, including when the original invoice is outside the report period. Small notes against a large-consumer invoice use the original invoice classification.
- B2CL classification uses the historical INR 250,000 threshold before August 2024 and INR 100,000 thereafter. The comparison is strictly greater than the threshold and uses invoice value.
- HSN summaries are separated into B2B/B2C groups and retain rate, quantity, taxable value and GST/cess components.
- GSTR-3B-style outward summaries, recorded inward reverse charge, explicitly reviewed input tax and reversals.
- Vendor GSTIN alone does not grant ITC. The form requires an eligibility review and an explicit GSTR-2B reconciliation flag before marking an expense eligible. This is a manual declaration, not an imported or independently verified reconciliation.
- Drafts, cancelled/archived records, foreign-currency invoices and unsupported or inconsistent records are excluded or disclosed with review issues.
- JSON carries `portalReady: false` and schema `folio-gst-workpaper-v1`. CSV exports signed amounts as numbers while guarding formula-like text.

Missing statutory coverage includes current portal schema adapters/validation, amendments, advances, e-commerce sections, SEZ/deemed-export treatment, GSTR-2B import, GST registration-status checks, payment/return filing, and complete ITC legal categorization. An error-free supported workpaper is not proof of a file's suitability for GST portal upload.

## Verification results

| Test group | Final result | Evidence |
|---|---:|---|
| Full unit regression | 122 passed, 0 failed | unit-tests.txt |
| Adjustment database tests | 12 passed, 0 failed | concurrency-tests.json |
| GST authenticated API smoke | 26 passed, 0 failed | gst-backend-tests.json |
| Follow-up saved-editor / API checks | 9 passed, 0 failed | final-backend-tests.json |
| JavaScript syntax | Passed | source-check.txt |
| TypeScript | Passed | typecheck.txt |
| Production build | Passed | build.txt |
| Browser PDF downloads in this batch | Invoice, credit note and debit note passed | browser-invoice.pdf, browser-credit-note.pdf, browser-debit-note.pdf |
| PDF verification | All three parse, contain expected amounts/references, and render legibly on one page each | pdf-checks.json, *-render.png |
| Browser JSON/CSV downloads | GSTR-1 and GSTR-3B passed | browser-gstr1.*, browser-gstr3b.* |
| Mobile report | 390px viewport, 390px document width; tables scroll within their container | gst-report-mobile.png |
| Deployment | Verification recorded separately after publication | release-verification.json |

The 122 tests are assertions over a limited implementation. They are not a completion percentage or proof of feature parity. Earlier broad guest navigation tests and seven document-type downloads are retained in the October 20–23 reports; they were not all rerun in this focused GST batch.

### Browser scenarios exercised

1. Search SAC by description and code prefix; select by keyboard.
2. Prefill description and preserve existing text; unverified goods code keeps the entered GST rate.
3. Save and reopen invoice; confirm code, description, unit and place of supply persist.
4. Edit again after reopening; confirm the form is no longer stuck in a saved lock state.
5. Save a parent invoice with unchanged parties while linked adjustments exist.
6. Download invoice, credit note and debit note individually.
7. Confirm note classification/place-of-supply controls are locked to the original invoice.
8. Generate August demo GSTR-1 and GSTR-3B workpapers; download JSON and CSV.
9. Change a report filter and confirm exports are disabled until regeneration.
10. Verify mobile report width and navigate to Expenses.
11. Attempt eligible ITC without reconciliation; receive the expected validation message.
12. Mark the synthetic expense reviewed/reconciled, save and reopen; confirm tax amounts persist.

The August fixture reconciles to INR 101,400 taxable outward value, INR 18,000 IGST, INR 126 CGST, INR 126 SGST and INR 18 cess. Reviewed ITC is INR 9 each CGST/SGST, reversals INR 1 each, net INR 8 each. Two review issues are intentional: one unreconciled expense and one USD invoice. The exported credit taxable value is numeric -100; summing CSV taxable values yields 101,400.

## Defects found and fixed during this batch

| Defect | Correction and verification |
|---|---|
| Empty description stayed as a template placeholder after SAC selection | Clear new editor placeholder, populate selected description; browser save/reopen verified |
| Saved invoice could reopen as an uneditable form | Remove transient `inert` lock from saved markup and clear it on restore; save/reload/edit verified |
| An unchanged party acquired extra normalized fields during save, conflicting with note links | Preserve original party objects when form values have not changed; server check verified canonical party equality |
| GSTR-3B CSV initially exported invoice detail instead of section totals | Export outward/RCM/ITC summaries for 3B; API and browser downloads verified |
| Credit amounts were escaped as spreadsheet text | Shared CSV encoder preserves finite signed numbers and escapes formula-like text; numeric CSV sum verified |
| Invalid parent/reversal data could partially affect report totals | Validate before accumulation; unit coverage added |
| Review links pointed to the wrong workspace | Expense issues route to Expenses; document issues route to the specific editor |
| Negative database test accepted any thrown error | Require exact SQLSTATE/message; discovered and corrected a SQL whitespace typo in the test harness, then reran all 12 assertions |

The earlier 11-pass concurrency claim is superseded by the stricter 12-pass result. The faulty harness did not prove its parent-reduction assertion until the corrected rerun.

## Still left to build or validate

1. **Finish Phase 3:** portal-schema JSON, complete current HSN/rate coverage, missing return sections and GSTR-2B reconciliation; IRN/eWay Bill adapters and live tests.
2. **Phase 4:** client/vendor statements, opening/running balances, aging, receipt vouchers, payment collection/webhooks, P&L and other financial reports. Existing manual payment recording is not payment collection.
3. **Phase 5:** invitations, role-management UI/API, audit-log viewer and team scenario tests.
4. **Phase 6:** external API keys/versioning/webhooks, AI integration, IndiaMART sync, MCP service, unattended recurring execution, native mobile applications.
5. **Release verification:** publish the exact checked source privately and retain the native deployment result; production external-integration tests remain blocked.
6. **Product fidelity:** authenticated-source comparison remains blocked by the guest-only instruction. No exact clone claim is justified.

Existing PDF limits still apply: Latin/WinAnsi text support, no product-thumbnail embedding, profile-only WebP conversion limitations, and possible Elegant-template signature continuation pages. This batch used the Compact design. No broad load, accessibility audit, browser matrix or concurrent multi-team test was performed.

## Source references

- [GST portal GSTR-1 preparation guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm) — threshold and HSN grouping reference consulted during implementation.
- [GST portal GSTR-1 guidance](https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm) — adjustment classification reference.
- [GST Council Circular 170/02/2022](https://gstcouncil.gov.in/node/4891) — ITC/reversal review reference.
- [UN Statistics HS 2022 reference](https://comtradeapi.un.org/files/v1/app/reference/H6.json) — four-digit goods headings.
- [GST Council amended service classification](https://gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf) — SAC descriptions.
- [GST Council service-rate schedule](https://www.gstcouncil.gov.in/sites/default/files/2024-02/gstservicerates.pdf) — conditional IT-service suggestions; not a complete current rates database.

Catalog source hashes and coverage limitations are embedded in public/data/hsn-sac.json. A reproducible builder is scripts/build-hsn-reference.py. The subsequent 26 October web-tool recheck was unavailable because of the then-invalidated connector token; no claim is made that the entire rate schedule was revalidated on that date.

## Data handling and test accounts

Tests used the existing synthetic owner and isolation-test accounts and `demo=true` records. Test records remain in the demo workspace; no real business record was deleted. Passwords, service-role credentials, database connection secrets and share tokens are excluded from this report and the repository. No real email, WhatsApp message, payment or government filing was sent. Live integrations remain blocked because provider accounts have not been supplied.
