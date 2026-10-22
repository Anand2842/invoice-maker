# Independent billing workspace

A Refrens-inspired application backed by the owner's Supabase project. The captured public layout is retained; business data, authentication, document generation and workspace routes are implemented independently. This is **not yet a complete Refrens replica**. See [implementation status](docs/IMPLEMENTATION-STATUS.md) and the [six-phase roadmap](docs/IMPLEMENTATION-ROADMAP.md).

## Run

Node 22.13 or later, `npm ci`, then `npm run dev -- --port 4173`. Open `/dashboard/` for the signed-in workspace, `/settings/` for the business profile, `/services/` for all services and `/free-online-invoice-generator/?document=invoice` for guest PDF creation.

`npm test` checks document arithmetic, PDF structure, validation, dashboard aggregation and workflow behavior. `npm run check` checks application JavaScript syntax. The Sites build helper produces the deployable Worker bundle.

## Supabase

Migrations are in `supabase/migrations/`. The project-specific URL and publishable key are in `lib/supabase.ts`; no service-role or database password is part of the runtime. User sessions are in HttpOnly cookies. Access rules live in Supabase RLS and private Storage policies. Migration and smoke scripts accept privileged test configuration via hidden stdin, never command-line flags or tracked environment files.

`202610200001` creates the billing foundation; `002` fixes INSERT-returning visibility; `003` implements transactional conversions; `202610210001` adds profiles and atomic numbering/duplication; `202610210002` hardens workflow checks and immutable IDs. Apply migrations in order to a fresh project. Do not reapply migrations that already ran.

## Publication

The existing Sites project identity is retained in `.openai/hosting.json`. Source/public assets are under `public/`, server routes under `app/api/`, and the dashboard uses the framework's React/Recharts client. `dist/` is generated build output and ignored. The existing owner-private audience is preserved.
