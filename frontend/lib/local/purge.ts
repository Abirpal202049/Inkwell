import { clearAllLocalStores, listLocalDocs } from "@/lib/local/meta-store";
import { deleteAllDocumentStorage } from "@/lib/crdt/doc-manager";

/**
 * Privacy boundary for shared devices. Local-first means this device is
 * the source of truth while YOU are using it — not after you hand the
 * browser to someone else. Signing out therefore removes every trace of
 * document data: the dashboard meta index (titles + previews), the
 * durable outbox, and each per-doc Yjs content database. Documents that
 * synced to the account are safe server-side and come back on the next
 * sign-in.
 */

/** localStorage key remembering which account's data is cached locally. */
const LAST_ACCOUNT_KEY = "inkwell:last-account-id";

export async function purgeAllLocalData(): Promise<void> {
  const docs = await listLocalDocs().catch(() => []);
  await deleteAllDocumentStorage(docs.map((d) => d.documentId));
  await clearAllLocalStores();
  localStorage.removeItem(LAST_ACCOUNT_KEY);
}

/**
 * Guard against the silent-handoff leak: user A's session expires (or the
 * tab is closed) without an explicit sign-out, then user B signs in on
 * the same browser. Before B's server list is merged into the local
 * cache, drop everything A left behind. Data cached while signed out
 * (no previous account) is adopted, not purged — it belongs to whoever
 * just signed in and will sync up. Returns true when a purge ran.
 */
export async function adoptLocalAccount(userId: string): Promise<boolean> {
  const previous = localStorage.getItem(LAST_ACCOUNT_KEY);
  if (previous !== null && previous !== userId) {
    await purgeAllLocalData();
    localStorage.setItem(LAST_ACCOUNT_KEY, userId);
    return true;
  }
  localStorage.setItem(LAST_ACCOUNT_KEY, userId);
  return false;
}
