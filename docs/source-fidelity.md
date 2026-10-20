# Source fidelity — 19 October 2026

The user explicitly requested matching https://www.refrens.com/ after rejecting the independently designed Folio dashboard. The current homepage therefore follows the source presentation rather than the earlier reconstruction design.

## Evidence

REA Evidence `ev_137556212100ed495787a217d74cfd8b69c4b34d6d5c605842dda056b86564f8` is a controlled Chrome scenario that opened the exact source homepage, waited 2.5 seconds, and captured the DOM, accessibility tree, URL and screenshot at 1440 × 1000. REA terminated its owned temporary browser after capture.

Public browser observations additionally captured the three source breakpoints, all eight feature states, product/country navigation, mobile navigation, FAQ expansions, AI tabs, and carousel controls. Presentation snapshots retain source CSS and locally downloaded public images/fonts. Runtime service and tracking scripts are removed; a local interaction controller operates the copied visible controls.

Observed desktop section order: navigation and hero; feature tabs; entrepreneurs/customer brands/review ratings; workflow tools; video; tailored solutions; AI; FAQs; footer. Mobile has stacked feature cards and its own observed section order.

Observed fonts: Playfair Display for headings, Satoshi for general copy and controls, Inter Display for the hero subtitle. Hero heading is 56 px desktop and 24 px at 390 px mobile, with source color #3c136b.

## Service boundary

Public visual and local UI behavior can be reproduced from these observations. Authenticated Refrens screens, account creation, payment processing, protected data and server behavior were not available as source code or verified as a user session. Official external destinations are preserved for those actions. The public invoice flow reaches an account gate before Design & Share; no unseen authenticated preview has been invented.

## Preservation

The hosted project ID and private access are unchanged. Old Folio source is archived in `legacy-folio/`; its existing browser records remain untouched. The source-matching homepage does not load the old dashboard CSS or JavaScript.

## Verification

Verification findings are appended after desktop/mobile comparisons and interaction checks. Prior Folio validation in `docs/validation.md` records the earlier interface and should not be treated as source-fidelity evidence.

### Final visual comparison

Fresh settled homepage measurements at 1440, 1024 and 390 px match the source's section, image and heading geometry within 0.1 px. Desktop full-page height is 7473 px in both source and local version. The decorative SVG curves and the AI image's responsive intrinsic sizing were corrected. On the desktop comparison, several 500 px screenshot bands compare pixel for pixel; most measured bands have mean RGB differences below 0.14 on a 0–255 scale. Remaining differences come from moving carousel/star animation phase and rasterization.

The screenshots/metrics used for this review are development artifacts under `artifacts/qa-fidelity/` (not deployed). The current site intentionally follows the source presentation rather than loading `legacy-folio/`.

### Interaction verification — 20 October 2026

All eight homepage feature tabs, four FAQ expansions, product/country menus, mobile submenus, AI radio tabs, both carousels and pagination controls passed browser checks with zero JavaScript errors. The invoice-generator links in desktop Products and the mobile menu resolve to this project's local generator.

The customer-logo ticker follows the measured source Web Animations timing: 3888 px over 37028.5714 ms on desktop, 1944 px over 18514.2857 ms on mobile, linear and repeating at 105 px/s. It starts/resumes in view, pauses out of view, and follows the observed source hover behavior.

The invoice landing page's corrected original server stylesheet produces pixel-identical initial viewport screenshots at 1440 and 390 px. Opened-editor and calculation checks are recorded in the invoice-specific fidelity notes after final verification.

The two hero call-to-action hover states were measured against the live source and restored using only the observed shadow and border changes. Normal/focus styling remains the same, and no additional hover movement or transition was introduced.

### Public invoice landing page and editor — final comparison

At 1440 × 1000 and 390 × 1000, the initial invoice-generator viewport is pixel-identical to the live source: mean RGB difference is zero. After **Create Your First Invoice**, every measured visible field matches the source's x/y/width/height within 0.1 px. Cropped editor screenshots are 958 × 1896 px on desktop and 356 × 3217 px on mobile in both versions, with mean RGB differences of approximately 0.124 and 0.212 respectively on a 0–255 scale. These small raster differences do not change the measured layout.

The source selects its 32 px business-field variant through 568 px and its 38 px variant from 569 px; both boundary widths were observed directly. The implementation uses the corresponding source class combinations instead of enlarging the source's mobile fields. Source outlines and logo borders are restored at 1 px. Hidden desktop-positioned tooltip snapshots no longer create mobile horizontal overflow. The checked page widths remain exactly 1440 and 390 px, with no JavaScript errors or visible broken images.

The complete lower invoice page also passes the controlled comparison. With fonts and images decoded and offscreen layout normalized temporarily in both test browsers, source and local document heights are exactly **17008 px at 1440 px** and **27692 px at 390 px**. All 18 lower headings and all 13 lower images match their source geometry within 0.1 px at both widths. The normalized visible text of all 12 measured lower heading sections is identical.

The rich guide was checked separately in its actual viewport: its source/local rectangle is x=0, y=6836.109375, width=1440, height=2881.8125; normalized visible text is identical at 3920 characters. Its image renders at 590 × 877.75 px in both versions from an image with intrinsic dimensions 1140 × 1696. No visible guide prose or embedded media was missing.

#### Source browser cache behavior

The source uses `content-visibility: auto` on several large sections. Browser estimates and cached offscreen sizes can make a single full-page screenshot contain blank sections or make document height grow during scrolling. Earlier height-only comparisons therefore overstated a lower-page discrepancy. Direct viewport inspection showed matching content; the final whole-page check temporarily set `content-visibility: visible` in **both owned test browsers**, scrolled the complete documents, and waited for image decoding. This was a test-only normalization; it did not change the deployed source stylesheet.

Evidence is retained in `artifacts/qa-fidelity/invoice-metrics-verified.json`, `invoice-normalized-lower.json`, `invoice-guide-probe.json`, and their associated screenshots. The final normalized comparison used the user's `Asia/Kolkata` timezone in both browsers. These findings establish fidelity for the observed public landing page, editor, and lower content; they do not establish unseen authenticated Refrens behavior.

### Native public invoice controls

The source and local Products and India menu contents match. The mobile hamburger, product submenu, and native FAQ checkbox controls work. Desktop menus follow the observed exclusive and click-away behavior: clicking outside closes the open menu, and opening India closes Products. The local behavior is provided by `invoice-public.js` and was checked against the source. Existing copied homepage and invoice-generator anchor links resolve to this project's local pages.

### Source-backed optional editor states

The newly integrated description editor, date calendar, signature upload panel, and signature pad passed source/local comparisons at both 1440 and 390 px. Their component and child-control geometry matches within 0.1 px, with no JavaScript errors or horizontal overflow. Component PNG differences are zero or at most 0.0002 per RGB channel on a 0–255 scale.

The calendar retains the source's ancestor-scoped stylesheet and renders at exactly 314 × 350 px at the source position in both viewports. The description editor no longer preserves an accidentally captured Bold hover tooltip. The signature pad uses the source's integer canvas sizing: 568 × 319 px on desktop and 319 × 179 px on mobile, with modal sizes 600 × 527 and 351 × 387 px respectively.

Independent shipping and custom-field verification also passed at both widths against the captured source states. Both shipping wrapper sections retain their observed order; the custom-field selector, dialog, and created row match the source's boxes, text, and styles. Add/remove, shipping toggle, and draft reload checks passed with zero JavaScript errors. Evidence is retained in `artifacts/qa-fidelity/invoice-new-states.json`, `shipping-custom-final.json`, and paired component screenshots.
