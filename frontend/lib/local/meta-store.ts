/**
 * IndexedDB `document-meta` store (plan/02-data-model.md, client schema).
 *
 * Powers the offline-capable dashboard: a small metadata record per
 * document known to this device. The document *content* lives in the
 * per-doc Yjs IndexedDB databases (doc-manager.ts); this store is just
 * the list/index. Server metadata is merged in when online (Stage C+).
 */

export interface LocalDocMeta {
  documentId: string;
  title: string;
  updatedAt: number; // epoch ms
  createdAt: number;
  role: "owner" | "editor" | "viewer";
  /** Mirrors the outbox: true while queued updates await a server ACK.
   *  Written ONLY by the sync provider (enqueue → true, drained → false);
   *  advisory — the outbox row count is the authoritative check. */
  dirty: boolean;
  lastSyncedSeq: number;
  /**
   * Plain-text snippet of the document's opening lines for the dashboard
   * thumbnail. Undefined until the document is first opened on this
   * device; "" means the document is genuinely empty.
   */
  preview?: string;
  /** Page-1 header/footer text for the thumbnail bands ("" when the
   *  segment is off or empty). Cached and backfilled alongside `preview`;
   *  undefined until first extracted. */
  previewHeader?: string;
  previewFooter?: string;
}

const DB_NAME = "inkwell-db";
const DB_VERSION = 2;
const STORE = "document-meta";
export const OUTBOX_STORE = "outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "documentId" });
        store.createIndex("updatedAt", "updatedAt");
      }
      // v2: durable sync queue (plan/03 §Outbox Queue).
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = db.createObjectStore(OUTBOX_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        outbox.createIndex("documentId", "documentId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listLocalDocs(): Promise<LocalDocMeta[]> {
  const all = await tx<LocalDocMeta[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLocalDoc(documentId: string): Promise<LocalDocMeta | undefined> {
  return tx("readonly", (s) => s.get(documentId));
}

export function putLocalDoc(meta: LocalDocMeta): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(meta));
}

export async function upsertLocalDoc(
  documentId: string,
  patch: Partial<Omit<LocalDocMeta, "documentId">>,
): Promise<LocalDocMeta> {
  const now = Date.now();
  const existing = await getLocalDoc(documentId);
  const merged: LocalDocMeta = {
    documentId,
    title: patch.title ?? existing?.title ?? "Untitled document",
    createdAt: existing?.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    role: patch.role ?? existing?.role ?? "owner",
    dirty: patch.dirty ?? existing?.dirty ?? false,
    lastSyncedSeq: patch.lastSyncedSeq ?? existing?.lastSyncedSeq ?? 0,
    preview: patch.preview ?? existing?.preview,
    previewHeader: patch.previewHeader ?? existing?.previewHeader,
    previewFooter: patch.previewFooter ?? existing?.previewFooter,
  };
  await putLocalDoc(merged);
  return merged;
}

export function deleteLocalDoc(documentId: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(documentId) as IDBRequest<undefined>);
}

/** Wipe the meta index and the outbox in one transaction. Only the
 *  sign-out purge (lib/local/purge.ts) should call this. */
export function clearAllLocalStores(): Promise<void> {
  return getDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction([STORE, OUTBOX_STORE], "readwrite");
        t.objectStore(STORE).clear();
        t.objectStore(OUTBOX_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}
