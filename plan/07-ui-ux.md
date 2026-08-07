# UI/UX, Component Architecture & Accessibility

The visual/interaction model deliberately mirrors Google Docs (the
evaluator's reference point) — screen-by-screen feature decisions live in
[14-google-docs-parity.md](14-google-docs-parity.md); this doc covers the
component/state/performance/a11y architecture underneath.

## Screens

1. **`/` (marketing/landing)** — one-pager: value prop, sign-in CTA,
   required footer (name, GitHub, LinkedIn — submission requirement; footer
   is a shared layout component so it appears on every page).
2. **`/documents` (dashboard)** — Google-Docs-style home: Recent / Owned by
   me / Shared with me tabs, "+ New document", role badges, offline-capable
   via IndexedDB metadata cache (details in
   [14-google-docs-parity.md](14-google-docs-parity.md) §4).
3. **`/documents/[docId]` (editor)** — the main surface, layout below.
4. **`/documents/[docId]/history`** — version timeline + preview/diff/restore.
5. **`/signin`** — Google + GitHub buttons only.

## Editor Page Layout (Google-Docs-like)

```
┌──────────────────────────────────────────────────────────────┐
│ [logo] [Title (inline input)]  [ConnectionBadge]              │
│                    [PresenceAvatars] [Share ▾] [History] [⋮] │
├──────────────────────────────────────────────────────────────┤
│ [Toolbar: B I U S | H1 H2 H3 | lists | quote | code | link]  │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│          ┌────────────────────────────────┐                  │
│          │  page-like centered column      │  ← max-w-[820px],│
│          │  (Tiptap editor)                │    white "sheet" │
│          │                                  │    on gray bg,   │
│          └────────────────────────────────┘    like Docs      │
│                                                                │
├──────────────────────────────────────────────────────────────┤
│ [word count]                    [footer: name·GitHub·LinkedIn]│
└──────────────────────────────────────────────────────────────┘
```

## Component Architecture (React 19 + Next.js 16 App Router)

```
<DocumentPage>                          # server component: fetches metadata, role, initial auth
  <DocumentProvider>                    # client: owns Y.Doc instance + sync worker handle (Context)
    <TopBar>
      <TitleInput />                    # inline edit; writes Y.Map('meta').title (offline-safe)
      <ConnectionStatusBadge />         # reads sync-engine state machine
      <PresenceAvatars />               # Yjs Awareness -> avatar stack (+N overflow)
      <ShareDialog />                   # invites, link sharing, role management
    </TopBar>
    <Toolbar />                         # formatting actions, hidden for Viewer role
    <Editor />                          # Tiptap bound to Y.Doc via y-prosemirror
                                        # + Y.UndoManager (per-user undo, see 14 §1)
                                        # + remote cursors (named, deterministic colors)
                                        # + slash-command menu (/heading, /ai, ...)
    <VersionHistoryDrawer />            # timeline, preview, restore
    <StatusFooter />                    # word count + required personal footer
  </DocumentProvider>
</DocumentPage>
```

## State Management Strategy

- **Server state / route params:** Next.js App Router server components +
  `useSearchParams` for things like `?version=<id>` (deep-linkable version
  preview), consistent with the assignment's call-out of "Query Params" as a
  state mechanism to demonstrate.
- **Document content state:** lives in the Yjs `Y.Doc`, not React state.
  React components subscribe to Yjs via `y-prosemirror`'s bindings and
  Yjs's observer API — this avoids re-rendering the whole tree on every
  keystroke (a naive `useState<string>` for document content would be both
  wrong for CRDT semantics and a performance disaster).
- **UI/ephemeral state** (toolbar open/closed, dialog visibility, selected
  version for preview): local `useState`/`useReducer`.
- **Cross-cutting client state** (current role, connection status, presence
  list): React Context (`DocumentProvider`), updated via subscriptions to
  the sync worker's `postMessage` events — deliberately not Redux/Zustand,
  since the actual complex state (the document) already lives in Yjs and
  doesn't need a second state manager.
- **Server mutations** (create doc, rename, invite member, create/restore
  version): Next.js Server Actions where possible for progressive
  enhancement + reduced client JS.

## Connection Status Indicator (explicit evaluation criterion)

A persistent badge in the toolbar with four states, directly reflecting the
sync engine's state machine ([03-sync-engine.md](03-sync-engine.md)):

| State | Visual | Meaning to user |
|---|---|---|
| Synced | green dot, "All changes saved" | Nothing pending, matches server |
| Syncing | amber pulsing dot, "Syncing…" | Outbox actively draining |
| Offline | gray dot + slash icon, "Offline — changes saved on this device" | Reassures the user their work is safe locally |
| Sync error | red dot, "Sync issue — retrying" + manual "Retry now" button | Surfaces persistent failures (e.g. auth expired) instead of failing silently |

This is a first-class UI element, not a debug toast — it's the user-facing
proof that the local-first guarantee is real.

## Role-Aware UI

- Viewers get a "View only" pill next to the title, no toolbar, editor
  mounted `editable={false}`, and a "Request edit access" affordance is
  descoped (documented) — but they DO see live cursors and presence, which
  makes the realtime layer visible even to read-only evaluators.
- A live role downgrade (WS `{t:'role'}` message, see
  [13-api-contracts.md](13-api-contracts.md)) flips the UI to view-only
  in-place with a toast — no reload required.

## Performance: Preventing Lag During Rapid Typing (explicit criterion)

- Editor renders are driven by ProseMirror's own transaction/view diffing
  (already highly optimized), not by piping every keystroke through React
  state — this is the single biggest lever, addressed structurally by the
  architecture choice above rather than by ad hoc `useMemo`/`debounce`
  patches.
- All IndexedDB writes and outbox/network work happen in a **Web Worker**,
  never the main thread — typing latency is decoupled from persistence
  latency entirely.
- Presence/cursor updates from collaborators are throttled (~50ms) before
  triggering any repaint of remote cursors, since these can arrive at high
  frequency from multiple collaborators.
- Toolbar active-state (bold/italic/etc.) subscribes to selection changes
  via `requestAnimationFrame`-batched updates rather than on every
  transaction, avoiding toolbar re-render on every keystroke.
- Large documents: virtualize the version-history list (react-virtual) once
  it can grow to hundreds of entries.

## Accessibility

- All interactive controls (toolbar buttons, dialogs, drawer) built on
  Radix primitives (via shadcn/ui) — gives correct roles, focus trapping,
  and keyboard nav out of the box rather than reimplementing ARIA by hand.
- Editor toolbar is a proper `toolbar` role with `aria-pressed` reflecting
  active formatting state.
- Connection status changes are announced via a polite `aria-live` region
  so screen reader users learn about offline/online transitions without
  needing to visually scan a badge.
- Color is never the sole signal (status badge pairs color with icon + text
  label, per the table above).
- Full keyboard operability: version history navigable via arrow keys,
  restore/preview reachable without a mouse.
- Contrast-checked Tailwind palette (WCAG AA minimum) for both light/dark
  themes.

## Responsive Design

- Editor toolbar collapses to an overflow menu below `sm` breakpoint.
- Version history renders as a full-screen sheet on mobile instead of a
  side drawer.
- Presence avatars collapse to a count badge ("+3") on narrow viewports.
