import * as Y from "yjs";
import { prisma, withUserContext } from "../db.js";
import { COMPACT_AFTER_UPDATES } from "@shared/constants";
import { planAutoSnapshot, type SnapshotReason } from "./snapshot-policy.js";

/**
 * Durable document state (plan/02, plan/11): an append-only Yjs update
 * log (doc_updates) + a periodically-folded compaction blob so loads
 * never replay the full history.
 */

/** Materialize the current authoritative state as one Yjs update blob. */
export async function loadDocState(documentId: string): Promise<Uint8Array | null> {
  const [compaction, updates] = await Promise.all([
    prisma.docCompaction.findUnique({ where: { documentId } }),
    prisma.docUpdate.findMany({
      where: { documentId },
      orderBy: { seq: "asc" },
      select: { updateBytes: true, seq: true },
    }),
  ]);

  const tail = compaction
    ? updates.filter((u) => u.seq > compaction.upToSeq)
    : updates;

  if (!compaction && tail.length === 0) return null;

  const doc = new Y.Doc({ gc: true });
  if (compaction) Y.applyUpdate(doc, new Uint8Array(compaction.stateBytes));
  for (const u of tail) Y.applyUpdate(doc, new Uint8Array(u.updateBytes));
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/**
 * Append one update with a transactionally-assigned per-document seq
 * (plan/13 §Ordering rule 1). Runs under the author's RLS context, so the
 * updates_insert policy independently enforces owner/editor.
 */
export async function appendUpdate(
  documentId: string,
  authorId: string,
  update: Uint8Array,
): Promise<bigint> {
  return withUserContext(authorId, async (tx) => {
    const doc = await tx.document.update({
      where: { id: documentId },
      data: { latestSeq: { increment: 1 }, updatedAt: new Date() },
      select: { latestSeq: true },
    });
    await tx.docUpdate.create({
      data: {
        documentId,
        seq: doc.latestSeq,
        updateBytes: Buffer.from(update),
        authorId,
        byteSize: update.byteLength,
      },
    });
    return doc.latestSeq;
  });
}

/** Record a processed batch for idempotent replay acks (plan/13 rule 2). */
export async function recordBatch(
  documentId: string,
  batchId: string,
  ackedSeq: bigint,
): Promise<void> {
  await prisma.processedBatch.upsert({
    where: { documentId_batchId: { documentId, batchId } },
    create: { documentId, batchId, ackedSeq },
    update: {},
  });
}

export async function findBatch(documentId: string, batchId: string): Promise<bigint | null> {
  const row = await prisma.processedBatch.findUnique({
    where: { documentId_batchId: { documentId, batchId } },
  });
  return row?.ackedSeq ?? null;
}

/** Most recent version of any kind — anchor for the next contributor window. */
export async function latestVersion(documentId: string) {
  return prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, isAuto: true, label: true, createdAt: true, upToSeq: true },
  });
}

/**
 * Distinct authors of doc_updates past `baseSeq` — the contributors of a
 * version cut now. Every row here passed the users FK on insert, so the
 * ids are always attributable.
 */
export async function contributorsSince(documentId: string, baseSeq: bigint): Promise<string[]> {
  const rows = await prisma.docUpdate.findMany({
    where: { documentId, seq: { gt: baseSeq }, authorId: { not: null } },
    distinct: ["authorId"],
    select: { authorId: true },
  });
  return rows.flatMap((r) => (r.authorId ? [r.authorId] : []));
}

/**
 * Maintenance pass, called opportunistically after appends and on session
 * boundaries (fire-and-forget; failures only delay the next pass):
 *  - auto version snapshot per snapshot-policy.ts (audit trail, plan/05)
 *  - fold the update tail into doc_compactions past a threshold (plan/11)
 * Runs under the document owner's context (system-on-behalf-of-owner).
 */
export async function runMaintenance(
  documentId: string,
  currentState: Uint8Array,
  reason: SnapshotReason = "interval",
): Promise<void> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true, latestSeq: true },
  });
  if (!doc) return;

  const compaction = await prisma.docCompaction.findUnique({ where: { documentId } });
  const tailCount = Number(doc.latestSeq - (compaction?.upToSeq ?? 0n));

  if (tailCount >= COMPACT_AFTER_UPDATES) {
    await prisma.docCompaction.upsert({
      where: { documentId },
      create: { documentId, stateBytes: Buffer.from(currentState), upToSeq: doc.latestSeq },
      update: { stateBytes: Buffer.from(currentState), upToSeq: doc.latestSeq, compactedAt: new Date() },
    });
    // Grace window: folded rows are pruned by a scheduled job, not here
    // (plan/11 §doc_updates growth). Contributor attribution is captured
    // on the version rows below BEFORE pruning can touch the log.
  }

  const last = await latestVersion(documentId);
  const plan = planAutoSnapshot({ reason, latestSeq: doc.latestSeq, last, now: Date.now() });
  if (plan.action === "skip") return;

  const authors = await contributorsSince(documentId, last?.upToSeq ?? 0n);

  if (plan.action === "merge" && last) {
    // Fold this burst into the still-fresh session snapshot: a NEW row
    // (version blobs stay immutable for HTTP caches) keeping the original
    // createdAt anchor, covering up to the current seq, crediting the
    // union of both bursts' authors.
    const prev = await prisma.documentVersionContributor.findMany({
      where: { versionId: last.id },
      select: { userId: true },
    });
    const union = [...new Set([...prev.map((c) => c.userId), ...authors])];
    await withUserContext(doc.ownerId, async (tx) => {
      // deleteMany: a concurrent pass may have merged first — losing the
      // race must not throw, just add a version covering the same span.
      await tx.documentVersion.deleteMany({ where: { id: last.id, isAuto: true } });
      await tx.documentVersion.create({
        data: {
          documentId,
          stateBytes: Buffer.from(currentState),
          isAuto: true,
          createdAt: last.createdAt,
          upToSeq: doc.latestSeq,
          contributors: { create: union.map((userId) => ({ userId })) },
        },
      });
    });
    return;
  }

  // No createdBy: an auto snapshot has no single creator — the
  // contributor rows are the attribution (this is what fixes "User 2's
  // edits show up as the owner's").
  await withUserContext(doc.ownerId, (tx) =>
    tx.documentVersion.create({
      data: {
        documentId,
        stateBytes: Buffer.from(currentState),
        isAuto: true,
        upToSeq: doc.latestSeq,
        contributors: { create: authors.map((userId) => ({ userId })) },
      },
    }),
  );
}
