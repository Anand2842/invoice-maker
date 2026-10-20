# Public invoice generator source fidelity

The local `/free-online-invoice-generator/` recreates the observed guest-facing page at https://www.refrens.com/free-online-invoice-generator. It preserves the source HTML, module styles, typography, images, copy, form layout, and public modal designs, with local controllers replacing source application scripts. It is a reconstruction of the public interface, not a copy of Refrens's authenticated service.

## Evidence and visual validation

The source was inspected at desktop 1440 px and mobile 390 px, before and after **Create Your First Invoice**. The initial viewport is pixel-identical at both sizes. Opened source and local forms measure 958 × 1896 px on desktop and 356 × 3217 px on mobile; visible field positions and dimensions match within 0.1 px. Mean RGB difference of the canonical form captures is 0.124/255 desktop and 0.212/255 mobile. The source's small input variant changes at 568/569 px, which the local implementation preserves when opening, restoring a draft, and resizing.

The complete lower public page was captured after repeated scrolling until lazy layout stabilized. Source and local settled full-page heights are 17008 px desktop and 27692 px mobile. Directly viewed lower sections have matching content and geometry. The source uses `content-visibility: auto`; comparing arbitrary offscreen cached heights without revealing those sections produces misleading differences.

Reference captures and geometry reports are under `artifacts/source/` and `artifacts/qa-fidelity/`. Particularly useful reports are `invoice-final-checks.json`, `invoice-extras-checks.json`, `invoice-new-states.json`, and the final fidelity reports. Canonical source form templates, source CSS, and localized image/font assets are in `dist/free-online-invoice-generator/`.

The raw server-rendered styled CSS is retained in `server-source.css`. CSSOM serialization loses authored shorthands containing unresolved custom properties; retaining the authored server stylesheet and a few narrowly scoped observed border repairs avoids those losses. Extra captured source CSS precedes the page's module styles to preserve source cascade precedence.

## Public behavior implemented locally

The guest editor supports billing/client fields, source country/state/currency selectors, source creatable item-name selection, adding/duplicating/removing items, quantities/rates/GST, item discounts, totals and amount in words. Source optional layouts include shipping addresses and transport selectors, custom header fields, notes, description, terms, contact details, additional information, attachments, signature upload and drawing, due date, and the calendar's month/year controls. Configure Tax, Configure Additional Cess, columns/formulas, custom-field, signature, and signup dialogs use captured source markup and styling.

Invoice values and optional sections are stored in a browser-local draft. Draft restoration sanitizes stored markup, rejects malformed form structures, strips transient menus/listener markers, and rebinds controls. Only invoice form data is saved. Signup credentials are outside the draft and are never stored or submitted by the local app. A storage failure is reported rather than silently claiming persistence.

## Authentication boundary and limitations

The observed source **Save & Continue** flow opens **Signup on Refrens**. The local page reproduces that public modal, then sends registration and Google actions to the official https://www.refrens.com/register destination and login actions to https://www.refrens.com/login. It does not pretend to create a Refrens account. No source invoice/account POST requests are replayed.

Authenticated Design, Share, account invoice storage, real payment collection, delivery, and final document export were not inspected and are not implemented. The local guest editor does not evaluate arbitrary custom column formulas or reproduce a protected item catalog/backend. The captured additional-cess configuration is retained locally; an unobserved complete cess calculation workflow is not claimed. Advanced rich-editor link/table popovers and transport fields beyond the captured public states are outside this verified reconstruction.

## Functional checks

Automated checks exercise calculator totals (2 × 100 + 3 × 50 with 18% GST = 413.00; a 10% item discount gives 371.70), item operations, currency choices, tax removal/restoration, source optional sections, custom fields, source dialogs, malformed draft recovery, responsive draft restoration, source signup closure, and the separation of account credentials from local drafts. Bounded component QA compares shipping, custom fields, description, calendar, and signature at both canonical widths. Browser checks report no page JavaScript errors or invoice/account mutation requests.

Final bounded component comparison: shipping and custom-field states match the saved source at both widths with no geometry/text/style differences. Calendar, description, signature panel, and signature pad match within 0.1 px; four of eight component captures have zero RGB difference and all eight have mean RGB difference at most 0.0002/255. The final combined interaction check passes source creatable item selection, calendar month/year/day selection, description editing, attachment remove/readd and file selection, signature close/readd/draw/reset/upload, restored listeners after reload, and a desktop-to-mobile restored draft with no horizontal overflow. The 14 main checks and eight combined extras checks pass with zero browser JavaScript errors.
