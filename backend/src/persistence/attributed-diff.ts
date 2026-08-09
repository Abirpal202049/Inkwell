import * as Y from "yjs";
import { prisma } from "../db.js";
import { MAX_DIFF_REPLAY_ROWS } from "@shared/constants";

/**
 * Attributed change computation (audit trail, plan/05): who changed what
 * between two points in a document's durable edit log.
 *
 * doc_updates is an append-only log of Yjs deltas, each stamped with its
 * author. Every CRDT item a delta creates carries a (client, clock) id,
 * and every deletion references such ids — so mapping each row's clock
 * ranges to its author gives EXACT per-character attribution, with no
 * heuristic text diffing. The log is replayed into a scratch doc with
 * gc disabled, which keeps deleted content as tombstones so removals can
 * be shown with their text.
 *
 * Known limits (deliberate):
 *  - formatting-only changes (bold, etc.) are not surfaced — the audit
 *    view is about text;
 *  - body content only (the "content" fragment), not headers/footers;
 *  - content both added AND removed inside the range nets out to nothing
 *    and is hidden, like Google Docs' version compare.
 */

export interface UpdateRow {
  seq: bigint;
  updateBytes: Uint8Array;
  authorId: string | null;
  createdAt: Date;
}

interface ChangeMeta {
  authorId: string | null;
  ts: string;
}

export interface DiffSegment {
  text: string;
  change: "added" | "removed" | null;
  authorId: string | null;
  ts: string | null;
}

export interface DiffBlock {
  /** Yjs nodeName: paragraph, heading, codeBlock, … */
  type: string;
  level: number | null;
  /** Set when the whole block was added/removed in the range. */
  change: "added" | "removed" | null;
  segments: DiffSegment[];
}

/** Per-client clock-range → change-metadata index. */
class ClockRanges {
  private byClient = new Map<number, { start: number; end: number; meta: ChangeMeta }[]>();

  add(client: number, start: number, end: number, meta: ChangeMeta): void {
    if (end <= start) return;
    let list = this.byClient.get(client);
    if (!list) this.byClient.set(client, (list = []));
    list.push({ start, end, meta });
  }

  find(client: number, clock: number): ChangeMeta | null {
    const list = this.byClient.get(client);
    if (!list) return null;
    for (const r of list) if (clock >= r.start && clock < r.end) return r.meta;
    return null;
  }

  /** Boundary clocks strictly inside (start, end) — where attribution can flip. */
  cutpoints(client: number, start: number, end: number): number[] {
    const list = this.byClient.get(client);
    if (!list) return [];
    const cuts: number[] = [];
    for (const r of list) {
      if (r.start > start && r.start < end) cuts.push(r.start);
      if (r.end > start && r.end < end) cuts.push(r.end);
    }
    return cuts;
  }
}

interface WalkCtx {
  inserts: ClockRanges;
  deletes: ClockRanges;
  authors: Set<string>;
}

type Classified = { change: "added" | "removed" | null; meta: ChangeMeta | null };

/**
 * Where an item stands relative to the range: created in it (added),
 * deleted in it (removed), untouched (null) — or invisible: deleted
 * before the range, or created AND deleted inside it (net nothing).
 */
function classifyItem(item: Y.Item, ctx: WalkCtx): Classified | "invisible" {
  const ins = ctx.inserts.find(item.id.client, item.id.clock);
  if (item.deleted) {
    const del = ctx.deletes.find(item.id.client, item.id.clock);
    if (!del || ins) return "invisible";
    return { change: "removed", meta: del };
  }
  return ins ? { change: "added", meta: ins } : { change: null, meta: null };
}

/* Yjs's event-handler generic is invariant, so the shared walker takes
 * AbstractType<any> — it only reads the item chain. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyYType = Y.AbstractType<any>;

function firstItem(type: AnyYType): Y.Item | null {
  return (type as unknown as { _start: Y.Item | null })._start;
}

function pushSegment(out: DiffSegment[], text: string, cls: Classified, ctx: WalkCtx): void {
  if (text.length === 0) return;
  if (cls.meta?.authorId) ctx.authors.add(cls.meta.authorId);
  const last = out[out.length - 1];
  const ts = cls.meta?.ts ?? null;
  const authorId = cls.meta?.authorId ?? null;
  if (last && last.change === cls.change && last.authorId === authorId && last.ts === ts) {
    last.text += text; // merge adjacent equal-attribution runs
  } else {
    out.push({ text, change: cls.change, authorId, ts });
  }
}

/**
 * Split one text item's clock span at every attribution boundary and emit
 * a segment per uniform slice. A single item can straddle the range start
 * (Yjs merges adjacent runs from the same client), so per-slice lookups —
 * not per-item — are what keep attribution exact.
 */
function pushStringSegments(
  item: Y.Item,
  str: string,
  inherited: Classified | null,
  ctx: WalkCtx,
  out: DiffSegment[],
): void {
  const { client, clock } = item.id;
  const end = clock + str.length;
  const cuts = [
    ...new Set([...ctx.inserts.cutpoints(client, clock, end), ...ctx.deletes.cutpoints(client, clock, end)]),
  ].sort((a, b) => a - b);
  const bounds = [clock, ...cuts, end];

  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i]!;
    const text = str.slice(s - clock, bounds[i + 1]! - clock);
    const ins = ctx.inserts.find(client, s);
    if (item.deleted) {
      const del = ctx.deletes.find(client, s);
      if (!del || ins) continue; // pre-range deletion / net-nothing
      pushSegment(out, text, { change: "removed", meta: del }, ctx);
    } else if (inherited?.change === "removed") {
      // Ancestor block removed in range; content added in the range nets out.
      if (ins) continue;
      pushSegment(out, text, inherited, ctx);
    } else if (ins) {
      pushSegment(out, text, { change: "added", meta: ins }, ctx);
    } else {
      pushSegment(out, text, inherited?.change ? inherited : { change: null, meta: null }, ctx);
    }
  }
}

const LEAF_BLOCKS = new Set(["paragraph", "heading", "codeBlock", "code_block"]);
const LINE_BREAKS = new Set(["hardBreak", "br"]);

/** Flatten a leaf block's inline content (text runs, line breaks, nested
 *  inline nodes) into attributed segments. Formatting items are skipped. */
function collectInline(
  type: AnyYType,
  inherited: Classified | null,
  ctx: WalkCtx,
  out: DiffSegment[],
): void {
  for (let item = firstItem(type); item !== null; item = item.right) {
    if (!(item instanceof Y.Item)) continue;
    const content = item.content;
    if (content instanceof Y.ContentString) {
      pushStringSegments(item, content.str, inherited, ctx, out);
    } else if (content instanceof Y.ContentType) {
      const cls = classifyItem(item, ctx);
      if (cls === "invisible") continue;
      const eff = cls.change ? cls : inherited;
      const child = content.type;
      if (child instanceof Y.XmlElement && LINE_BREAKS.has(child.nodeName)) {
        pushSegment(out, "\n", eff ?? { change: null, meta: null }, ctx);
      } else {
        collectInline(child, eff, ctx, out);
      }
    }
    // ContentFormat / ContentEmbed / ContentDeleted / binary: not text.
  }
}

function walkBlocks(
  parent: AnyYType,
  inherited: Classified | null,
  ctx: WalkCtx,
  out: DiffBlock[],
): void {
  for (let item = firstItem(parent); item !== null; item = item.right) {
    if (!(item instanceof Y.Item)) continue;
    const content = item.content;
    if (!(content instanceof Y.ContentType)) continue;
    const cls = classifyItem(item, ctx);
    if (cls === "invisible") continue;
    const eff = cls.change ? cls : inherited;
    if (eff?.meta?.authorId) ctx.authors.add(eff.meta.authorId);

    const t = content.type;
    if (t instanceof Y.XmlText) {
      const segments: DiffSegment[] = [];
      collectInline(t, eff, ctx, segments);
      out.push({ type: "paragraph", level: null, change: eff?.change ?? null, segments });
    } else if (t instanceof Y.XmlElement) {
      if (LEAF_BLOCKS.has(t.nodeName)) {
        const segments: DiffSegment[] = [];
        collectInline(t, eff, ctx, segments);
        const level = t.getAttribute("level");
        out.push({
          type: t.nodeName,
          level: typeof level === "number" ? level : null,
          change: eff?.change ?? null,
          segments,
        });
      } else {
        // Container (lists, blockquotes, …): recurse until leaf blocks.
        walkBlocks(t, eff, ctx, out);
      }
    }
  }
}

/**
 * Pure core: replay `rows` on top of `baseState` and emit the document's
 * blocks with every change in (fromSeq, last row] attributed. Rows with
 * seq <= fromSeq only rebuild state; they are not attributed.
 */
export function computeAttributedBlocks(opts: {
  baseState: Uint8Array | null;
  rows: UpdateRow[];
  fromSeq: bigint;
}): { blocks: DiffBlock[]; contributorIds: string[] } {
  const doc = new Y.Doc({ gc: false });
  try {
    if (opts.baseState && opts.baseState.byteLength > 0) Y.applyUpdate(doc, opts.baseState);

    const ctx: WalkCtx = { inserts: new ClockRanges(), deletes: new ClockRanges(), authors: new Set() };
    for (const row of opts.rows) {
      if (row.seq > opts.fromSeq) {
        const meta: ChangeMeta = { authorId: row.authorId, ts: row.createdAt.toISOString() };
        const { structs, ds } = Y.decodeUpdate(row.updateBytes);
        for (const s of structs) {
          if (s instanceof Y.Item && s.length > 0) {
            ctx.inserts.add(s.id.client, s.id.clock, s.id.clock + s.length, meta);
          }
        }
        ds.clients.forEach((dels, client) => {
          for (const d of dels) ctx.deletes.add(client, d.clock, d.clock + d.len, meta);
        });
      }
      Y.applyUpdate(doc, row.updateBytes);
    }

    const blocks: DiffBlock[] = [];
    walkBlocks(doc.getXmlFragment("content"), null, ctx, blocks);
    return { blocks, contributorIds: [...ctx.authors] };
  } finally {
    doc.destroy();
  }
}

export type DocumentChangesResult =
  | { ok: true; blocks: DiffBlock[]; contributorIds: string[] }
  | { ok: false; reason: "too-large" | "pruned" };

/**
 * DB wrapper: attributed changes for doc seq range (fromSeq, toSeq].
 * Base state comes from the newest version snapshot at or before fromSeq
 * (falling back to full-log replay for documents predating the audit
 * trail). Refuses ranges that would replay too many rows, and ranges
 * reaching past pruned history: seqs are dense, so fewer rows than
 * (toSeq - baseSeq) means retention pruning has eaten part of the range —
 * a wrong diff must never be computed from a gappy log.
 */
export async function computeDocumentChanges(
  documentId: string,
  fromSeq: bigint,
  toSeq: bigint,
): Promise<DocumentChangesResult> {
  const base = await prisma.documentVersion.findFirst({
    where: { documentId, upToSeq: { gt: 0n, lte: fromSeq } },
    orderBy: { upToSeq: "desc" },
    select: { stateBytes: true, upToSeq: true },
  });
  const baseSeq = base?.upToSeq ?? 0n;

  const count = await prisma.docUpdate.count({
    where: { documentId, seq: { gt: baseSeq, lte: toSeq } },
  });
  if (count > MAX_DIFF_REPLAY_ROWS) return { ok: false, reason: "too-large" };
  if (BigInt(count) < toSeq - baseSeq) return { ok: false, reason: "pruned" };

  const rows = await prisma.docUpdate.findMany({
    where: { documentId, seq: { gt: baseSeq, lte: toSeq } },
    orderBy: { seq: "asc" },
    select: { seq: true, updateBytes: true, authorId: true, createdAt: true },
  });

  return {
    ok: true,
    ...computeAttributedBlocks({
      baseState: base ? new Uint8Array(base.stateBytes) : null,
      rows: rows.map((r) => ({ ...r, updateBytes: new Uint8Array(r.updateBytes) })),
      fromSeq,
    }),
  };
}
