# Refrens public website recreation

The current site reproduces the public reference at https://www.refrens.com/ and its public invoice generator. The original Folio interface is archived in `legacy-folio/` and is no longer served as the homepage.

## Run

```sh
npm run dev
```

Open http://127.0.0.1:4173. The complete deployable presentation is in `dist/`; it has no build step or application package dependencies.

```sh
npm run check
npm test
```

The calculation/persistence unit suite remains for the retained billing data module. Browser fidelity and interaction checks are recorded separately in `docs/source-fidelity.md` and `docs/invoice-fidelity.md`.

## Presentation and interactions

- Source logo, exact public copy, original imagery, Playfair/Satoshi/Inter fonts, purple styling, spacing and section order.
- Separate captured desktop, tablet and mobile layouts preserve the source's real responsive variants.
- Product/country menus, mobile navigation, feature and AI tabs, FAQ panels, carousels and video controls.
- Public invoice-generator presentation and its editable fields/calculations, recreated against the observed source.
- Presentation assets are served from this project. Original application, analytics and tracking scripts are excluded.

Source destinations outside the reproduced pages retain their official Refrens URLs. Login, registration, demo booking, payment services and authenticated design/share are services on the source website. This project does not provide or impersonate those server-side services. It does not collect account passwords.

The existing site project and private audience are preserved. The previous Folio browser data is not cleared or migrated by this presentation change.

Investigation evidence and exact verification boundaries are recorded in `docs/source-fidelity.md`.
