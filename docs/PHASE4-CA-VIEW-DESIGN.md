# Phase 4: CA view and client invites (design for approval, 8 Nov 2026)

Status: proposal. Nothing here is built. Stage A needs no database change. Stage B needs one and waits for the owner's approval.

## Goal

An accountant who looks after 3 to 50 small businesses sees all of them on one screen: what each owes, what is overdue, and what needs attention, and opens any one in a click. A client can bring their accountant in with one link.

## What already exists (verified in the code)

- One login can open several businesses; members have roles owner, admin, editor, viewer (`billing_members`, enforced by row-level security).
- Email invitations to join a business: `billing_team_invite` and `billing_team_accept` (links last seven days, single use) with an audit trail.
- The dashboard figures for one business come from `dashboardSummary` in `lib/dashboard.mjs`, read through the signed-in user's own token.

## Stage A: "All businesses" screen (no database change)

- **Who sees it:** anyone who can open two or more businesses. A menu item "All businesses" appears at the top of the sidebar for them only. Marketing calls it the CA view.
- **Where:** `/businesses/`, a new page plus `GET /api/overview`.
- **Rows:** one per business (real records only by default; a switch shows sample data separately). Columns: Business, Your role, Still to collect, Overdue (amount and number of invoices), Issued this month, Last activity, Open.
- **Top bar:** totals across businesses, kept separate per currency, and a count of businesses with overdue invoices. Search by name, filter "only with overdue", sort by any column.
- **Open:** sets the active business and goes to its dashboard. Shortcuts per row: Money to collect, GST returns.
- **Phone:** each business is a card, not a table.
- **Data:** the endpoint lists the businesses the user can reach (the existing workspace query, row-level security applies), then computes each one's summary with the same functions as the dashboard, five at a time, capped at 50 businesses. A business that fails to load shows "Could not load, try again" on its row and does not break the rest. Nothing is written.
- **Not in Stage A:** GST readiness per business (heavier; added after we see real use), bulk actions, exporting.

## Stage B: invite a client by link (needs a database change)

1. The accountant clicks "Invite a client" and gets a link `/start/?ca=<code>`, valid seven days, single use.
2. The client opens it, signs up or signs in, and fills in the business details on Getting started. The page shows, before they continue: "<Accountant name> will be able to add and edit records in this business. You stay the owner and can remove them any time in Team." They must tick it.
3. When the business is created, a database function adds the accountant as **admin** (records only; the owner alone manages team and settings) and writes an audit entry.

Database changes (propose only; owner approves):
- A table `billing_ca_invites` (accountant, hashed code, expiry, used time, business created), row-level security on, no access for anonymous users.
- Two functions: create an invite (accountant only) and redeem it (the new business's owner only; checks the code is valid, unused and unexpired; inserts the member and the audit row in one transaction).
- Both refuse tokens issued to AI connector apps (see `PHASE5-MCP-SPEC.md`, section 4).
- Tests with the existing database test helper: wrong, used and expired codes; a non-owner cannot redeem; a client cannot be added to someone else's business; revoking removes access at once; the audit entry exists.

## Decisions for the owner

1. Role given to the accountant: admin (recommended) or editor?
2. Cap of 50 businesses on the overview: fine to start?
3. Name in the menu: "All businesses" (recommended) or "CA view"?
4. Is Stage B approved to go ahead, including the migration?

## Order and size (guesses)

| Step | What | Size |
| --- | --- | --- |
| A1 | `/api/overview` with tests (several businesses, one failing, no access, caps) | 1 day |
| A2 | `/businesses/` page, phone cards, menu item, screenshots | 2 days |
| B1 | Migration and functions with database tests; owner approves before it is applied | 2 days |
| B2 | Invite screen, consent text on Getting started, audit view | 1 to 2 days |

Phase 5 also changes the central access functions. Whichever migration is written second is rebased on the first.
