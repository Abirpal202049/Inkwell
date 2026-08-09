/**
 * Every tuning constant in the app lives here, traceable to
 * plan/13-api-contracts.md. No magic numbers elsewhere.
 */

/** Batches keystrokes into one update frame before streaming to the server. */
export const EDIT_STREAM_DEBOUNCE_MS = 100;

/** Server-initiated WS ping cadence; 2 missed pongs closes the socket. */
export const WS_HEARTBEAT_MS = 15_000;

/** Exponential reconnect backoff schedule (±20% jitter applied at use site). */
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const RECONNECT_JITTER_RATIO = 0.2;

/** Max bytes of Yjs updates per outbox push batch. */
export const OUTBOX_BATCH_MAX_BYTES = 262_144;

/** Hard transport cap — `ws` maxPayload on the collab server. */
export const WS_MAX_FRAME_BYTES = 1_048_576;

/** Semantic cap on materialized document size. */
export const DOC_MAX_BYTES = 26_214_400;

/**
 * Auto version snapshots (audit trail): cut when an editor's session ends
 * and at most once per MIN_INTERVAL during long live sessions. Session-end
 * snapshots landing within MERGE_WINDOW of the previous unlabeled auto
 * snapshot fold into it, so quick open-edit-close bursts read as one
 * history entry (see backend snapshot-policy.ts).
 */
export const AUTOSNAPSHOT_MIN_INTERVAL_MS = 600_000;
export const AUTOSNAPSHOT_MERGE_WINDOW_MS = 600_000;

/** Fold doc_updates tail into doc_compactions after this many rows. */
export const COMPACT_AFTER_UPDATES = 500;

/** Attributed-changes replay cap: ranges needing more doc_updates rows
 *  than this are refused rather than allowed to stall the server. */
export const MAX_DIFF_REPLAY_ROWS = 20_000;

/**
 * Audit-log retention (plan/11 §doc_updates growth): doc_updates rows are
 * pruned once they are BOTH older than this AND already folded into a
 * compaction — state is never at risk; only per-character attribution
 * beyond the window is. Version contributors are captured at snapshot
 * time, so version history attribution survives pruning forever.
 */
export const DOC_UPDATES_RETENTION_MS = 90 * 86_400_000; // 90 days

/** Idempotency ledger rows re-ack replays; stale ones age out (plan/13). */
export const PROCESSED_BATCH_RETENTION_MS = 7 * 86_400_000; // 7 days

/** Prune pass cadence + startup delay (avoids competing with boot work). */
export const PRUNE_INTERVAL_MS = 6 * 3_600_000; // 6 hours
export const PRUNE_STARTUP_DELAY_MS = 60_000;

/** Per-connection message rate limit. */
export const RATE_LIMIT_MSGS = 120;
export const RATE_LIMIT_WINDOW_MS = 10_000;

/** Single-use WS connect ticket TTL (seconds). */
export const TOKEN_TTL_S = 60;

/** Remote cursor repaint throttle. */
export const PRESENCE_THROTTLE_MS = 50;

/** AI version-label generation is best-effort within this budget. */
export const AI_LABEL_TIMEOUT_MS = 2_000;

/* --- AI add-ons (plan/08) ------------------------------------------------ */

/** Default Gemini model; override per-deploy with the AI_MODEL env var. */
export const AI_DEFAULT_MODEL = "gemini-2.5-flash";

/** Per-user fixed-window rate limit across all /ai endpoints. */
export const AI_RATE_LIMIT_MAX = 20;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;

/** Caps on text sent to the model — inputs are truncated, never rejected.
 *  Gemini Flash has a 1M-token window; ~100k chars (≈25k tokens) covers
 *  full documents while keeping requests cheap. */
export const AI_DOC_CONTEXT_MAX_CHARS = 100_000;
export const AI_SELECTION_MAX_CHARS = 20_000;
export const AI_PROMPT_MAX_CHARS = 2_000;

/** Output budgets per feature (tokens). */
export const AI_GENERATE_MAX_TOKENS = 1_024;
export const AI_SUMMARY_MAX_TOKENS = 1_024;
export const AI_LABEL_MAX_TOKENS = 128;

/** How much of each version's text feeds the label diff prompt. */
export const AI_LABEL_CONTEXT_MAX_CHARS = 6_000;

/** localStorage flag: the one-time "meet AI" coach mark was dismissed. */
export const AI_INTRO_SEEN_KEY = "inkwell-ai-intro-seen";

/** Y.UndoManager: groups a typing burst into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Word-count recompute debounce (never per keystroke). */
export const WORD_COUNT_DEBOUNCE_MS = 300;

/** Title mirror (Y.Doc -> local meta store / server) debounce. */
export const TITLE_MIRROR_DEBOUNCE_MS = 500;

/** Default document title, matches Google Docs. */
export const DEFAULT_DOC_TITLE = "Untitled document";

/** Max title length (mirrors zod schema / DB check). */
export const TITLE_MAX_LENGTH = 300;

/* --- Page headers & footers (plan/16) ------------------------------------ */

/** Repeating page segments. `role` picks which variant a page shows. */
export type HfKind = "header" | "footer";
export type HfRole = "default" | "first" | "even";
export const HF_KINDS: readonly HfKind[] = ["header", "footer"];
export const HF_ROLES: readonly HfRole[] = ["default", "first", "even"];

/**
 * Role-named Y.XmlFragments holding header/footer content, alongside the
 * body's "content" fragment (Docs stores these as separate segments too,
 * but behind id-indirection maps; with no sections the indirection buys
 * nothing, and fixed names mean two offline clients that both "create the
 * header" converge onto the same CRDT type automatically).
 */
export const HF_FRAGMENTS: Record<HfKind, Record<HfRole, string>> = {
  header: { default: "header-default", first: "header-first", even: "header-even" },
  footer: { default: "footer-default", first: "footer-first", even: "footer-even" },
};

export const ALL_HF_FRAGMENT_NAMES: readonly string[] = HF_KINDS.flatMap((kind) =>
  HF_ROLES.map((role) => HF_FRAGMENTS[kind][role]),
);

/**
 * Y.Map('meta') keys defining page layout. Version restore copies exactly
 * this set (backend applyRestore) — keep in sync with the readers in
 * components/editor/Ruler.tsx and components/editor/hf.ts.
 */
export const PAGE_LAYOUT_META_KEYS = [
  "marginLeft",
  "marginRight",
  "marginTop",
  "marginBottom",
  "pageSize",
  "headerEnabled",
  "footerEnabled",
  "hfDiffFirstPage",
  "hfDiffOddEven",
  "headerMargin",
  "footerMargin",
] as const;

/** Distance from the page edge to the header/footer text (px, 0.5in — the Docs default). */
export const DEFAULT_HF_MARGIN = 48;

/**
 * Deterministic presence palette (plan/14 §2): 8 colors, WCAG-checked
 * against both light and dark editor backgrounds. A user's color is
 * palette[hash(userId) % 8] — stable across sessions and viewers.
 */
export const PRESENCE_PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#059669", // emerald
  "#d97706", // amber
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#65a30d", // lime
] as const;
