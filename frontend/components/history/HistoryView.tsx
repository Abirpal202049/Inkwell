"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import { ArrowLeft, Clock, RotateCcw, Bookmark } from "lucide-react";
import {
  listVersions,
  fetchVersionState,
  restoreVersion,
  getDocument,
  type VersionMeta,
} from "@/lib/api";
import { relativeTime, cn } from "@/lib/utils";
import { useInkwellEditor, EditorSurface } from "@/components/editor/Editor";
import { RestoreVersionDialog } from "@/components/history/RestoreVersionDialog";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Time Travel UI (plan/05 §Time Travel UI Flow): timeline of versions
 * (auto + manual), read-only preview into a THROWAWAY Y.Doc — never the
 * live document — and non-destructive restore (owner/editor only).
 */

function VersionPreview({ state }: { state: Uint8Array }) {
  // Fresh throwaway doc per selected version (plan/05 step 2).
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc;
  }, [state]);
  useEffect(() => () => ydoc.destroy(), [ydoc]);
  const editor = useInkwellEditor(ydoc, false);
  return <EditorSurface editor={editor} />;
}

export function HistoryView({ docId }: { docId: string }) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [role, setRole] = useState<string>("viewer");
  const [selected, setSelected] = useState<VersionMeta | null>(null);
  const [previewState, setPreviewState] = useState<Uint8Array | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listVersions(docId).then((r) => {
      setVersions(r?.versions ?? []);
      if (!r) setError("Couldn't load versions — are you signed in and online?");
    });
    void getDocument(docId).then((d) => d && setRole(d.role));
  }, [docId]);

  useEffect(() => {
    if (!selected) return;
    setPreviewState(null);
    void fetchVersionState(docId, selected.id).then(setPreviewState);
  }, [docId, selected]);

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    const result = await restoreVersion(docId, selected.id);
    setRestoring(false);
    if (result) router.push(`/documents/${docId}`);
    else setError("Restore failed — try again.");
  };

  const canRestore = role === "owner" || role === "editor";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-950">
      <header className="shrink-0 flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <Link
          href={`/documents/${docId}`}
          aria-label="Back to editor"
          className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex items-center gap-2 font-medium">
          <Clock className="h-4 w-4 text-blue-600" />
          Version history
        </h1>
        {selected && canRestore && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={restoring || !previewState}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {restoring ? "Restoring…" : "Restore this version"}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Timeline */}
        <aside className="doc-scrollbar w-72 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          {error && <p className="p-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {versions === null && <p className="p-2 text-sm text-zinc-500">Loading…</p>}
          {versions?.length === 0 && !error && (
            <p className="p-2 text-sm text-zinc-500">
              No versions yet. Versions are captured automatically while editing, or save one from
              the editor.
            </p>
          )}
          <ul className="space-y-1" role="listbox" aria-label="Document versions">
            {(versions ?? []).map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === v.id}
                  onClick={() => setSelected(v)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    selected?.id === v.id && "bg-blue-50 hover:bg-blue-50 dark:bg-blue-950 dark:hover:bg-blue-950",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {!v.isAuto && <Bookmark className="h-3 w-3 text-blue-600" />}
                    {v.label ?? "Auto snapshot"}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {relativeTime(v.createdAt)}
                    {v.createdBy?.name ? ` · ${v.createdBy.name}` : ""}
                    {v.isAuto ? " · auto" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Preview */}
        <main className="doc-scrollbar min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            previewState ? (
              <VersionPreview state={previewState} />
            ) : (
              <div className="mx-auto my-6 h-[70vh] w-full max-w-[820px] animate-pulse rounded-sm bg-white dark:bg-zinc-900" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Select a version to preview it
            </div>
          )}
        </main>
      </div>
      <SiteFooter />

      <RestoreVersionDialog
        open={confirmOpen}
        versionLabel={selected?.label ?? undefined}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void restore()}
      />
    </div>
  );
}
