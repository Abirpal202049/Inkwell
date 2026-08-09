import { prisma } from "../db.js";
import {
  DOC_UPDATES_RETENTION_MS,
  PROCESSED_BATCH_RETENTION_MS,
  PRUNE_INTERVAL_MS,
  PRUNE_STARTUP_DELAY_MS,
} from "@shared/constants";

/**
 * Scheduled storage pruning (plan/11 §doc_updates growth, plan/13
 * §idempotency ledger). Single-process app → in-process scheduler.
 *
 * doc_updates rows are deleted only when BOTH hold:
 *  - already folded into the document's compaction (seq <= up_to_seq),
 *    so materializing current state never needs them, and
 *  - older than DOC_UPDATES_RETENTION_MS, so attributed changes (the
 *    audit trail) stay replayable across the whole retention window.
 * Documents that never hit the compaction threshold are never pruned —
 * their logs are small by definition. The /changes route detects ranges
 * that reach past pruned history (seqs are dense, so a row-count check is
 * exact) and refuses them rather than computing a wrong diff.
 */

export async function pruneDocUpdates(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - DOC_UPDATES_RETENTION_MS);
  // Runs with no app.user_id set: the updates_delete RLS policy admits
  // exactly this system context (rls.sql).
  return prisma.$executeRaw`
    delete from doc_updates u
    using doc_compactions c
    where c.document_id = u.document_id
      and u.seq <= c.up_to_seq
      and u.created_at < ${cutoff}`;
}

export async function pruneProcessedBatches(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - PROCESSED_BATCH_RETENTION_MS);
  const res = await prisma.processedBatch.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return res.count;
}

export async function runPrunePass(): Promise<void> {
  try {
    const updates = await pruneDocUpdates();
    const batches = await pruneProcessedBatches();
    if (updates > 0 || batches > 0) {
      console.log(`[prune] doc_updates: ${updates} rows, processed_batches: ${batches} rows`);
    }
  } catch (err) {
    // Failures only delay the next pass; nothing user-facing depends on it.
    console.error("[prune] pass failed:", err);
  }
}

/** Start the recurring prune pass; returns a stopper (used by tests). */
export function startPruneScheduler(): () => void {
  const initial = setTimeout(() => void runPrunePass(), PRUNE_STARTUP_DELAY_MS);
  const interval = setInterval(() => void runPrunePass(), PRUNE_INTERVAL_MS);
  // Never keep the process alive just to prune.
  initial.unref();
  interval.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
