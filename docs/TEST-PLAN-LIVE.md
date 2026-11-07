# Live site test plan: https://folio-ten-weld.vercel.app

Tester: Claude, driving the owner's Chrome. Date: 7 November 2026. Release: `p0-p1-completion` @ `a86db3a`.

## Ground rules

* **No sign-in or sign-up by the tester.** Claude does not type passwords or create accounts on the live site. The owner
  signs in once in the test window; Part B starts after that.
* **Writes happen in sample data only.** Every create, issue, payment, bill or posting in Part B is done with the yellow
  "Sample data" bar showing. Sample records are stored separately and have their own number series, so the real
  business, its invoice counter (next: P1-000010) and its reports are untouched.
* **Real records are read-only.** Real-mode pages are opened and read; nothing is saved, issued, deleted or imported.
* **Nothing leaves the site.** Email, e-Invoice, e-Way Bill and payment gateway are practice modes until Resend and
  Razorpay are connected. No share link is sent to anyone.
* **No browser dialogs.** Delete/archive buttons that open a confirmation are not clicked.
* Every page is checked for: loads without error, no console errors, no failed API calls (4xx/5xx other than expected
  sign-in checks), no horizontal scroll at phone width, sidebar and Help & demo present on workspace pages.
* Results are recorded in the table at the end: Pass / Fail / Blocked, with the issue.

## Part A: signed out (visitor)

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| A1 | Home | Open `/`; read hero, calls to action, footer links | Loads; every link goes to a real page (no 404) |
| A2 | Tool pages | Open `/services/` and each public tool page linked from it | Load; no "coming soon" for features that exist |
| A3 | Free invoice | `/free-online-invoice-generator/?document=invoice&fresh=true` | Form loads in under 5 s; due date set; Payment terms = Net 15 |
| A4 | Invoice maths | Fill seller, buyer, 2 items (qty × rate, 18% GST), discount | Subtotal, tax, total correct; total in words shown |
| A5 | Payment terms | Change Net 15 → Net 30 → Due on receipt; change issue date | Due date follows each change |
| A6 | GST invoice | `?document=gst-invoice`; seller GSTIN 27…, buyer GSTIN 29… | IGST applied (inter-state); same state → CGST + SGST |
| A7 | PDF | Preview PDF; switch the 5 designs; download | Preview centred; place of supply, HSN, amount in words present; file downloads |
| A8 | Other documents | Quotation, proforma, purchase order, delivery challan, credit note, commercial invoice | Each opens with the right title and fields |
| A9 | Draft memory | Fill a field, reload | Draft restored from this browser |
| A10 | Sign-in prompts | Open `/dashboard`, `/receivables/`, `/payables/`, `/accounting/`, `/settings/`, `/start/` | Clear "sign in" message and button; no raw errors |
| A11 | Login page | `/services/?account=login` | Form renders; links to reset password work (not submitted) |
| A12 | Help & demo | Click Help & demo on 3 pages | Guide opens with steps for that page; closes with Esc |
| A13 | Mobile | Repeat A1, A3, A10 at 390 px wide | No sideways scroll; Menu button opens the sidebar |
| A14 | Bad links | `/nonexistent/`, `/share/?token=bad`, `/pay/?link=bad` | Friendly not-found / invalid-link messages |
| A15 | Security | Call `/api/records`, `/api/workspace`, `/api/documents/number` signed out | 401 "Sign in", no data |

## Part B: signed in (owner signs in first)

### B1. Account and real business (read-only)

| ID | Steps | Expected |
|----|-------|----------|
| B1.1 | `/dashboard` | Greeting, business picker, totals in ₹, chart with month names, recent documents |
| B1.2 | `/start/` | Checklist reflects real progress; links open the right pages |
| B1.3 | `/settings/` | Business details, GSTIN state, bank details, invoice prefix and next number (P1, 10) shown |
| B1.4 | Clients, Vendors, Items, Leads lists | Real lists load; State, GSTIN, HSN and GST columns show |
| B1.5 | Invoices & documents | Real documents listed with Draft/Issued/Paid status |
| B1.6 | Open one real document | Opens with saved values; action bar matches its status; **not saved** |
| B1.7 | Money to collect, Bills to pay, Books, GST returns, Activity log | Load without errors; setup messages are plain and link to the next step |

### B2. One-click sample business

| ID | Steps | Expected |
|----|-------|----------|
| B2.1 | Help & demo → "Show me with sample data" (or Getting started → Explore) | Progress messages; lands on dashboard with yellow Sample data bar |
| B2.2 | Dashboard in sample mode | Revenue, pending, overdue, expenses non-zero; chart has bars; SAMPLE-INV-001…004 listed |
| B2.3 | "Back to my records" | Bar disappears; real figures return unchanged |

### B3. Sales flow (sample mode)

| ID | Steps | Expected |
|----|-------|----------|
| B3.1 | Clients → add client with State, no GSTIN | Saved; appears in list |
| B3.2 | Items → add item with HSN 9983, GST 18% | Saved; validation rejects bad HSN / rate > 100 |
| B3.3 | New invoice → choose saved client, add saved item | Fields fill in; IGST vs CGST+SGST follows client state |
| B3.4 | Save | Number assigned on save (sample series); status text explains it |
| B3.5 | Issue (make final) | Becomes "Issued — this document is final"; only Cancel remains |
| B3.6 | Money to collect → record part payment by UPI | Method suggestions appear; balance reduces; invoice shows partly paid |
| B3.7 | Record the rest | Invoice moves to Paid; dashboard pending falls |
| B3.8 | Quotation → convert to invoice | Lines carried over; own QUO number series |
| B3.9 | Credit note against an issued invoice | Reduces balance; appears in client statement |
| B3.10 | Client statement | Charges, payments, credit and ageing correct; PDF downloads |
| B3.11 | Share & send | Share link created and opens read-only in a new tab (not emailed) |

### B4. Purchases flow (sample mode)

| ID | Steps | Expected |
|----|-------|----------|
| B4.1 | Bills to pay → + New bill from a vendor | Saved, issued; shows as due |
| B4.2 | Pay the bill (bank transfer) | Balance cleared; vendor statement shows bill and payment |
| B4.3 | Expenses → add, then Add to books | Posted; appears in Books |
| B4.4 | Purchase order and delivery challan | Own number series (PO-, DC-) |

### B5. Money, books, tax (sample mode)

| ID | Steps | Expected |
|----|-------|----------|
| B5.1 | Books | Trial balance balances; P&L and balance sheet show sample activity |
| B5.2 | General ledger for Accounts receivable | Running balance matches Money to collect |
| B5.3 | Advances & unapplied cash | Record an advance, apply it to an invoice |
| B5.4 | Bank matching | Upload a small CSV (made by the tester), match one line |
| B5.5 | GST returns | GSTR-1 / 3B figures match sample invoices and bills; HSN summary present |
| B5.6 | TDS | Deduction on a vendor bill reduces net payable |
| B5.7 | Stock & valuation, Sales orders, Leads pipeline | Pages load; one action each succeeds |
| B5.8 | e-Invoice / e-Way Bill | Practice IRN generated, clearly labelled as practice |
| B5.9 | Reminders & payment links | Settings save in sample mode; nothing is emailed |
| B5.10 | Activity log | Shows the tester's sample actions, newest first |

### B6. Cross-checks

| ID | Steps | Expected |
|----|-------|----------|
| B6.1 | After all of B3–B5, switch to real records | Real totals and invoice counter (next P1-000010) unchanged |
| B6.2 | Mobile 390 px on dashboard, editor, Money to collect | Usable; no sideways scroll |
| B6.3 | Console and network over the whole session | No uncaught errors; no unexpected 4xx/5xx |

## Results

| ID | Result | Notes |
|----|--------|-------|
| A1 | Pass | Home loads; all links resolve |
| A2 | Pass | `/services/` and 70 tool-page links load |
| A3 | Pass | Editor ready in 4.7 s; Net 15 and due date set |
| A4 | Pass | Totals, 18% GST and "Rupees Three Thousand Five Hundred Forty Only" correct |
| A5 | Pass | Net 30 / Due on receipt / Net 7 move the due date; changing the issue date moves it too |
| A6 | Fail → fixed in `4486cce` | Stayed CGST + SGST for 27… → 29… GSTINs and Maharashtra → Karnataka. Now switches to IGST and back; State fills from GSTIN. Awaiting deploy |
| A7 | Pass, 1 fix | Preview centred; 5 designs; amount in words and HSN present. PDF printed "Maharashtra, IN", then "IN" and a bare "+91": fixed in `4486cce` |
| A8 | Pass, 1 fix | All 9 types open with the right title and date. Signed-out numbers were INVO-/QUOT-/PURC-/DELI-; now INV-/QUO-/PO-/DC-/CN-/DN- like the saved series |
| A9 | Pass | Seller, buyer, item, rate, Net 30 and due date restored after reload |
| A10 | Pass | 20 workspace pages show a "Sign in" message and button; no raw errors |
| A11 | Pass | Sign-in dialog renders with Create account and Forgot password (not submitted) |
| A12 | Pass, 1 fix | Guide opens with steps and "Show me with sample data". Signed out, it sent visitors to sign in without returning them to the page: fixed |
| A13 | Pass, 1 fix | No sideways scroll on 8 pages at 390 px; menu opens. Document status box stuck out 9 px: fixed |
| A14 | Pass, 1 fix | Share and pay links show friendly messages. Unknown pages showed the framework's black 404: branded page added |
| A15 | Pass | 7 APIs return 401 with a plain "Sign in" message and no data |
| — | Deployed | Fixes above deployed to production; GST switch re-checked live (27→29 IGST, 27→27 CGST + SGST, State filled) |
| B1 | Pass, 2 notes | Signed in (two businesses both named "h", next invoice 1). Dashboard, Getting started, Settings, Clients, Vendors, Money to collect, Bills to pay and Books load without errors. Dashboard takes ~6 s. The guide on `/dashboard` showed generic steps: fixed in the next commit |
| B2.1 | Pass | Help & demo → Show me with sample data: progress messages, lands on dashboard with the yellow bar in ~30 s |
| B2.2 | Pass | Revenue ₹12,600, pending ₹45,488, overdue ₹30,620, expenses ₹35,000; chart has bars and month names; SAMPLE-INV-001…004 and SAMPLE-QUO-001 listed. "Due before 2026-11-07": reworded |
| B3.6 | Pass, 1 note | ₹5,000 UPI on SAMPLE-INV-004: method suggestions shown, balance 14,868 → 9,868, receipt PDF offered. The payment dialog still uses jargon ("direct receipt capacity", "cash allocations/releases") |
| B3.7 | Pass | Remaining ₹9,868 by bank transfer: balance 0; sample pending 45,488 → 30,620 |
| B6.1 | Pass | Real records after sample writes: 0 documents, totals ₹0, invoice counter still 1 |
| B3.1 | Fail → fixed in `335b728` | Client saved with GSTIN "27BAD". Server now rejects bad client/vendor GSTINs with a plain message |
| B3.2 | Pass | Bad HSN "12ab" rejected ("HSN/SAC must contain 4, 6 or 8 digits"); item saved with HSN 9983, 18%. GST rate is a fixed list, so >100 can't be entered |
| B3.3 | Pass, 2 fixes | Saved client fills name, GSTIN and State; saved item fills HSN, GST, rate. Pickers opened top-left: centred. Signed-in intro said "Sign in to save": fixed |
| B3.4 | Pass | Saved as INV-000001 in the sample series; "Ten Thousand Rupees Only" |
| B3.5 | Fail → fixed in `335b728` | Issue worked on the server, but the editor then showed "Lock this older invoice" and a draft message; drafts said "saved before issuing was tracked"; jargon confirmation. All fixed and re-tested locally |
| B3.8 | Fail → fixed | Guide promised "convert it to an invoice" but there was no button. Added Convert to invoice on saved quotations and proformas; tested locally (lines, client, own number, Net 15, survives reload) |
| B3.9 | Pass | CN-000001 (₹2,500, reason "One hour not delivered") issued against INV-000001; reason box now an empty field with a hint instead of pre-filled text |
| B3.10 | Pass | Cedar & Co. statement: opening 0, charges 27,920, credits & payments 7,500, closing 20,420; CN-000001 listed; ageing matches. PDF not downloaded (needs permission) |
| B1.5 | Fail → fixed | Paid invoices showed "Issued". The list now shows Paid, Partly paid, and Overdue with days, using the Money to collect balances |
| B3.6 | Note → fixed | Payment dialog jargon rewritten: "Still to collect", "you can record up to …" |
| — | Wording | "Demo records/workspace/data" renamed to "Sample data" on 30 pages; 20 workspace pages had their own header links ("Canonical items and stock", "Legacy item catalog"), now one shared header |
| B4.1 | Pass, 1 fix | Bills to pay: 2 sample bills, total due ₹47,024. Amounts were shown as "INR 47024.00" with jargon ("cash allocations/releases", "manual AP journals"): reformatted to ₹47,024.00, labels Paid / Partly paid / Overdue, notice rewritten. New bill not created |
| B4.2 | Pass | SWL-2290 paid in full by bank transfer: balance 5,664 → 0, total due 47,024 → 41,360, journal posted |
| B5.1 | Fail → fixed | Trial balance balances (₹1,02,024 each side), but sample sales were missing from Books: the sample seed never turned on invoice posting. Seed now does; posting setup and "Add to my books" re-tested live in sample mode: AR 17,700 = sales 15,000 + GST 2,700, still balanced |
| B5.3 | Pass, 2 fixes | Advances needed a manual setup (two accounts and cash setup) and asked for a pasted party ID. Setup done live in sample mode; ₹5,000 UPI advance from Cedar applied to INV-000001 (7,500 → 2,500). Party is now a name dropdown; sample seed sets advances up; messages in plain words |
| B5.5 | Fail → fixed | GST returns opened on real records while the Sample data bar showed (GSTR-2B too): now follows sample mode. GSTR-1 correctly excludes all invoices because the business has no GSTIN; issue codes removed and the GSTIN issue links to Settings |
| B5.8 | Pass, 1 fix | Practice IRN validation runs and refuses (no GSTIN/PIN/address), labelled simulated. Field names like "SellerDtls.Pin" now read "Your business – PIN code" |
| B5.9 | Pass, 1 note | Payment link for INV-000001 created in sample mode; link page shows ₹2,500 due and "Pay now (simulated)" (not clicked). Reminder settings say they apply to real records, so they were not saved. Pay page date and amount now formatted as 22 Nov 2026 / ₹2,500.00 |
| B5.10 | Pass | Activity log lists the sample actions newest first (entries read like "ledger cash · allocate") |
| B5.2, B5.4, B5.6, B5.7 | Pass (load only) | General ledger, Bank matching, TDS, Stock, Sales orders and Leads load in sample mode with no script errors or failed requests; status lines on TDS, Stock, Orders and Leads reworded. No CSV upload, TDS entry or stock movement was made |
| — | Fix | Opening a saved issued invoice showed "Issue (make final)" for ~10 s while it loaded; buttons now stay hidden until loaded |
| B6.3 | Pass | No console errors on dashboard, Money to collect and editor; page sweep found no 4xx/5xx |
| B3.11, B4.3, B4.4, B6.2 | Not run | Share link, expense posting, PO/DC numbering live (PO/DC series covered by the database test), signed-in mobile |
