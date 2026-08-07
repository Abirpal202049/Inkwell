"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Search, LogIn, LogOut } from "lucide-react";
import { listLocalDocs, upsertLocalDoc, type LocalDocMeta } from "@/lib/local/meta-store";
import { relativeTime, cn } from "@/lib/utils";
import { DEFAULT_DOC_TITLE } from "@/lib/constants";
import { getSession, listDocuments, type SessionUser } from "@/lib/api";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Google-Docs-style home (plan/14 §4). Renders instantly from the local
 * IndexedDB meta store (stale-while-revalidate, works fully offline);
 * when a session exists the server list is merged in so shared documents
 * and fresh roles appear.
 */
type Tab = "recent" | "owned" | "shared";

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

  // Merge the server's list into the local cache (plan/14 §4).
  useEffect(() => {
    if (!session) return;
    void listDocuments().then(async (result) => {
      if (!result) return;
      for (const d of result.documents) {
        await upsertLocalDoc(d.id, {
          title: d.title,
          role: d.role,
          updatedAt: new Date(d.updatedAt).getTime(),
        });
      }
      setDocs(await listLocalDocs());
    });
  }, [session]);

  const createDocument = async () => {
    const id = crypto.randomUUID();
    await upsertLocalDoc(id, { title: DEFAULT_DOC_TITLE, role: "owner" });
    router.push(`/documents/${id}?new=1`);
  };

  const visible = (docs ?? [])
    .filter((d) => (tab === "shared" ? d.role !== "owner" : tab === "owned" ? d.role === "owner" : true))
    .filter((d) => d.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-50">
            <FileText className="h-6 w-6 text-blue-600" />
            Inkwell
          </Link>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search documents"
              aria-label="Search documents"
              className="w-full rounded-full border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          {session === null && (
            <a
              href="/api/auth/signin"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </a>
          )}
          {session && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-sm font-medium dark:bg-zinc-700">
                {session.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny external avatar
                  <img src={session.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  (session.name ?? session.email).slice(0, 1).toUpperCase()
                )}
              </span>
              <a
                href="/api/auth/signout"
                title="Sign out"
                aria-label="Sign out"
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <LogOut className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
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
          <button
            type="button"
            onClick={createDocument}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New document
          </button>
        </div>

        {docs === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
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
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {visible.map((d) => (
              <li key={d.documentId}>
                <Link
                  href={`/documents/${d.documentId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <FileText className="h-5 w-5 shrink-0 text-blue-600" />
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{d.title}</span>
                  <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] capitalize text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {d.role}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {relativeTime(d.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
