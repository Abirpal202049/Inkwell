import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { computeAttributedBlocks, type UpdateRow } from "../src/persistence/attributed-diff.js";

/**
 * The audit-trail engine: replaying the authored update log must yield
 * exact per-character attribution — who inserted which text, who deleted
 * which text — across multiple users' clients, mirroring how the real
 * pipeline stores one authored row per pushed update.
 */

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const T0 = 1_700_000_000_000;

let seq = 0;
function row(authorId: string, doc: Y.Doc, edit: () => void): UpdateRow {
  const before = Y.encodeStateVector(doc);
  edit();
  seq += 1;
  return {
    seq: BigInt(seq),
    updateBytes: Y.encodeStateAsUpdate(doc, before),
    authorId,
    createdAt: new Date(T0 + seq * 60_000),
  };
}

function para(text: string): Y.XmlElement {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}

function textOf(p: Y.XmlElement): Y.XmlText {
  return p.get(0) as Y.XmlText;
}

/** Flatten for order-insensitive assertions. */
function tuples(blocks: ReturnType<typeof computeAttributedBlocks>["blocks"]) {
  return blocks.flatMap((b) =>
    b.segments.map((s) => ({ text: s.text, change: s.change, authorId: s.authorId })),
  );
}

/** Two clients, ProseMirror-shaped doc, real sync between them. */
function buildTwoUserHistory() {
  seq = 0;
  const rows: UpdateRow[] = [];

  const docA = new Y.Doc(); // user 1's client
  rows.push(
    row(U1, docA, () => {
      docA.getXmlFragment("content").insert(0, [para("Hello world")]);
    }),
  );

  const docB = new Y.Doc(); // user 2's client
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const pB = docB.getXmlFragment("content").get(0) as Y.XmlElement;
  rows.push(
    row(U2, docB, () => {
      textOf(pB).delete(6, 5); // "world" out
      textOf(pB).insert(6, "there"); // "there" in
    }),
  );
  rows.push(
    row(U2, docB, () => {
      docB.getXmlFragment("content").insert(1, [para("Bye")]);
    }),
  );

  return { rows, docA, docB };
}

describe("computeAttributedBlocks", () => {
  it("attributes each user's inserts and deletes exactly (full range)", () => {
    const { rows } = buildTwoUserHistory();
    const { blocks, contributorIds } = computeAttributedBlocks({
      baseState: null,
      rows,
      fromSeq: 0n,
    });

    expect(new Set(contributorIds)).toEqual(new Set([U1, U2]));
    expect(tuples(blocks)).toEqual(
      expect.arrayContaining([
        { text: "Hello ", change: "added", authorId: U1 },
        { text: "there", change: "added", authorId: U2 },
        { text: "Bye", change: "added", authorId: U2 },
      ]),
    );
    // "world" was written by U1 AND deleted by U2 inside this range: it
    // nets out of an endpoint-to-endpoint compare (narrow the range to see
    // it — covered by the partial-range test below).
    expect(tuples(blocks).find((t) => t.text.includes("world"))).toBeUndefined();
    // The added paragraph is marked at block level too.
    expect(blocks.find((b) => b.segments.some((s) => s.text === "Bye"))?.change).toBe("added");
  });

  it("a partial range leaves earlier content unchanged (the User-2-came-later case)", () => {
    const { rows } = buildTwoUserHistory();
    const { blocks, contributorIds } = computeAttributedBlocks({
      baseState: null,
      rows,
      fromSeq: 1n, // only user 2's session is "the range"
    });

    expect(contributorIds).toEqual([U2]);
    expect(tuples(blocks)).toEqual(
      expect.arrayContaining([
        { text: "Hello ", change: null, authorId: null },
        { text: "there", change: "added", authorId: U2 },
        { text: "world", change: "removed", authorId: U2 },
        { text: "Bye", change: "added", authorId: U2 },
      ]),
    );
  });

  it("replaying from a base snapshot matches replaying from scratch", () => {
    const { rows, docA } = buildTwoUserHistory();
    const baseState = (() => {
      // State exactly at seq 1, like a version snapshot cut after row 1.
      const d = new Y.Doc({ gc: true });
      Y.applyUpdate(d, Y.encodeStateAsUpdate(docA));
      return Y.encodeStateAsUpdate(d);
    })();

    const fromScratch = computeAttributedBlocks({ baseState: null, rows, fromSeq: 1n });
    const fromBase = computeAttributedBlocks({
      baseState,
      rows: rows.filter((r) => r.seq > 1n),
      fromSeq: 1n,
    });
    expect(tuples(fromBase.blocks)).toEqual(tuples(fromScratch.blocks));
  });

  it("content added AND removed inside the range nets out to nothing", () => {
    seq = 0;
    const doc = new Y.Doc();
    const rows: UpdateRow[] = [];
    rows.push(row(U1, doc, () => doc.getXmlFragment("content").insert(0, [para("keep")])));
    rows.push(row(U2, doc, () => doc.getXmlFragment("content").insert(1, [para("temporary")])));
    rows.push(row(U2, doc, () => doc.getXmlFragment("content").delete(1, 1)));

    const inRange = computeAttributedBlocks({ baseState: null, rows, fromSeq: 1n });
    expect(tuples(inRange.blocks)).toEqual([{ text: "keep", change: null, authorId: null }]);

    // …but a range covering only the deletion shows it as removed.
    const deletionOnly = computeAttributedBlocks({ baseState: null, rows, fromSeq: 2n });
    expect(tuples(deletionOnly.blocks)).toEqual(
      expect.arrayContaining([{ text: "temporary", change: "removed", authorId: U2 }]),
    );
  });

  it("splits a merged text run that straddles the range boundary", () => {
    seq = 0;
    const doc = new Y.Doc();
    const rows: UpdateRow[] = [];
    rows.push(row(U1, doc, () => doc.getXmlFragment("content").insert(0, [para("abc")])));
    const p = doc.getXmlFragment("content").get(0) as Y.XmlElement;
    // Same client keeps typing — Yjs merges this into one contiguous item.
    rows.push(row(U1, doc, () => textOf(p).insert(3, "def")));

    const { blocks } = computeAttributedBlocks({ baseState: null, rows, fromSeq: 1n });
    expect(tuples(blocks)).toEqual([
      { text: "abc", change: null, authorId: null },
      { text: "def", change: "added", authorId: U1 },
    ]);
  });

  it("carries the row timestamp onto segments", () => {
    const { rows } = buildTwoUserHistory();
    const { blocks } = computeAttributedBlocks({ baseState: null, rows, fromSeq: 1n });
    const there = blocks.flatMap((b) => b.segments).find((s) => s.text === "there");
    expect(there?.ts).toBe(new Date(T0 + 2 * 60_000).toISOString());
  });
});
