import {
  openDocument,
  extractDocPreview,
  listLocalContentDocIds,
} from "@/lib/crdt/doc-manager";
import { upsertLocalDoc, type LocalDocMeta } from "./meta-store";

/**
 * Fill in missing dashboard thumbnails from the per-doc content databases
 * already on this device. Previews are normally mirrored while a document
 * is open (DocumentShell); docs whose cache predates that mirror — or the
 * header/footer preview fields — would otherwise show skeleton lines
 * until revisited. Only docs with an existing content database are
 * touched, so docs never opened here (nothing local to render) keep the
 * skeleton and no empty databases get created.
 *
 * Returns true when anything was written (caller should re-list).
 */
export async function backfillPreviews(docs: LocalDocMeta[]): Promise<boolean> {
  const stale = docs.filter((d) => d.preview === undefined || d.previewHeader === undefined);
  if (stale.length === 0) return false;

  const local = await listLocalContentDocIds();
  if (local === null) return false; // can't enumerate databases — skip
  const candidates = stale.filter((d) => local.has(d.documentId));
  if (candidates.length === 0) return false;

  await Promise.all(
    candidates.map(async (d) => {
      const open = openDocument(d.documentId);
      try {
        await open.whenLoaded;
        // Keep updatedAt: a backfill is not an edit and must not reorder
        // or re-date the "Opened …" list.
        await upsertLocalDoc(d.documentId, {
          ...extractDocPreview(open.ydoc),
          updatedAt: d.updatedAt,
        });
      } finally {
        open.release();
      }
    }),
  );
  return true;
}
