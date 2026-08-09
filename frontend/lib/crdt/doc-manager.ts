import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { HF_FRAGMENTS, type HfKind } from "@/lib/constants";

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

/**
 * Hard-delete a document's local content: destroy any live instance and
 * drop its entire per-doc IndexedDB database. Resolves even when another
 * tab still holds the DB open (deletion then completes once it closes).
 */
export function deleteDocumentStorage(docId: string): Promise<void> {
  const entry = registry.get(docId);
  if (entry) {
    registry.delete(docId);
    entry.open.persistence.destroy();
    entry.open.ydoc.destroy();
  }
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_PREFIX + docId);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/**
 * Delete every per-doc content database on this device (sign-out purge).
 * `knownIds` come from the meta store; where the browser supports
 * indexedDB.databases() we also sweep orphaned inkwell-doc-* databases
 * whose meta row was already lost.
 */
export async function deleteAllDocumentStorage(knownIds: string[]): Promise<void> {
  const ids = new Set(knownIds);
  // Where the browser can enumerate databases we also sweep orphaned
  // inkwell-doc-* databases whose meta row was already lost.
  for (const id of (await listLocalContentDocIds()) ?? []) ids.add(id);
  await Promise.all([...ids].map(deleteDocumentStorage));
}

/** Ids of documents whose per-doc content database exists on this device;
 *  null when the browser can't enumerate databases (no indexedDB.databases()). */
export async function listLocalContentDocIds(): Promise<Set<string> | null> {
  try {
    const ids = new Set<string>();
    for (const { name } of await indexedDB.databases()) {
      if (name?.startsWith(IDB_PREFIX)) ids.add(name.slice(IDB_PREFIX.length));
    }
    return ids;
  } catch {
    return null;
  }
}

/** The Y.XmlFragment the editor binds to. Single fixed name per doc. */
export const CONTENT_FRAGMENT = "content";

function nodeText(node: unknown): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    // Page-number atoms carry no text; show them as page 1, matching the
    // static fallback in hf-nodes.ts (the thumbnail depicts page 1).
    if (node.nodeName === "pageNumber" || node.nodeName === "pageCount") return "1";
    return node.toArray().map(nodeText).join("");
  }
  return "";
}

/**
 * Plain-text snapshot of the document's opening lines, used for the
 * dashboard thumbnails (one string, "\n" between block nodes). Cached in
 * the meta store so the dashboard never has to open per-doc databases.
 */
export function extractPreviewText(ydoc: Y.Doc, maxChars = 500): string {
  const frag = ydoc.getXmlFragment(CONTENT_FRAGMENT);
  const lines: string[] = [];
  let total = 0;
  for (const node of frag.toArray()) {
    if (total >= maxChars) break;
    const text = nodeText(node);
    lines.push(text);
    total += text.length + 1;
  }
  return lines.join("\n").slice(0, maxChars).trimEnd();
}

/**
 * One header/footer band's text as it appears on page 1 ("" when the
 * segment is disabled or empty). With "Different first page" on, page 1
 * shows the `first` variant, so that's what the thumbnail mirrors.
 */
export function extractHfPreviewText(ydoc: Y.Doc, kind: HfKind, maxChars = 120): string {
  const meta = ydoc.getMap("meta");
  if (meta.get(`${kind}Enabled`) !== true) return "";
  const role = meta.get("hfDiffFirstPage") === true ? "first" : "default";
  const frag = ydoc.getXmlFragment(HF_FRAGMENTS[kind][role]);
  const text = frag.toArray().map(nodeText).join(" ");
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/** Everything the dashboard thumbnail caches, extracted in one pass. */
export function extractDocPreview(ydoc: Y.Doc): {
  preview: string;
  previewHeader: string;
  previewFooter: string;
} {
  return {
    preview: extractPreviewText(ydoc),
    previewHeader: extractHfPreviewText(ydoc, "header"),
    previewFooter: extractHfPreviewText(ydoc, "footer"),
  };
}
