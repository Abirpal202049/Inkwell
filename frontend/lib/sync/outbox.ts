import { getDb, OUTBOX_STORE } from "@/lib/local/meta-store";
import { OUTBOX_BATCH_MAX_BYTES } from "@/lib/constants";

/**
 * Durable outbox (plan/03 §Outbox Queue): every local Yjs update is
 * appended here BEFORE any network attempt and deleted only on a server
 * ACK. Survives reloads and crashes; safe to replay because CRDT updates
 * are idempotent.
 */

export interface OutboxRow {
  id: number;
  documentId: string;
  bytes: Uint8Array;
  createdAt: number;
}

export function enqueue(documentId: string, bytes: Uint8Array): Promise<void> {
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, "readwrite");
        tx.objectStore(OUTBOX_STORE).add({ documentId, bytes, createdAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/** Oldest-first rows for one document, capped at the batch byte budget. */
export function peekBatch(documentId: string): Promise<OutboxRow[]> {
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, "readonly");
        const index = tx.objectStore(OUTBOX_STORE).index("documentId");
        const req = index.getAll(documentId);
        req.onsuccess = () => {
          const rows = (req.result as OutboxRow[]).sort((a, b) => a.id - b.id);
          const batch: OutboxRow[] = [];
          let bytes = 0;
          for (const row of rows) {
            bytes += row.bytes.byteLength;
            if (batch.length > 0 && bytes > OUTBOX_BATCH_MAX_BYTES) break;
            batch.push(row);
          }
          resolve(batch);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

export function remove(ids: number[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, "readwrite");
        const store = tx.objectStore(OUTBOX_STORE);
        for (const id of ids) store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function count(documentId: string): Promise<number> {
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(OUTBOX_STORE, "readonly");
        const req = tx.objectStore(OUTBOX_STORE).index("documentId").count(documentId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}
