import * as Y from "yjs";
import { prisma, withUserContext } from "../db.js";
import {
  AUTOSNAPSHOT_EVERY_UPDATES,
  AUTOSNAPSHOT_MIN_INTERVAL_MS,
  COMPACT_AFTER_UPDATES,
} from "@shared/constants";

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

/**
 * Maintenance pass, called opportunistically after appends (fire-and-
 * forget; failures only delay the next pass):
 *  - auto version snapshot every N updates / min interval (plan/05)
 *  - fold the update tail into doc_compactions past a threshold (plan/11)
 * Runs under the document owner's context (system-on-behalf-of-owner).
 */
export async function runMaintenance(documentId: string, currentState: Uint8Array): Promise<void> {
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
    // (plan/11 §doc_updates growth).
  }

  const lastAuto = await prisma.documentVersion.findFirst({
    where: { documentId, isAuto: true },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const updatesSinceSnapshotOk = doc.latestSeq % BigInt(AUTOSNAPSHOT_EVERY_UPDATES) === 0n;
  const intervalOk =
    !lastAuto || Date.now() - lastAuto.createdAt.getTime() >= AUTOSNAPSHOT_MIN_INTERVAL_MS;

  if (updatesSinceSnapshotOk && intervalOk) {
    await withUserContext(doc.ownerId, (tx) =>
      tx.documentVersion.create({
        data: {
          documentId,
          stateBytes: Buffer.from(currentState),
          isAuto: true,
          createdBy: doc.ownerId,
        },
      }),
    );
  }
}
