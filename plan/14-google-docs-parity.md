# Google Docs Parity — Feature-by-Feature Design Decisions

The evaluator's mental model for "collaborative document editor" **is Google
Docs**. This document walks Google Docs' signature behaviors and pins down
exactly how each is implemented (or consciously descoped) — so the built
product *feels* like the real thing, not a tech demo.

## 1. Per-User Undo/Redo (critical, easy to get wrong)

In Google Docs, Ctrl+Z undoes **your** last edit — never a collaborator's.
A naive undo on a shared CRDT would revert whatever operation happened last
globally, including someone else's typing. 

**Decision:** use `Y.UndoManager` with `trackedOrigins` set to this
client's local origin object only:

```ts
const undoManager = new Y.UndoManager(yXmlFragment, {
  trackedOrigins: new Set([localOrigin]),   // only OUR transactions
  captureTimeout: 500,                       // groups a typing burst into one undo step
});
```

Every local transaction is tagged `doc.transact(fn, localOrigin)`; remote
updates arrive with a different origin and are therefore invisible to undo.
Restore operations and AI insertions get their own origins (`restoreOrigin`,
`aiOrigin`) — AI insertions ARE tracked (user should be able to Ctrl+Z an AI
suggestion), restore is NOT (undo of a restore is done by restoring again
via history, keeping one clear mental model).
Keyboard: Ctrl/Cmd+Z, Ctrl+Y / Cmd+Shift+Z.

## 2. Named Live Cursors & Selections

Each collaborator sees others' cursors with a name flag and colored
selection highlight (like Google Docs).

- Transport: Yjs Awareness protocol (already in the stack), rendered by
  `y-prosemirror`'s cursor plugin.
- Awareness state shape (normative):
  `{ user: { id, name, color, image }, cursor: <y-prosemirror managed> }`.
- **Color assignment:** deterministic — `palette[hash(userId) % 8]` from a
  fixed 8-color WCAG-checked palette, so a given user is the *same color in
  every session and for every viewer* (Google Docs behaves this way per
  session; we improve on it with stability). Palette chosen so all colors
  are distinguishable against both light and dark editor backgrounds.
- Cursor name flag appears on cursor movement, fades after 2s idle
  (matching Docs), reappears on hover.
- Own cursor never rendered via awareness (only remote ones).

## 3. "Saved" Status & Title Editing In Place

- Google Docs shows "Saving…"/"All changes saved in Drive" — our equivalent
  is the connection badge ([07-ui-ux.md](07-ui-ux.md)) with the honest
  local-first wording: offline still means *saved* (on device), and the UI
  says so — this is a feature Google Docs itself communicates poorly, and
  we call that out in the README/demo as a deliberate improvement.
- **Title lives inside the Y.Doc** (`Y.Map('meta').get('title')`), not only
  in Postgres — so renaming works offline and syncs/merges like content.
  The collab server mirrors title changes into `documents.title` (debounced
  500ms) on update-persist, purely so the dashboard/list query stays a
  cheap SQL read. Conflict on title = CRDT last-writer-wins at the Y.Map
  key level, which is the correct semantic for a single scalar field.
- Title is an inline-editable `<input>` in the top bar (not a modal),
  Enter/blur commits, Escape reverts — exactly the Docs interaction.

## 4. Document Dashboard (home screen)

Google Docs' home: recent documents grid/list, owned vs shared filter,
search, "+ New" button.

- Route `/documents` (the post-login landing page).
- List view: title, "Owned by me / <owner name>", last-edited relative
  time, role badge (Owner/Editor/Viewer chip), member-count avatar stack.
- Tabs: **Recent** (default, `updatedAt desc`) · **Owned by me** · **Shared
  with me**. Client-side text filter on title for the assignment scope
  (server-side full-text search noted as future work in
  [11-scalability-tradeoffs.md](11-scalability-tradeoffs.md)).
- "+ New document" creates and immediately navigates into the editor with
  the title selected for typing (Docs behavior).
- Offline behavior: dashboard renders from the `document-meta` IndexedDB
  cache when offline (stale-while-revalidate), so even the home screen is
  local-first; docs never opened on this device are listed but greyed with
  a "not available offline" tooltip.

## 5. Share Dialog & Link Sharing

Google Docs' most-used collaboration surface. Two mechanisms, both built:

1. **Direct invites** — email + role picker (Editor/Viewer), pending-invite
   flow for not-yet-registered emails (contract in
   [13-api-contracts.md](13-api-contracts.md)).
2. **Link sharing** — `documents.share_mode`:
   - `private` (default): members only.
   - `link-view`: anyone signed-in with the link gets Viewer access.
   - `link-edit`: anyone signed-in with the link gets Editor access.
   
   Design decisions:
   - Link-based access still **requires sign-in** (no anonymous editing) —
     keeps every update attributable to a real `author_id`, which the
     version history and audit trail depend on. Anonymous "chicken avatar"
     access is explicitly descoped and documented as such.
   - First open via link auto-inserts a `document_members` row with the
     link's role (so RLS keeps working unchanged — link sharing is sugar
     over membership, not a parallel auth path; one enforcement model, not
     two).
   - Downgrading `share_mode` back to `private` removes link-acquired
     memberships (tracked via `granted_via = 'link'` column) but keeps
     directly-invited ones.
   - Share dialog UI: modal with copy-link row on top (mode dropdown à la
     "Anyone with the link ▾"), people list below with per-person role
     dropdowns — deliberately mirroring Docs' layout for instant
     familiarity.

## 6. Comments (stretch, designed now so the data model doesn't fight it)

Anchored margin comments are Docs' second signature feature. Scoped as
**stretch** (build after Phase 7 if time allows), but the design is fixed
now:

- Anchoring: store a serialized **`Y.RelativePosition`** pair
  (anchor/head), NOT absolute offsets — relative positions survive
  concurrent edits and document growth, resolving to the "same logical
  spot" at render time. This is the one technically-correct way to anchor
  annotations on a CRDT document; absolute positions would drift on every
  concurrent edit.
- Storage: `comments` table in Postgres (see
  [02-data-model.md](02-data-model.md)); comments are metadata, not
  document content, so they do NOT live in the Y.Doc (keeps doc size
  bounded and lets comment permissions differ from edit permissions —
  Viewers can comment in Docs; we match that).
- Sync: comments piggyback on the WS control channel as JSON messages
  (`{t:'comment', ...}`), with plain REST CRUD underneath; offline-created
  comments queue through the same outbox mechanism with a `kind` field.
- Threading: one level (comment + replies), resolve/reopen state.

## 7. Editor Feature Set (toolbar scope, pinned)

In scope (all supported natively by Tiptap StarterKit + a few extensions):
**bold, italic, underline, strikethrough, inline code; H1–H3; bulleted /
numbered / task lists; blockquote; code block; horizontal rule; links
(auto-link on paste + Ctrl+K dialog); text align; highlight color;
placeholder text ("Type @ or / for commands…")**; slash-command menu
(`/heading`, `/list`, `/ai`, …) via Tiptap's suggestion utility — the
modern-Docs-like insert menu.

Explicitly descoped (documented, not silently missing): images/file
embeds (needs upload infra + size policy — noted as future work), tables
(Tiptap supports them; cut-line item, add in Phase 7 if ahead of
schedule), footnotes, page-layout/pagination (Docs' print model — out of
scope for a web-first editor), suggestion/"suggesting" mode (real Docs
feature; noted in README as the natural next step on top of our CRDT
origins mechanism, since tracked origins per-user is exactly the primitive
it needs).

Keyboard shortcuts match Docs where they exist: Ctrl+B/I/U, Ctrl+K link,
Ctrl+Alt+1..3 headings, Ctrl+Shift+7/8 lists, Ctrl+Z/Y undo/redo.

## 8. Word Count & Document Stats

Small but expected: footer-left shows word/character count (computed from
the Y.Doc text projection, recomputed on a 300ms debounce — never per
keystroke). Clicking toggles reading-time estimate. Trivial to build, high
"feels finished" value.

## 9. What We Deliberately Do Better Than Google Docs (demo talking points)

- **True offline**: Docs offline requires a Chrome extension and pre-marking
  docs; ours is offline-by-default for every doc you've opened, in any
  modern browser.
- **Honest sync status**: explicit outbox/"saved on this device" semantics
  vs Docs' opaque spinner.
- **Transparent history**: our version timeline shows *auto* checkpoints
  with AI-generated labels and byte-exact restore, and restores are
  themselves versioned (Docs' "version history" is coarser and restore is
  destructive-feeling).
- These three points go in the README and the demo video script — they are
  the "showcase your intellect / beyond CRUD" narrative the assignment asks
  for, framed as product decisions rather than tech trivia.
