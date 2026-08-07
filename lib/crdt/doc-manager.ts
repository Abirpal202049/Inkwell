import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

/**
 * Owns the lifecycle of one open document: the in-memory Y.Doc plus its
 * IndexedDB persistence binding (plan/03-sync-engine.md).
 *
 * Guarantees:
 *  - one live instance per docId per tab (double-mount in React strict
 *    mode / fast route changes must not create duplicate bindings)
 *  - destroy() unbinds persistence and destroys the Y.Doc so observers
 *    and IndexedDB connections never leak (plan/11 §client memory)
 */

const IDB_PREFIX = "inkwell-doc-";

export interface OpenDocument {
  docId: string;
  ydoc: Y.Doc;
  persistence: IndexeddbPersistence;
  /** Resolves once IndexedDB state has been loaded into the Y.Doc. */
  whenLoaded: Promise<void>;
  /** Y.Map holding document metadata that must sync offline (title). */
  meta: Y.Map<unknown>;
  release: () => void;
}

interface Entry {
  open: OpenDocument;
  refCount: number;
}

const registry = new Map<string, Entry>();

export function openDocument(docId: string): OpenDocument {
  const existing = registry.get(docId);
  if (existing) {
    existing.refCount++;
    return existing.open;
  }

  const ydoc = new Y.Doc({ gc: true });
  const persistence = new IndexeddbPersistence(IDB_PREFIX + docId, ydoc);
  const whenLoaded = persistence.whenSynced.then(() => undefined);

  const open: OpenDocument = {
    docId,
    ydoc,
    persistence,
    whenLoaded,
    meta: ydoc.getMap("meta"),
    release: () => releaseDocument(docId),
  };

  registry.set(docId, { open, refCount: 1 });
  return open;
}

function releaseDocument(docId: string): void {
  const entry = registry.get(docId);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  registry.delete(docId);
  entry.open.persistence.destroy();
  entry.open.ydoc.destroy();
}

/** The Y.XmlFragment the editor binds to. Single fixed name per doc. */
export const CONTENT_FRAGMENT = "content";
