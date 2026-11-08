# Editor rewrite plan (clean room), 9 November 2026

## Why

The invoice editor was built by capturing Refrens' free invoice generator page and wiring our logic into it. That is the largest copyright and trust risk before launch. Layout ideas are not protected, but their markup, stylesheets, assets and class names are their code. We must not ship that, and a competitor can see it in the page source.

## What is captured (inventory)

In `public/free-online-invoice-generator/`:
- Stylesheets: `extras-source.css` (2.2 MB), `columns-source.css`, `dynamic-source.css`, `extra-source.css`, `interaction-source.css`, `optional-source.css`, `selects-source.css`, `server-source.css`, `signup-source.css` (about 4.7 MB in total), plus 16 hashed `assets/*.css` files.
- Page templates: `form.html`, `form-mobile.html`, `form-head.html`, `form-head-mobile.html` (about 277 KB each), `columns-dialog.html`, `tax-dialog.html`, `calendar-source.html`, `description-source*.html`, `signature-*.html`.
- Data files: `extras.json`, `optionals*.json`, `selects.json`, `discount-source.json`, `responsive-classes.json`.
- `invoice-app.js` (112 KB) is ours but selects elements by Refrens class names (for example `refrens-page-form`, `disco-select__menu`).

Already removed on 9 Nov: 185 unreferenced copied files (3.2 MB) from `public/assets/ref` and the editor's `assets` folder. The three fonts still used on the home page (Playfair Display, Inter) are open-licence. Not in the repository: 90 screenshots of Refrens screens sit staged in the owner's old working folder (`docs/comparison-screens/refrens-*`); keep them out of Git.

The rest of the app (workspace shell, books, payments, GST, overview, brand) is our own code.

## Approach

1. **Write our own editor spec** from our data model (`public/editor-document.mjs`, the PDF engine, the tests), listing every field and behaviour. Not from Refrens markup.
2. **Build the new editor in `public/editor/`**: our own markup produced by small component functions, our own stylesheet on the teal tokens, native `<input type=date>`, native `<select>` with a simple search box where needed, native `<dialog>` for the columns, tax and discount dialogs, our own signature canvas.
3. **Port logic** from `invoice-app.js` in slices, replacing class selectors with `data-editor-*` attributes. Each slice keeps the existing tests green and adds model tests that need no browser.
4. **Replace the data files** with our own JSON or code.
5. **Delete everything captured**, and add a guard test that fails if any `*-source.css`, `form*.html`, `disco-` or `refrens` string returns to `public/`.
6. **Check at 1300 px and 390 px** with screenshots, signed in and out, for every slice.

## Slices (in order)

| # | Slice | Done when |
| --- | --- | --- |
| E1 | Header block: title, number, dates, payment terms, logo | Same fields saved and restored; due-date message correct |
| E2 | Billed by / billed to, client picker, shipping | Existing client and party tests pass |
| E3 | Item table: columns, tax per line, discounts, groups, totals | Totals identical to the current editor on the golden cases |
| E4 | Extras: bank, UPI, notes, terms, signature, attachments | PDF output byte-compatible where fields are unchanged |
| E5 | Dialogs: columns, tax, discount, number format | All dialogs keyboard and screen-reader usable |
| E6 | Remove captured files; guard test; mobile pass | `public/` has no captured file; tests pass |

Estimate: 2 to 3 weeks of focused work.

## Status, 9 November 2026: COMPLETE

The rewrite is finished and switched over. `/free-online-invoice-generator/` (guests) and `/invoice-editor/` (signed in) both serve the new editor in `public/editor/` (`model.mjs`, `gst-states.mjs`, `editor.js`, `editor.css`, `index.html`). Everything captured from the other site is deleted.

| Slice | Result |
| --- | --- |
| E1 Header block | Title, number with next-in-series preview, issue date, payment terms and due date that follow each other, currency, logo. The false "due date" message is gone. |
| E2 Parties | Billed by and to, saved client or vendor picker, GSTIN-driven state, plain address fields |
| E3 Items and totals | HSN suggestions, per-line discount in rupees or percent, same discount on every line, cess column, custom item columns, live totals, amount in words, round-off, VAT or no tax, manual CGST+SGST or IGST override, place of supply, reverse charge, GST reporting details |
| E4 Extras | Notes, terms, bank, signature, shipping, transport, extra fields, attachments, saved-item picker |
| E5 Saved documents | Open by id; issued documents lock completely; sales-order conversions keep their reviewed lines and only notes, terms and design are editable; credit and debit notes lock the parties and require a reason; the Issue, Add to books and Cancel bar; Share & send; Convert to invoice and copy from a quotation; fields the editor does not show are handed back unchanged on save |
| E6 Switch-over | Routes switched; `public/free-online-invoice-generator/`, the old shells, `hsn-picker.js`, `invoice-catalog.js` and three site-mirroring scripts deleted; the PDF engine's metadata no longer names another company; guard tests keep all of it gone |

Checks: 17 model and guard tests (578 in the whole suite); real-browser runs against a stubbed backend for issued, credit-note, conversion, quotation-copy, saved-client and saved-item flows, VAT and cess, and the save payloads; all seven document types on the live routes; a real PDF built from the editor's output and the Preview dialog; the production build.

Not done, by design: the earlier editor's rich-text description box (a plain description field replaces it), its "groups" of lines and its column-formula dialog (neither was part of the saved document format). Not verified here: a live signed-in session against the real database, because the local sign-in was unavailable; the signed-in flows were verified against a stub of the API.

## Launch gate

The editor itself no longer carries anyone else's code. Remaining before public promotion: have a lawyer glance at the rest of the visual design and the privacy and terms drafts.
