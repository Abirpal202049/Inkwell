"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, History } from "lucide-react";
import { openDocument } from "@/lib/crdt/doc-manager";
import { upsertLocalDoc } from "@/lib/local/meta-store";
import { TITLE_MIRROR_DEBOUNCE_MS } from "@/lib/constants";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { SiteFooter } from "@/components/SiteFooter";
import { useInkwellEditor, EditorSurface } from "./Editor";
import { Toolbar } from "./Toolbar";
import { TitleInput } from "./TitleInput";
import { StatusFooter } from "./StatusFooter";

/**
 * Client orchestrator for the editor page (plan/07 §Component
 * Architecture). Owns the Y.Doc lifecycle: opens it (with IndexedDB
 * persistence) on mount, releases it on unmount, and keeps the local
 * meta store's updatedAt fresh while editing.
 *
 * Stage B: no sync engine yet — connection state is fixed at "offline",
 * which is honest: everything IS saved on this device.
 */
export function DocumentShell({ docId }: { docId: string }) {
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  // One openDocument per mounted shell; release on unmount. useMemo (not
  // useEffect-create) so the editor gets a stable ydoc on first render;
  // React strict-mode double-invocation is handled by the registry's
  // refcounting.
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

  // Content edits -> bump local meta updatedAt/dirty (debounced), so the
  // dashboard sorts by real recency even fully offline.
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

  const editor = useInkwellEditor(open.ydoc, true);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <Link href="/documents" aria-label="Back to documents" className="shrink-0">
            <FileText className="h-6 w-6 text-blue-600" />
          </Link>
          <TitleInput docId={docId} meta={open.meta} ydoc={open.ydoc} autoFocus={isNew} />
          <div className="ml-auto flex items-center gap-2">
            <ConnectionBadge state="offline" />
            <button
              type="button"
              disabled
              title="Version history (coming in a later stage)"
              aria-label="Version history"
              className="rounded p-1.5 text-zinc-400 dark:text-zinc-600"
            >
              <History className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {editor && <Toolbar editor={editor} />}

      <main className="flex-1 overflow-y-auto">
        {loaded ? (
          <EditorSurface editor={editor} />
        ) : (
          <div className="mx-auto my-6 h-[70vh] w-full max-w-[820px] animate-pulse rounded-sm bg-white dark:bg-zinc-900" />
        )}
      </main>

      <div className="flex items-center justify-between border-t border-zinc-200 bg-white px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900">
        <StatusFooter editor={editor} />
      </div>
      <SiteFooter />
    </div>
  );
}
