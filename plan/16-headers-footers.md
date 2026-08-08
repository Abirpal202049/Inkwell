# 16 — Page headers & footers

Goal: Google-Docs-parity headers and footers — repeating per page, edited in
place, collaborative, offline-capable, versioned, and printable — built on the
existing decoration-based pagination (plan/07 follow-up, `pagination.ts` /
`pagination-core.ts`).

## 1. How Docs/Word actually do it (research summary)

The Google Docs data model (visible through the Docs API) is the blueprint:

- Headers/footers are **separate content segments**, not part of the body
  flow. `Document.headers` / `Document.footers` are maps keyed by generated
  IDs; each value holds full rich content (paragraphs, styling).
- `documentStyle` points at segments **by role**: `defaultHeaderId`,
  `firstPageHeaderId`, `evenPageHeaderId` (+ footer equivalents), gated by
  `useFirstPageHeaderFooter` / `useEvenPageHeaderFooter` booleans, plus
  `marginHeader` / `marginFooter` distances from the page edge.
- Every edit carries a `segmentId` routing it to the body or one specific
  header/footer. The renderer repeats the resolved segment on each page;
  clicking a header zone switches the *active editing segment* — the content
  exists once, the pages show projections of it.
- Word is the same model plus sections ("Link to Previous"). Docs added
  per-section headers later; both resolve a page's header as:
  first page → first-page segment (if enabled), else even/odd (if enabled),
  else default.

Editor-ecosystem precedents confirm the segment approach: TipTap's official
Pages product keeps headers/footers **outside the main schema** as an overlay
with a double-click edit-in-place editor that still participates in
collaboration, while community extensions that model pages/headers as real
nodes *inside* the doc fight the CRDT, undo, and remote cursors. We follow the
segment/overlay model.

## 2. Data model

### 2.1 Yjs structures (all client-driven; backend is transparent)

New top-level named `Y.XmlFragment`s on the existing doc, alongside
`CONTENT_FRAGMENT = "content"` (`frontend/lib/crdt/doc-manager.ts`):

| Fragment name | Role |
|---|---|
| `header-default` | header on all pages (unless overridden) |
| `header-first` | first-page header (when `hfDiffFirstPage`) |
| `header-even` | even-page header (when `hfDiffOddEven`) |
| `footer-default` / `footer-first` / `footer-even` | same for footers |

We deliberately use **fixed role-named fragments instead of Google's
ID-indirection maps**: we have no sections, so the indirection buys nothing,
and fixed names mean two offline clients that both "create the header"
converge onto the same CRDT type automatically (same-named fragments merge).
If sections ever land, migrate by introducing `header-<sectionId>-<role>`
names — the resolution function below is the only place that changes.

New keys in the existing `Y.Map("meta")` (same pattern as
`marginLeft`/`pageSize` in `Ruler.tsx`):

```ts
headerEnabled: boolean        // segment exists & reserves space
footerEnabled: boolean
hfDiffFirstPage: boolean      // Docs: useFirstPageHeaderFooter
hfDiffOddEven: boolean        // Docs: useEvenPageHeaderFooter
headerMargin: number          // px from top page edge, default 48 (0.5in)
footerMargin: number          // px from bottom page edge, default 48
```

Removing a header (Docs "Remove header") = `headerEnabled = false` **and**
clearing the fragments, one transaction. Disabled-but-nonempty is not a state
we keep (matches Docs: remove deletes content).

### 2.2 Segment resolution (pure function, unit-tested)

```ts
type HfRole = "default" | "first" | "even";
function resolveRole(pageIndex: number, flags: {diffFirst, diffOddEven}): HfRole
// page 0: "first" if diffFirst, else fall through
// even pages (2nd, 4th… i.e. pageIndex 1,3,… is page 2,4…): "even" if diffOddEven
// else "default"
```

Falls back to `default` when the specific fragment is empty is **not** done —
like Docs, an enabled-but-empty first-page header shows an empty band (users
rely on that to blank page 1).

### 2.3 What the backend needs

- **Nothing structural.** Fragments/meta ride the existing append-only update
  log, compaction, and y-indexeddb offline persistence untouched
  (`backend/src/persistence/doc-store.ts`). No REST changes; `PATCH` stays
  title/shareMode only.
- **One required fix:** `applyRestore` (`backend/src/realtime/rooms.ts:213`)
  currently restores only the `"content"` fragment and `meta.title`, so a
  version restore would silently drop headers/footers (and already drops
  margins/pageSize — pre-existing bug). Rewrite it to restore **all six
  header/footer fragments plus the full page-layout meta key set**
  (margins, pageSize, and the new hf keys). Add a backend test.

## 3. Geometry & pagination integration

Docs semantics: the header lives inside the top margin, `headerMargin` from
the page edge; if its content grows past the margin, the body is pushed down.
Same mirrored at the bottom.

### 3.1 Pure core (`pagination-core.ts`) — testable, no DOM

Extend `PageGeometry` with per-role reserved band heights, measured by the
view layer:

```ts
interface PageGeometry {
  pageHeight: number; gap: number;
  marginTop: number; marginBottom: number;
  headerMargin: number; footerMargin: number;
  // measured content heights per role; 0 when disabled
  headerHeights: Record<HfRole, number>;
  footerHeights: Record<HfRole, number>;
  hfFlags: { diffFirst: boolean; diffOddEven: boolean };
}
```

`contentTop(page)` / `limit(page)` become role-aware:

```
effTop(p)    = max(marginTop,    headerMargin + headerHeights[resolveRole(p)] + HF_BODY_GAP)
effBottom(p) = max(marginBottom, footerMargin + footerHeights[resolveRole(p)] + HF_BODY_GAP)
```

with `HF_BODY_GAP ≈ 8px` and band height clamped to 40% of `pageHeight`
(guards a pathological giant header from starving the body). Note pages can
now have **different usable heights** (first page vs rest) — `paginate()`
already computes per-page rectangles via `contentTop`/`limit`, so the
algorithm itself is unchanged; only those two functions grow. Extend
`pagination-core.test.ts` with: band reservation, first-page-different
producing an earlier first break, odd/even alternation, clamping, and the
degenerate geometry cases mirroring the existing suite.

### 3.2 Measurement cycle (`pagination.ts`)

Header/footer heights are inputs to pagination, so the existing debounced
measure cycle gains one step: before `paginate()`, read the rendered heights
of each *enabled* segment (from the mirror layer, §4) and put them in the
config. Re-measure triggers add: deep `observe` on the six fragments and on
the hf meta keys. Reuse the existing `setPaginationConfig` path — DocumentShell
already re-pushes config on meta changes.

**Feedback-loop guard:** header height → breaks → page count. Page count must
never feed back into header *height* (the `{total}` page-count node renders
inline with fixed line height), so the fixed point is reached in one pass.
Keep the existing `breaksEqual` early-out as the loop breaker regardless.

## 4. Rendering & editing (frontend)

### 4.1 Repeating bands in the sheet underlay

`EditorSurface` (`Editor.tsx:157-169`) already renders one absolutely
positioned sheet `<div>` per page. Each sheet gains two positioned children:

```
.hf-band-header { top: headerMargin;    left/right: page l/r margins }
.hf-band-footer { bottom: footerMargin; left/right: page l/r margins }
```

Every band shows a **static mirror** of its resolved segment: cached HTML
generated from the fragment (one hidden read-only TipTap render per *distinct
enabled role*, serialized and cloned into each band; regenerated on fragment
change, throttled with the same 120 ms debounce). Mirrors are
`contenteditable=false`, `user-select: none`, `aria-hidden` — pure
projections, exactly like Docs' repeated paint of one segment.

### 4.2 Edit-in-place (single active segment editor)

- **Enter:** double-click any band (Docs behavior), or Insert menu, or
  keyboard (§4.3). The band on the clicked page swaps its mirror for a live
  secondary TipTap editor; all other pages keep mirrors (updating live via
  the fragment observer).
- **The secondary editor** is one extra `useEditor` instance bound to the same
  `ydoc` with `Collaboration.configure({ document: ydoc, field: <segment> })`
  — y-prosemirror supports multiple bindings on distinct fragments of one
  doc. Reduced extension set: StarterKit minus history, Highlight, TextAlign,
  no TaskList, no Pagination. Undo/redo is per-binding (its own scope, like
  Docs). **CollaborationCaret stays body-only in v1** — two caret plugins
  sharing one awareness state need a `field`-scoped cursor filter; verify and
  enable in Phase 3, don't block on it.
- **While active:** a floating chip anchored to the band, Docs-style:
  `Header · [x] Different first page · Options ▾`, where Options holds
  *Header format…* (margins + odd/even, §4.4) and *Remove header*. The main
  Toolbar keeps working — it must target the **focused** editor, so
  DocumentShell tracks `activeEditor` (body | header | footer) and Toolbar
  receives it instead of the body editor directly.
- **Exit:** `Escape` or clicking the body returns focus to the body editor;
  the live editor unmounts back to a mirror.
- Toggling *Different first page* while page 1's band is active seeds
  `header-first` with a **copy** of `header-default` (Docs seeds empty; Word
  copies — copying loses less work, and unchecking restores the default view
  without data loss since `header-first` is kept but unresolved).

### 4.3 Entry points & shortcuts

- New **Insert menu** in the DocumentShell menu bar (extend the
  `"file" | "view"` menu union; the View menu at `DocumentShell.tsx:444-475`
  is the template): *Headers & footers → Header / Footer*, and
  *Page numbers →* presets (header/footer × show-on-first-page), matching
  Docs' four-tile picker.
- Shortcuts (Docs parity): `Ctrl+Alt+O then Ctrl+Alt+H` open header,
  `…Ctrl+Alt+F` footer; `Escape` to body. Announce mode changes via an
  `aria-live` region; bands are labeled landmarks (`role="group"`,
  `aria-label="Page header"`).
- Viewers/commenters: mirrors render, edit-in-place is gated on the same
  `editable` flag as everything else.

### 4.4 Options dialog ("Header format")

Small dialog (reuse ShareDialog's modal pattern): header/footer margin inputs
(inches, converted at 96 dpi like `PAGE_SIZES`), *Different first page* and
*Different odd & even* checkboxes. Writes meta keys in one Yjs transaction
under `localOrigin`.

### 4.5 Page numbers (`{page}` / `{total}`)

Two inline atom nodes, `pageNumber` and `pageCount`, registered **only** in
the segment editors' schema. In the live editor they render the number of the
page hosting the active band; in each mirror clone, a post-clone pass stamps
the per-page value (mirror HTML marks them with `data-hf-pagenum` /
`data-hf-pagecount`; the underlay knows its page index and `pageInfo.pages`
already flows from the plugin). Sync is trivial — the *node* is shared, the
*rendered digit* is local projection, so no CRDT churn as page count changes.

### 4.6 Pageless / mobile

Below the 40 rem breakpoint pagination is off; headers/footers don't render
(Docs hides them in pageless mode too). The Insert menu items disable with a
"Headers require pages view" tooltip.

## 5. Print & export

Screen pagination is decorative; print currently relies on browser
fragmentation of the continuous flow — arbitrary repeating per-page content
cannot be expressed in plain fragmenting CSS.

- **v1 (ship with Phase 1):** in `@media print`, emit the *default* header
  and footer as `position: fixed` top/bottom elements (repeats on every
  printed page in Chromium/Firefox) and grow the `@page` margins by the
  measured band heights so body text never overlaps. Limitations accepted and
  documented: no first/odd-even variants in print, page-number nodes print
  via CSS counters where supported.
- **v2 (separate milestone):** server-side PDF export (Puppeteer route in the
  backend) that renders a dedicated print page using the *real* computed
  breaks to emit true per-page DOM — exact parity including variants. This
  also unlocks the roadmap's export story (plan/12).

## 6. Delivery phases

**Phase 0 — foundations (small PRs, no visible feature):**
core geometry extension + tests; `applyRestore` fix (fragments + full layout
meta) + backend test; `activeEditor` plumbing for Toolbar.

**Phase 1 — MVP (default header/footer):**
meta keys + fragment constants; Insert menu; sheet-underlay bands + mirror
cache; edit-in-place secondary editor with chip + Remove; band-aware
pagination wiring; print v1. Exit criteria: two browsers editing the same
header live; offline edit of a header merges cleanly; restore round-trips.

**Phase 2 — variants & page numbers:**
`hfDiffFirstPage` / `hfDiffOddEven` end-to-end (resolution, seeding-on-toggle,
per-page usable heights); Header-format dialog; `pageNumber`/`pageCount`
nodes + Insert → Page numbers presets.

**Phase 3 — polish:**
caret presence inside segments (awareness `field` scoping); keyboard/a11y
pass; ruler indicators for header/footer margins; perf pass on the mirror
cache for 100+ page docs (mirrors are cloned nodes, so cost is per-page DOM
weight — virtualize band content with the sheets if needed); QA matrix
(offline × variants × restore × print).

## 7. Test plan

- `pagination-core.test.ts` additions (§3.1) — the load-bearing math, pure.
- New `hf-resolve.test.ts` — role resolution truth table.
- Backend `restore` test — snapshot with hf content → restore → fragments and
  meta intact.
- Mirror-cache unit test (fragment change → regenerated HTML) under jsdom
  (add a per-file `// @vitest-environment jsdom` pragma; keep the default
  node env).
- Manual matrix in the PR template: 2-client live header edit, offline merge,
  diff-first + odd/even combos, remove/undo, print preview, pageless.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two Yjs bindings on one doc misbehave (undo, caret) | Undo is per-binding by design; caret deferred to Phase 3 behind verification |
| Layout feedback loop (header height ↔ page count) | Page-count renders never affect height (§3.2); `breaksEqual` early-out |
| Mirror regeneration cost on large docs | One serialization per role per change, cloned N times; throttled; virtualize in Phase 3 |
| Restore drops new fragments | Fixed in Phase 0 before any content can be created |
| Print divergence from screen | Scoped v1 limitations stated in-product; exact parity lands with PDF export v2 |
