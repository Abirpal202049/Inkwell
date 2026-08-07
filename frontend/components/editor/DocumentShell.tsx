"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, History, Share2, BookmarkPlus, LogIn } from "lucide-react";
import { openDocument } from "@/lib/crdt/doc-manager";
import { upsertLocalDoc } from "@/lib/local/meta-store";
import { TITLE_MIRROR_DEBOUNCE_MS } from "@/lib/constants";
import { presenceColor } from "@/lib/utils";
import { getSession, getDocument, createVersion, type SessionUser } from "@/lib/api";
import { SyncProvider, type SyncState } from "@/lib/sync/provider";
import { ConnectionBadge, type ConnectionState } from "@/components/ConnectionBadge";
import { AuthorCredit } from "@/components/SiteFooter";
import { useInkwellEditor, EditorSurface, type CollabContext } from "./Editor";
import { Toolbar } from "./Toolbar";
import { TitleInput } from "./TitleInput";
import { StatusFooter } from "./StatusFooter";
import { PresenceAvatars } from "./PresenceAvatars";
import { ShareDialog } from "./ShareDialog";

/**
 * Client orchestrator for the editor page (plan/07 §Component
 * Architecture): owns the Y.Doc lifecycle, the sync provider (when
 * signed in), role state (including live downgrades pushed over the
 * socket), and the surrounding chrome.
 *
 * Signed out or offline, everything still works — edits persist to
 * IndexedDB and sync whenever a session + connection appear.
 */
type Role = "owner" | "editor" | "viewer";

export function DocumentShell({ docId }: { docId: string }) {
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  const open = useMemo(() => openDocument(docId), [docId]);
  useEffect(() => () => open.release(), [open]);

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void open.whenLoaded.then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ---- session + sync provider -------------------------------------------
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [provider, setProvider] = useState<SyncProvider | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("offline");
  const [role, setRole] = useState<Role>("owner"); // local-only docs: full control
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    void getSession().then(setSession);
  }, []);

  useEffect(() => {
    if (!session) return;
    const p = new SyncProvider(docId, open.ydoc, {
      onState: setSyncState,
      onRole: (r) => setRole(r),
      onRevoked: () => setRevoked(true),
    });
    p.awareness.setLocalStateField("user", {
      id: session.id,
      name: session.name ?? session.email,
      color: presenceColor(session.id),
      image: session.image,
    });
    setProvider(p);
    void getDocument(docId).then((d) => {
      if (d) {
        setRole(d.role);
        void upsertLocalDoc(docId, { role: d.role, title: d.title });
      }
    });
    return () => {
      p.destroy();
      setProvider(null);
      setSyncState("offline");
    };
  }, [session, open, docId]);

  // Content edits -> bump local meta updatedAt/dirty (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void upsertLocalDoc(docId, {
          title: (open.meta.get("title") as string) ?? undefined,
          updatedAt: Date.now(),
          dirty: true,
        });
      }, TITLE_MIRROR_DEBOUNCE_MS);
    };
    open.ydoc.on("update", onUpdate);
    return () => {
      open.ydoc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [open, docId]);

  const editable = role !== "viewer" && !revoked;

  const collab: CollabContext | null =
    provider && session
      ? {
          provider,
          user: { name: session.name ?? session.email, color: presenceColor(session.id) },
        }
      : null;

  const editor = useInkwellEditor(open.ydoc, editable, collab);

  // ---- save version -------------------------------------------------------
  const [savingVersion, setSavingVersion] = useState<"idle" | "saving" | "saved">("idle");
  const saveVersion = async () => {
    const label = window.prompt("Version label (optional):") ?? undefined;
    setSavingVersion("saving");
    const result = await createVersion(docId, label?.trim() || undefined);
    setSavingVersion(result ? "saved" : "idle");
    setTimeout(() => setSavingVersion("idle"), 1500);
  };

  const [shareOpen, setShareOpen] = useState(false);

  const badgeState: ConnectionState =
    syncState === "connecting" ? "syncing" : (syncState as ConnectionState);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <Link href="/documents" aria-label="Back to documents" className="shrink-0">
            <FileText className="h-6 w-6 text-blue-600" />
          </Link>
          <TitleInput docId={docId} meta={open.meta} ydoc={open.ydoc} autoFocus={isNew} />
          {role === "viewer" && (
            <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              View only
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <PresenceAvatars provider={provider} />
            <ConnectionBadge state={badgeState} />
            {session === null && (
              <a
                href="/api/auth/signin"
                className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in to sync
              </a>
            )}
            {session && editable && (
              <button
                type="button"
                onClick={() => void saveVersion()}
                disabled={savingVersion !== "idle"}
                title="Save a named version"
                aria-label="Save version"
                className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <BookmarkPlus className="h-4 w-4" />
              </button>
            )}
            {session && (
              <Link
                href={`/documents/${docId}/history`}
                title="Version history"
                aria-label="Version history"
                className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <History className="h-4 w-4" />
              </Link>
            )}
            {session && role === "owner" && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
            )}
          </div>
        </div>
      </header>

      {editor && editable && <Toolbar editor={editor} />}

      {revoked && (
        <div className="bg-red-50 px-4 py-2 text-center text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Your access to this document was removed. Your local copy stays readable on this device.
        </div>
      )}

      <main className="flex flex-1 flex-col overflow-y-auto">
        {loaded ? (
          <EditorSurface editor={editor} />
        ) : (
          <div className="mx-auto my-6 w-full max-w-[820px] flex-1 animate-pulse rounded-sm bg-white dark:bg-zinc-900" />
        )}
      </main>

      {/* Single status bar: word count left, author credit centered
          (submission requirement), transient notices right. */}
      <div className="relative flex items-center justify-between border-t border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
        <StatusFooter editor={editor} />
        <span className="absolute left-1/2 -translate-x-1/2 max-sm:hidden">
          <AuthorCredit />
        </span>
        {savingVersion === "saved" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">Version saved</span>
        )}
      </div>

      <ShareDialog docId={docId} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
