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

## Status, 9 November 2026 (evening)

A first working version of the new editor is built at **`/editor-next/?document=invoice`** (hidden from search, not linked from the menu). It lives in `public/editor/` and is written from scratch: `model.mjs` (state and rules, tested against the PDF engine), `gst-states.mjs`, `editor.js` (the page), `editor.css`. `tests/editor-clean-room.test.mjs` fails if anything from the captured editor appears in that folder.

What it does today: document details (title, number, dates, payment terms, currency, logo), billed-by and billed-to with saved-client picker, items with HSN suggestions, per-line discount in rupees or percent, live totals with CGST+SGST or IGST chosen from the two GSTINs, amount in words, round-off, notes, terms, bank and signature, five PDF designs, preview and download, save to the account, number preview, restore of an unsent draft, plain-words validation that names and marks the first problem, and a phone layout. Totals were checked against figures worked by hand.

**Not in it yet, so the old editor stays the live one:**
- E4/E5: shipping and transport details, custom fields, attachments, line groups, discount on the whole document, cess, columns and number-format dialogs, VAT.
- Saved documents: the Issue, Add to books and Cancel bar (`document-actions.js`), locking after issue, opening a saved document by id with all its states, credit and debit note adjustments, quotation to invoice conversion, sales-order conversions.
- A signed-in draft store and the "sample record" flow.
- E6: switching `/free-online-invoice-generator/` and `/invoice-editor/` over, deleting the captured files and the old script, mobile pass.

Rough share of the old editor's behaviour now covered: about a third. Remaining: about 2 weeks.

## Launch gate

Do not promote the editor publicly (Product Hunt, directories, press) until E6 is done, or an IP lawyer has cleared the current files in writing. A private pilot with a handful of accountants carries less exposure but is not risk-free.

## Known editor bug to fix in E1

A fresh editor shows a red "Due date cannot be before the document date" although the default due date (Net 15) is later.
