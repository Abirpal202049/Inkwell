import * as Y from "yjs";

/**
 * Plain-text extraction from a materialized Yjs state blob, used to feed
 * document content into AI prompts. Server-side mirror of the frontend's
 * extractPreviewText (lib/crdt/doc-manager.ts) — same traversal, but over
 * a throwaway doc built from bytes, and with a much larger cap.
 */

/** Must match CONTENT_FRAGMENT in frontend/lib/crdt/doc-manager.ts. */
const CONTENT_FRAGMENT = "content";

function nodeText(node: unknown): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  if (node instanceof Y.XmlElement) {
    return node.toArray().map(nodeText).join("");
  }
  return "";
}

/** Materialize `state` and return its body text, "\n" between blocks,
 *  hard-capped at `maxChars` (truncated, never rejected). */
export function extractDocText(state: Uint8Array, maxChars: number): string {
  const doc = new Y.Doc({ gc: true });
  try {
    Y.applyUpdate(doc, state);
    const frag = doc.getXmlFragment(CONTENT_FRAGMENT);
    const lines: string[] = [];
    let total = 0;
    for (const node of frag.toArray()) {
      if (total >= maxChars) break;
      const text = nodeText(node);
      lines.push(text);
      total += text.length + 1;
    }
    return lines.join("\n").slice(0, maxChars).trimEnd();
  } finally {
    doc.destroy();
  }
}
