import { describe, it, expect } from "vitest";
import { planAutoSnapshot, type LastVersionInfo } from "../src/persistence/snapshot-policy.js";
import {
  AUTOSNAPSHOT_MIN_INTERVAL_MS,
  AUTOSNAPSHOT_MERGE_WINDOW_MS,
} from "@shared/constants";

/**
 * Audit-trail snapshot policy (plan/05): versions are cut on session
 * boundaries and on a cadence during long sessions — never on fragile
 * update-count modulos — so every editing session becomes a history
 * entry without anyone clicking "save version".
 */

const NOW = 1_700_000_000_000;

function last(overrides: Partial<LastVersionInfo> = {}): LastVersionInfo {
  return {
    isAuto: true,
    label: null,
    createdAt: new Date(NOW - AUTOSNAPSHOT_MIN_INTERVAL_MS - 1),
    upToSeq: 10n,
    ...overrides,
  };
}

describe("planAutoSnapshot", () => {
  it("skips when nothing changed since the last version", () => {
    for (const reason of ["interval", "session-end"] as const) {
      expect(
        planAutoSnapshot({ reason, latestSeq: 10n, last: last(), now: NOW }),
      ).toEqual({ action: "skip" });
    }
  });

  it("skips an empty document with no versions", () => {
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 0n, last: null, now: NOW }),
    ).toEqual({ action: "skip" });
  });

  it("cuts a first baseline version once edits exist", () => {
    for (const reason of ["interval", "session-end"] as const) {
      expect(
        planAutoSnapshot({ reason, latestSeq: 3n, last: null, now: NOW }),
      ).toEqual({ action: "create" });
    }
  });

  it("interval: rate-limited to one snapshot per interval", () => {
    const fresh = last({ createdAt: new Date(NOW - 1000) });
    expect(
      planAutoSnapshot({ reason: "interval", latestSeq: 20n, last: fresh, now: NOW }),
    ).toEqual({ action: "skip" });
    const stale = last({ createdAt: new Date(NOW - AUTOSNAPSHOT_MIN_INTERVAL_MS) });
    expect(
      planAutoSnapshot({ reason: "interval", latestSeq: 20n, last: stale, now: NOW }),
    ).toEqual({ action: "create" });
  });

  it("session-end: always records the session (this is the User-2-left case)", () => {
    // Last version is old — User 2 came later, edited, and disconnected.
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 20n, last: last(), now: NOW }),
    ).toEqual({ action: "create" });
  });

  it("session-end: a quick follow-up burst folds into the fresh auto snapshot", () => {
    const fresh = last({ createdAt: new Date(NOW - AUTOSNAPSHOT_MERGE_WINDOW_MS + 1000) });
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 20n, last: fresh, now: NOW }),
    ).toEqual({ action: "merge" });
  });

  it("session-end: never merges into manual or labeled (restore) versions", () => {
    const manual = last({ isAuto: false, label: "Draft 1", createdAt: new Date(NOW - 1000) });
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 20n, last: manual, now: NOW }),
    ).toEqual({ action: "create" });
    const restoreMarker = last({ label: "Restored to version from …", createdAt: new Date(NOW - 1000) });
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 20n, last: restoreMarker, now: NOW }),
    ).toEqual({ action: "create" });
  });

  it("session-end: the merge window is anchored, so grouping cannot slide forever", () => {
    const expired = last({ createdAt: new Date(NOW - AUTOSNAPSHOT_MERGE_WINDOW_MS) });
    expect(
      planAutoSnapshot({ reason: "session-end", latestSeq: 20n, last: expired, now: NOW }),
    ).toEqual({ action: "create" });
  });
});
