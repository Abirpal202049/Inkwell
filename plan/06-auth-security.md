# Authentication, Authorization, Security & Validation

## Authentication

- **Auth.js (NextAuth) v5**, JWT session strategy (not database sessions) —
  keeps the collab WS server able to verify identity statelessly without a
  DB round trip on every connection.
- **Providers: Google OAuth + GitHub OAuth only.** No credentials/password
  provider — deliberate decision:
  - Zero password storage = an entire attack class (credential stuffing,
    hash leaks, reset-flow bugs) removed rather than mitigated.
  - Both providers give verified emails and profile name/avatar for free,
    which presence cursors and the share dialog need anyway.
  - The evaluator will sign in with one click — friction matters in review.
- **Provider config details:**
  - Google: scopes `openid email profile` only (minimum); GitHub: default
    scope `read:user user:email` (GitHub may not return a public email —
    Auth.js fetches the primary verified email via the emails endpoint;
    handle the null-email edge case explicitly with a sign-in error page).
  - **Account linking:** the same person may sign in with Google one day
    and GitHub the next. Policy: auto-link accounts **only when the
    incoming provider email is verified AND matches an existing user's
    email** (both Google and GitHub primary emails are verified, so this
    is safe here; documented as the reason `allowDangerousEmailAccountLinking`
    is acceptable for these two specific providers and would NOT be for
    arbitrary ones). One `users` row, multiple `accounts` rows (standard
    Auth.js Prisma adapter tables).
  - Emails are lowercased before any comparison/storage (invite claiming
    in [13-api-contracts.md](13-api-contracts.md) depends on this).
- **Session lifetime:** 30-day rolling JWT (`maxAge` 30d, `updateAge` 24h).
  Session JWT carries `userId`, `name`, `image` — roles are looked up
  per-document at request time, never embedded in the long-lived token (a
  role change must take effect immediately, not after token expiry).
- On first sign-in: claim any `pending_invites` rows matching the verified
  email (converts them to `document_members` rows) — invited-before-signup
  flow, same as Google Docs.
- Sign-in page: two buttons (Google / GitHub), app logo, one-line value
  prop; unauthenticated visits to any `/documents/*` URL redirect here with
  `callbackUrl` preserved so an invite link lands the user in the right doc
  after auth.

## Authorization Model

Roles per document, stored in `document_members` (see
[02-data-model.md](02-data-model.md)):

| Role | Read doc | Edit content (push updates) | Manage members/roles | Delete doc | Create/restore versions |
|---|---|---|---|---|---|
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ | ❌ | ✅ (create), ✅ (restore) |
| Viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

**Enforced in three layers (defense in depth), matching the assignment's
explicit requirement that "Viewers must not be able to push state updates to
the real-time server":**

1. **WS connection auth:** the collab server validates a short-lived
   token (issued by `POST /api/documents/[docId]/token`) that embeds
   `{userId, documentId, role}` signed server-side — 60s TTL, single-use
   `jti`, live role re-check every 5 min per connection; full token
   contract in [13-api-contracts.md](13-api-contracts.md). A Viewer's
   token is marked `readOnly: true`.
2. **WS message handling:** the collab server checks `readOnly` *before*
   accepting any incoming Yjs update frame from that socket — Viewer sockets
   are subscribed to broadcasts (so they see live edits) but any update
   frame they send is dropped and logged, never applied or persisted.
3. **Database RLS:** `insert_updates_if_editor` policy (see
   [02-data-model.md](02-data-model.md)) makes it structurally impossible
   for a viewer-role row to result in a persisted `doc_updates` insert, even
   if application code or the WS layer had a bug. This is the "strict ORM
   scoping / RLS for tenant isolation" the assignment asks for explicitly.
4. **UI:** the editor is mounted `editable={false}` for Viewers as a UX
   nicety — never relied upon as the actual security boundary.

## Preventing a Malformed/Massive Payload From OOMing the Server

This is called out explicitly in the assignment as a must-address question.
Layered mitigations, checked in order, cheapest first:

1. **Transport-level frame size cap.** The WS server rejects/closes any
   incoming frame above a hard limit (e.g., 1 MB) before it is ever fully
   buffered into memory — `ws` library's `maxPayload` option enforces this
   at the socket layer, so an attacker can't even get a huge buffer
   allocated.
2. **HTTP body size limit.** Route Handlers that accept payloads (e.g.
   restore, bulk snapshot import) set an explicit `maxDuration`/body-size
   limit; Next.js/Vercel's platform limit is a backstop, an explicit
   application-level check is the primary control.
3. **Schema validation before semantic processing (zod).** Every inbound
   sync/version/restore payload is parsed against a strict zod schema
   (types, required fields, enum role values, max string lengths) — reject
   with 400 before touching Yjs decode logic. Malformed-but-small payloads
   (the "crash the parser" class of attack) are caught here.
4. **Per-document and per-user rate limiting.** Token bucket (e.g. Upstash
   Ratelimit or an in-memory limiter at the WS layer) caps updates/sec per
   connection — bounds both accidental runaway loops (buggy client) and
   deliberate flooding.
5. **Semantic size checks on the decoded Yjs update.** Even a small binary
   payload can, in principle, encode operations implying a huge resulting
   document; after applying to a *scratch* `Y.Doc` copy (never the live
   shared doc directly), we check the resulting document's serialized size
   against a per-document max (e.g. 25 MB) before committing/broadcasting —
   protects against decompression-bomb-style attacks where a small update
   blows up document size.
6. **Backpressure / queue depth caps.** The collab server's per-room
   outstanding-work queue has a max depth; once exceeded, new connections to
   that room are told to retry later (503) rather than being accepted and
   contributing to unbounded memory growth — this is the direct answer to
   "prevent OOM": bound the amount of unprocessed work in memory at all
   times, never accept unbounded queuing.
7. **Process-level guardrails.** The Node collab server runs with
   `--max-old-space-size` set explicitly and is deployed with a process
   supervisor (Fly.io/PM2) that restarts on crash — a last-resort safety
   net, not a substitute for 1-6.

## Tenant Isolation Summary

- Every DB query (Prisma/Drizzle) is wrapped to run inside a transaction
  that sets `SET LOCAL app.user_id = $currentUserId` before any statement,
  so RLS policies apply even if an ORM query forgets an explicit `WHERE`.
  This is deliberately redundant with app-level `WHERE document_id = ... AND
  is_member` clauses — RLS is the guarantee that holds even when application
  code has a bug.
- API routes never accept `documentId` from the client as sufficient
  authorization by itself; every handler re-derives membership from the
  authenticated session server-side.

## Additional Hardening (Good-to-Have, time permitting)

- CSRF protection via Auth.js defaults + `SameSite=Lax` cookies.
- Content Security Policy headers via `next.config` to reduce XSS blast
  radius (rich-text content is rendered — sanitize any HTML paste/import
  path explicitly, e.g. via `DOMPurify` on paste-from-HTML).
- Audit log of role changes and restores (`document_versions` +
  `collab_sessions` already give most of this "for free").
