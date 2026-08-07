import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as Y from "yjs";

/**
 * The determinism proof from plan/04 §Determinism Proof Sketch:
 * N replicas apply different concurrent edit sequences, then exchange
 * all updates in RANDOM per-replica orders. If the CRDT guarantee holds,
 * every replica converges to a byte-identical state regardless of
 * delivery order — this is "deterministic conflict resolution" verified
 * mechanically rather than asserted.
 */

interface EditOp {
  pos: number; // normalized 0..1, scaled to current length
  insert: string;
  deleteCount: number;
}

const editArb = fc.record({
  pos: fc.double({ min: 0, max: 1, noNaN: true }),
  insert: fc.string({ maxLength: 8 }),
  deleteCount: fc.nat({ max: 3 }),
});

function applyEdits(doc: Y.Doc, edits: EditOp[]): void {
  const text = doc.getText("t");
  doc.transact(() => {
    for (const edit of edits) {
      const len = text.length;
      const at = Math.min(Math.floor(edit.pos * (len + 1)), len);
      if (edit.deleteCount > 0 && at < len) {
        text.delete(at, Math.min(edit.deleteCount, len - at));
      }
      if (edit.insert) text.insert(Math.min(at, text.length), edit.insert);
    }
  });
}

describe("CRDT convergence (deterministic conflict resolution)", () => {
  it("N replicas converge byte-identically under any update delivery order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(editArb, { maxLength: 10 }), { minLength: 2, maxLength: 4 }),
        fc.array(fc.nat(), { minLength: 8, maxLength: 8 }), // shuffle seeds
        (perClientEdits, shuffleSeeds) => {
          // Shared starting point.
          const base = new Y.Doc();
          base.getText("t").insert(0, "hello world");
          const baseState = Y.encodeStateAsUpdate(base);

          // Each client forks the base and applies its own edits offline.
          const docs = perClientEdits.map((edits) => {
            const doc = new Y.Doc();
            Y.applyUpdate(doc, baseState);
            applyEdits(doc, edits);
            return doc;
          });

          // Capture each client's incremental update relative to base.
          const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc, Y.encodeStateVector(base)));

          // Deliver every other client's update to each client in a
          // client-specific pseudo-random order.
          docs.forEach((doc, i) => {
            const incoming = updates.filter((_, j) => j !== i);
            const seed = shuffleSeeds[i % shuffleSeeds.length] ?? 0;
            const shuffled = [...incoming].sort(
              (a, b) => ((seed * 9301 + a.byteLength) % 233280) - ((seed * 49297 + b.byteLength) % 233280),
            );
            for (const update of shuffled) Y.applyUpdate(doc, update);
          });

          // Every replica must be byte-identical.
          const first = docs[0]!.getText("t").toString();
          for (const doc of docs) {
            expect(doc.getText("t").toString()).toBe(first);
          }
          const firstVector = Buffer.from(Y.encodeStateVector(docs[0]!)).toString("hex");
          for (const doc of docs) {
            expect(Buffer.from(Y.encodeStateVector(doc)).toString("hex")).toBe(firstVector);
          }

          docs.forEach((d) => d.destroy());
          base.destroy();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("re-applying the same update is idempotent (safe outbox replay)", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "abc");
    const update = Y.encodeStateAsUpdate(a);

    const b = new Y.Doc();
    Y.applyUpdate(b, update);
    const once = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(b, update); // replay — must be a no-op
    Y.applyUpdate(b, update);
    const thrice = Y.encodeStateAsUpdate(b);

    expect(Buffer.from(thrice).toString("hex")).toBe(Buffer.from(once).toString("hex"));
    a.destroy();
    b.destroy();
  });
});
