# Phase 5 implementation notes

## Verified platform requirements (8 November 2026)

- Target resource: `https://inbill.live/mcp` (owner confirmed). This is the resource URL, not automatically the OAuth issuer.
- [Current MCP transport](https://modelcontextprotocol.io/specification/latest/basic/transports) and [authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization) are revision 2026-07-28. OAuth-protected resources publish RFC 9728 discovery and validate the resource audience. Client metadata documents are preferred; older clients may need registration compatibility.
- [Official SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html) provides `createMcpHandler` for Web Request/Response runtimes. Installed `@modelcontextprotocol/server` **2.4.0**, pinned in the lockfile; the spec's older package name is superseded. Stateless legacy compatibility accepts 2025 clients without a stored session. Existing Zod 3.25's `zod/v4` works through the SDK's documented JSON-schema fallback; it logs an upgrade advisory.
- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) need a publicly reachable endpoint, including when using Claude Desktop. A localhost test is not a Claude connection test.
- [OpenAI authentication](https://developers.openai.com/plugins/build/auth) requires OAuth discovery/challenges for protected tools. [Submission](https://developers.openai.com/plugins/deploy/submission) involves a public HTTPS service, ownership and review. No submission or approval is implied by a working local endpoint.
- [Supabase setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started) says its OAuth server is beta and available on all plans. On 8 Nov, a **credential-free** GET to this project's public discovery URL returned HTTP 404, `feature_disabled`, `OAuth server is disabled`. No keys, user session or database were used.
- **Auth design constraint:** [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows) says custom scopes are unsupported. Its access tokens otherwise carry normal user permissions plus `client_id`; standard scopes control identity data. Therefore the spec's `inbill.read` / `inbill.draft` cannot simply be requested as Supabase OAuth scopes. [Token security](https://supabase.com/docs/guides/auth/oauth-server/token-security) requires client-aware RLS. An application-only check would leave direct database access exposed.

## Implemented so far — public runtime spike only

Isolated branch `phase5-mcp-server`, based on `origin/main` at `b07e66f`. Existing staged changes in the owner's checkout are untouched. The spec was copied from `1c72ded`.

- Thin `/mcp` route, official stateless handler, default-off `INBILL_MCP_ENABLED` switch.
- `find_hsn_code`, `check_gstin`, `calculate_gst`, strict schemas, bounded inputs, no database access. Every tool accepts `sample` default false; public calculations have no saved-record context.
- Existing HSN search, GSTIN validation and exclusive GST calculator reused. Inclusive calculation uses exact integer paise, and distributes an odd split-tax paise to SGST consistently with the editor. Replace imports with Phase 4 shared tool modules when those land.
- Host/origin checks, 100 KiB body cap (including unknown-length streams), no-store responses, metadata-only tool logging.
- Per-instance 60/minute IP buckets are **only a burst backstop**. Configure a shared edge IP limit before public release; cold starts and multiple instances otherwise reset the limit. Only trust Vercel's [platform-supplied IP header](https://vercel.com/docs/headers/request-headers) when running on Vercel. Local callers share one bucket.
- No signed-in tools, bearer-token acceptance, OAuth endpoints, Settings controls, migrations, directory claims or production changes yet. Stage 4 payment actions remain out of scope until requested by real users.

## Auth proposal for owner review

Prefer Supabase-managed login, PKCE, token rotation and client registration instead of storing refresh tokens ourselves. The built-in provider cannot meet the named OAuth-scope requirement verbatim yet. Choose before implementing signed-in access:

1. **Recommended: Supabase OAuth plus inbill permissions.** Use supported identity scopes for login. Show `Read records` and `Create/edit drafts` on inbill's consent page, and persist those permissions per user/client/business. Enforce them on every MCP call **and in restrictive database policies / security-definer commands**, including revocation. Do not advertise unsupported `inbill.*` OAuth scopes. This changes section 4's wire-level scope contract, while retaining the same user permissions.
2. If exact OAuth scopes are required, propose a scoped authorization gateway on `inbill.live` before building. It must issue resource-bound tokens, safely map to user Supabase sessions, handle PKCE/refresh/revocation and maintain restrictions even outside MCP. This is a materially larger security surface; do not quietly implement it as an SDK adapter.

For either option, proposed schema work includes per-business opt-in (off), user/client/business permission grants with immediate revocation, shared rate counters, and atomic idempotent draft commands with audit attribution. RPCs must enforce role, business existence, sample mode, consent and current draft version inside the transaction. Ordinary browser RLS must remain unchanged. A consent check in JavaScript alone is insufficient.

The existing `identity(req)` is cookie-only, contrary to the original spec. Do not change it to accept OAuth bearer tokens globally: that would expose website operations outside the connector's allowed tool set. A separate verified connector identity path is needed. Audience handling and Supabase token-hook behavior must be proven before accepting tokens.

## Local setup and validation

No production secrets are needed for public tools. Use an ignored `.env.local` in this worktree:

```dotenv
INBILL_MCP_ENABLED=true
INBILL_MCP_ORIGIN=http://127.0.0.1:5175
```

Start with `npm run dev -- --port 5175`. This app's worker runtime does not inherit these settings just because they are supplied as shell environment variables. Production stays off unless explicitly configured. Preview must use its exact HTTPS origin; never derive the allowed origin from the incoming Host header.

Automated checks: `node --test tests/mcp.test.mjs`, `npm test`, `npm run check`, `node scripts/build-vercel.mjs`. Protocol tests cover initialization, tool discovery/calls, malformed JSON, oversized buffered/streamed bodies, unknown tools, strict inputs, kill switch, origin and rate-limit behavior; money tests cover inclusive/exclusive, interstate/intrastate, zero, maximum and odd-paise rounding. A hostile instruction string produces no actions or database calls.

Vercel packaging passed locally. This is **not** a deployed preview test. Full regression and local HTTP results are recorded below once complete.

## Release / manual checklist — not yet completed

- [ ] Resolve Supabase scope design with owner; enable/configure provider without sharing keys.
- [ ] Implement and test consent, revocation, audience and client restrictions, scoped read tools and draft commands, and proposed migration files.
- [ ] Apply migrations only after explicit owner approval (spec sections 2.4 and 9).
- [ ] Rebase and add Settings controls separately after coordinating with Phases 1–4.
- [ ] Configure shared rate limiting; test kill switch and default-off businesses.
- [ ] Owner-approved Vercel preview deployment; test `/mcp` from outside the local machine.
- [ ] Connect Claude and ChatGPT; one prompt per tool and sample/real separation.
- [ ] Outsider/viewer/deleted-business, expired/revoked/malformed token, wrong audience/scope, stale version and retry-key tests.
- [ ] Revoke consent and verify immediate denial, including direct database/RPC access with the old token.
- [ ] Prompt-injection record fixture cannot alter tool behavior.
- [ ] Publish setup/listing materials only when Stage 2 works. Submissions require separate approval.
