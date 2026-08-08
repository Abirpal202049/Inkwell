"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Search, LogIn, LogOut, Trash2 } from "lucide-react";
import {
  listLocalDocs,
  upsertLocalDoc,
  deleteLocalDoc,
  type LocalDocMeta,
} from "@/lib/local/meta-store";
import { clearDocument as clearOutbox } from "@/lib/sync/outbox";
import { deleteDocumentStorage } from "@/lib/crdt/doc-manager";
import { adoptLocalAccount } from "@/lib/local/purge";
import { relativeTime, cn } from "@/lib/utils";
import { DEFAULT_DOC_TITLE } from "@/lib/constants";
import { getSession, listDocuments, deleteDocument, type SessionUser } from "@/lib/api";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Google-Docs-style home (plan/14 §4). Renders instantly from the local
 * IndexedDB meta store (stale-while-revalidate, works fully offline);
 * when a session exists the server list is merged in so shared documents
 * and fresh roles appear.
 */
type Tab = "recent" | "owned" | "shared";

/** Multicolor "+" for the blank-document card, Docs-style. */
function NewDocPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect x="15" y="5" width="6" height="10" fill="#4285F4" />
      <rect x="5" y="15" width="10" height="6" fill="#FBBC04" />
      <rect x="21" y="15" width="10" height="6" fill="#34A853" />
      <rect x="15" y="21" width="6" height="10" fill="#EA4335" />
      <rect x="15" y="15" width="6" height="6" fill="#4285F4" />
    </svg>
  );
}

/** Fallback fake text lines for docs never opened on this device
 *  (no cached preview text yet). */
const THUMB_LINES = [
  "w-full", "w-5/6", "w-full", "w-2/3", "w-11/12", "w-3/4", "w-full", "w-5/6", "w-1/2",
];

export function Dashboard() {
  const router = useRouter();
  const [docs, setDocs] = useState<LocalDocMeta[] | null>(null);
  const [tab, setTab] = useState<Tab>("recent");
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    void listLocalDocs().then(setDocs);
    void getSession().then(setSession);
  }, []);

  // Merge the server's list into the local cache (plan/14 §4). If a
  // DIFFERENT account was last active on this device (previous user's
  // session expired without an explicit sign-out), purge their cached
  // documents first so accounts never see each other's data.
  useEffect(() => {
    if (!session) return;
    void (async () => {
      if (await adoptLocalAccount(session.id)) setDocs(await listLocalDocs());
      const result = await listDocuments();
      if (!result) return;
      for (const d of result.documents) {
        await upsertLocalDoc(d.id, {
          title: d.title,
          role: d.role,
          updatedAt: new Date(d.updatedAt).getTime(),
        });
      }
      setDocs(await listLocalDocs());
    })();
  }, [session]);

  const createDocument = async () => {
    const id = crypto.randomUUID();
    await upsertLocalDoc(id, { title: DEFAULT_DOC_TITLE, role: "owner" });
    router.push(`/documents/${id}?new=1`);
  };

  // ---- hard delete (owner only) ------------------------------------------
  const [confirmDelete, setConfirmDelete] = useState<LocalDocMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const performDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.documentId;
    setDeleting(true);
    setDeleteError(null);
    // Signed in: the server copy (and, via cascade, all version history,
    // updates, members, and comments) must go first — never wipe local
    // state while the server still holds the document.
    if (session && !(await deleteDocument(id))) {
      setDeleting(false);
      setDeleteError("Couldn't delete the document — check your connection and try again.");
      return;
    }
    await clearOutbox(id);
    await deleteLocalDoc(id);
    await deleteDocumentStorage(id);
    setDocs(await listLocalDocs());
    setDeleting(false);
    setConfirmDelete(null);
  };

  const visible = (docs ?? [])
    .filter((d) => (tab === "shared" ? d.role !== "owner" : tab === "owned" ? d.role === "owner" : true))
    .filter((d) => d.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex min-h-dvh flex-col bg-white dark:bg-zinc-950">
      <header className="border-b border-transparent bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-xl text-zinc-600 dark:text-zinc-50"
          >
            <FileText className="h-8 w-8 text-blue-600" />
            Inkwell
          </Link>
          <div className="relative mx-auto w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500 dark:text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search"
              aria-label="Search documents"
              className="h-11 w-full rounded-full border border-transparent bg-[#edf2fa] pl-12 pr-4 text-base text-zinc-900 outline-none transition-shadow placeholder:text-zinc-500 focus:bg-white focus:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:bg-zinc-800 dark:focus:shadow-none dark:focus:ring-2 dark:focus:ring-blue-500"
            />
          </div>
          {session === null && (
            <Link
              href="/signin?callbackUrl=/documents"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          )}
          {session && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-sm font-medium dark:bg-zinc-700">
                {session.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny external avatar
                  <img
                    src={session.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (session.name ?? session.email).slice(0, 1).toUpperCase()
                )}
              </span>
              <Link
                href="/signout"
                title="Sign out"
                aria-label="Sign out"
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <LogOut className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </header>

      <section className="border-b border-zinc-200 bg-[#f1f5fb] px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="mx-auto w-full max-w-5xl">
          <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">Start a new document</p>
          <button
            type="button"
            onClick={createDocument}
            className="group flex flex-col items-start gap-2 text-left"
          >
            <span className="flex h-41 w-32 items-center justify-center rounded-sm border border-zinc-300 bg-white transition-colors group-hover:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:group-hover:border-blue-500">
              <NewDocPlus className="h-11 w-11" />
            </span>
            <span className="px-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Blank document
            </span>
          </button>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-medium text-zinc-900 dark:text-zinc-50">
            Recent documents
          </h2>
          {(
            [
              ["recent", "Recent"],
              ["owned", "Owned by me"],
              ["shared", "Shared with me"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={cn(
                "rounded-full px-3 py-1 text-sm",
                tab === key
                  ? "bg-blue-100 font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {docs === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <FileText className="mx-auto mb-3 h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {docs.length === 0
                ? "No documents yet — create your first one."
                : "Nothing matches your search."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visible.map((d) => (
              <li key={d.documentId} className="group relative">
                {d.role === "owner" && (
                  <button
                    type="button"
                    title="Delete forever"
                    aria-label={`Delete ${d.title}`}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDelete(d);
                    }}
                    className="absolute right-1.5 top-1.5 z-10 rounded-full bg-white/90 p-1.5 text-zinc-500 opacity-0 shadow-sm transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 dark:bg-zinc-800/90 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <Link
                  href={`/documents/${d.documentId}`}
                  className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:border-blue-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                  <div
                    aria-hidden
                    className={cn(
                      "h-36 overflow-hidden border-b border-zinc-100 bg-white px-4 pt-4 dark:border-zinc-800 dark:bg-zinc-900",
                      d.preview === undefined && "flex flex-col gap-1.5",
                    )}
                  >
                    {d.preview !== undefined ? (
                      // Mini render of the document's actual opening text,
                      // Docs-style; an empty doc shows a blank page.
                      <p className="whitespace-pre-wrap wrap-break-word text-[7px] leading-2.75 text-zinc-600 dark:text-zinc-400">
                        {d.preview}
                      </p>
                    ) : (
                      THUMB_LINES.map((w, i) => (
                        <div
                          key={i}
                          className={cn(
                            "h-1.5 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800",
                            w,
                          )}
                        />
                      ))
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {d.title}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                      <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        Opened {relativeTime(d.updatedAt)}
                      </span>
                      {d.role !== "owner" && (
                        <span className="ml-auto shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] capitalize text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {d.role}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="delete-doc-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-doc-title"
              className="text-base font-medium text-zinc-900 dark:text-zinc-50"
            >
              Delete &ldquo;{confirmDelete.title}&rdquo; forever?
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This permanently deletes the document for everyone it&apos;s shared with — including
              its entire version history. This cannot be undone.
            </p>
            {deleteError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{deleteError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void performDelete()}
                className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
