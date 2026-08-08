import {
  AUTOSNAPSHOT_MIN_INTERVAL_MS,
  AUTOSNAPSHOT_MERGE_WINDOW_MS,
} from "@shared/constants";

/**
 * When to cut an automatic version snapshot (plan/05, audit trail).
 *
 * Sessions — not update counts — are the unit of history: an entry should
 * exist for "User 2 edited yesterday evening" whether that was 3 updates
 * or 300. Snapshots are cut on session boundaries (an editor disconnects)
 * and on a fixed cadence during long sessions, and quick open-edit-close
 * bursts fold into the previous auto snapshot so the timeline reads like
 * Google Docs' grouped version history.
 */

/** Why a maintenance pass is running. */
export type SnapshotReason = "interval" | "session-end";

export interface LastVersionInfo {
  isAuto: boolean;
  label: string | null;
  createdAt: Date;
  upToSeq: bigint;
}

export type SnapshotPlan =
  | { action: "skip" }
  | { action: "create" }
  /** Fold this burst into the previous auto snapshot (delete + recreate). */
  | { action: "merge" };

export function planAutoSnapshot(opts: {
  reason: SnapshotReason;
  /** documents.latest_seq — the durable edit log's head. */
  latestSeq: bigint;
  /** Most recent version of ANY kind (auto or manual), or null. */
  last: LastVersionInfo | null;
  now: number;
}): SnapshotPlan {
  const { reason, latestSeq, last, now } = opts;

  // Nothing recorded since the last version — nothing to snapshot.
  if (last ? latestSeq <= last.upToSeq : latestSeq === 0n) return { action: "skip" };

  if (reason === "interval") {
    // Mid-session cadence: at most one auto snapshot per interval, so a
    // long continuous session still leaves periodic restore points.
    if (last && now - last.createdAt.getTime() < AUTOSNAPSHOT_MIN_INTERVAL_MS) {
      return { action: "skip" };
    }
    return { action: "create" };
  }

  // session-end: always record the session's edits. A still-fresh
  // UNLABELED auto snapshot absorbs this burst instead of spawning a new
  // entry; the window is anchored at that snapshot's original createdAt,
  // so grouping cannot slide indefinitely — after the window expires the
  // next burst starts a new entry. Labeled autos (restore markers) and
  // manual versions are never merged away.
  if (
    last &&
    last.isAuto &&
    last.label === null &&
    now - last.createdAt.getTime() < AUTOSNAPSHOT_MERGE_WINDOW_MS
  ) {
    return { action: "merge" };
  }
  return { action: "create" };
}
