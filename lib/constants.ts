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

/** Auto version snapshot cadence. */
export const AUTOSNAPSHOT_EVERY_UPDATES = 50;
export const AUTOSNAPSHOT_MIN_INTERVAL_MS = 600_000;

/** Fold doc_updates tail into doc_compactions after this many rows. */
export const COMPACT_AFTER_UPDATES = 500;

/** Per-connection message rate limit. */
export const RATE_LIMIT_MSGS = 120;
export const RATE_LIMIT_WINDOW_MS = 10_000;

/** Single-use WS connect ticket TTL (seconds). */
export const TOKEN_TTL_S = 60;

/** Remote cursor repaint throttle. */
export const PRESENCE_THROTTLE_MS = 50;

/** AI version-label generation is best-effort within this budget. */
export const AI_LABEL_TIMEOUT_MS = 2_000;

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
