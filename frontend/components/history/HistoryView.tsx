"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import { ArrowLeft, Clock, RotateCcw, Bookmark, Activity } from "lucide-react";
import {
  listVersions,
  fetchVersionState,
  fetchChanges,
  restoreVersion,
  getDocument,
  type VersionMeta,
  type DocumentChanges,
} from "@/lib/api";
import { relativeTime, presenceColor, cn } from "@/lib/utils";
import { useInkwellEditor, EditorSurface } from "@/components/editor/Editor";
import type { PageInfo } from "@/components/editor/pagination";
import type { HfBandConfig } from "@/components/editor/pagination-core";
import { PAGE_SIZES, useDocMargins } from "@/components/editor/Ruler";
import {
  useHfSettings,
  hfHeightsEqual,
  ZERO_HF_HEIGHTS,
  type HfHeights,
} from "@/components/editor/hf";
import { HeaderFooterLayer } from "@/components/editor/HeaderFooterLayer";
import { RestoreVersionDialog } from "@/components/history/RestoreVersionDialog";
import { ChangesView, ContributorLegend } from "@/components/history/ChangesView";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Time Travel UI (plan/05 §Time Travel UI Flow) + audit trail:
 *  - Versions mode: timeline of snapshots; each previews read-only into a
 *    THROWAWAY Y.Doc (never the live document) and offers "What changed" —
 *    the attributed diff of that version's window. Restore stays
 *    non-destructive (owner/editor only).
 *  - Activity mode: attributed changes over a duration (last hour → all
 *    time), colored per editor like Google Docs' "show changes".
 */

/** Auto snapshots are titled by their timestamp, like Google Docs. */
function versionTitle(v: VersionMeta): string {
  if (v.label) return v.label;
  return new Date(v.createdAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Who edited within this version's window — the audit trail line. Each
 * contributor gets their presence color, so the dot here matches their
 * live cursor in the editor. Older rows (pre-audit-trail) fall back to
 * the version's creator.
 */
function ContributorLine({ v }: { v: VersionMeta }) {
  const people =
    v.contributors?.length > 0
      ? v.contributors
      : v.createdBy
        ? [{ id: `creator-${v.id}`, name: v.createdBy.name, image: v.createdBy.image }]
        : [];
  if (people.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {people.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: presenceColor(p.id) }}
          />
          {p.name ?? "Unknown user"}
        </span>
      ))}
    </span>
  );
}

const noop = () => {};

function VersionPreview({ state }: { state: Uint8Array }) {
  // Fresh throwaway doc per selected version (plan/05 step 2).
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc;
  }, [state]);
  useEffect(() => () => ydoc.destroy(), [ydoc]);
  const editor = useInkwellEditor(ydoc, false);

  // The snapshot carries the full page setup — margins, paper size, and
  // header/footer segments — so the preview renders it like the editor
  // does, just read-only (no band editing, no format dialogs).
  const meta = ydoc.getMap("meta");
  const { margins, pageSize } = useDocMargins(meta, ydoc);
  const hf = useHfSettings(meta, ydoc);
  const [hfHeights, setHfHeights] = useState<HfHeights>(ZERO_HF_HEIGHTS);
  const handleHfHeights = useCallback((next: HfHeights) => {
    setHfHeights((prev) => (hfHeightsEqual(prev, next) ? prev : next));
  }, []);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, pages: 1 });
  const handlePageInfo = useCallback((info: PageInfo) => {
    setPageInfo((prev) => (prev.page === info.page && prev.pages === info.pages ? prev : info));
  }, []);
  const bands: HfBandConfig = useMemo(
    () => ({
      headerMargin: hf.settings.headerMargin,
      footerMargin: hf.settings.footerMargin,
      diffFirstPage: hf.settings.diffFirstPage,
      diffOddEven: hf.settings.diffOddEven,
      headerHeights: hfHeights.header,
      footerHeights: hfHeights.footer,
    }),
    [hf.settings, hfHeights],
  );

  return (
    <EditorSurface
      editor={editor}
      margins={margins}
      pageSize={pageSize}
      onPageInfo={handlePageInfo}
      bands={bands}
      hfLayer={
        <HeaderFooterLayer
          ydoc={ydoc}
          settings={hf.settings}
          bands={bands}
          pages={pageInfo.pages}
          pageHeight={PAGE_SIZES[pageSize].height}
          margins={margins}
          editable={false}
          active={null}
          onActivate={noop}
          onDeactivate={noop}
          onEditorReady={noop}
          onHeights={handleHfHeights}
          onOpenFormat={noop}
          onRemove={noop}
          onToggleDiffFirst={noop}
        />
      }
    />
  );
}

const ACTIVITY_RANGES = [
  { key: "1h", label: "Last hour", ms: 3_600_000 },
  { key: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { key: "7d", label: "Last 7 days", ms: 604_800_000 },
  { key: "30d", label: "Last 30 days", ms: 2_592_000_000 },
  { key: "all", label: "All time", ms: null },
] as const;
type ActivityKey = (typeof ACTIVITY_RANGES)[number]["key"];

const SHEET_SKELETON = (
  <div className="mx-auto my-6 h-[70vh] w-full max-w-[820px] animate-pulse rounded-sm bg-white dark:bg-zinc-900" />
);

export function HistoryView({ docId }: { docId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"versions" | "activity">("versions");
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [role, setRole] = useState<string>("viewer");
  const [selected, setSelected] = useState<VersionMeta | null>(null);
  const [previewState, setPreviewState] = useState<Uint8Array | null>(null);
  const [tab, setTab] = useState<"preview" | "changes">("preview");
  const [versionChanges, setVersionChanges] = useState<DocumentChanges | null>(null);
  const [changesNote, setChangesNote] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState<ActivityKey>("24h");
  const [activity, setActivity] = useState<DocumentChanges | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
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

  // Level 1: "What changed" for the selected version — its window against
  // the next-older version with a known log anchor.
  useEffect(() => {
    if (!selected || tab !== "changes" || !versions) return;
    setVersionChanges(null);
    setChangesNote(null);
    if (selected.upToSeq === 0) {
      setChangesNote("This version predates the audit trail, so its change breakdown isn't available.");
      return;
    }
    const idx = versions.findIndex((x) => x.id === selected.id);
    const prev = versions.slice(idx + 1).find((x) => x.upToSeq > 0);
    void fetchChanges(docId, { fromSeq: prev?.upToSeq ?? 0, toSeq: selected.upToSeq }).then((r) => {
      if (r) setVersionChanges(r);
      else setChangesNote("Couldn't load the changes for this version — try again.");
    });
  }, [docId, selected, tab, versions]);

  // Level 2: activity over a duration.
  useEffect(() => {
    if (mode !== "activity") return;
    setActivity(null);
    setActivityError(null);
    const range = ACTIVITY_RANGES.find((r) => r.key === activityKey)!;
    const opts = range.ms === null ? {} : { since: new Date(Date.now() - range.ms).toISOString() };
    void fetchChanges(docId, opts).then((r) => {
      if (r) setActivity(r);
      else setActivityError("Couldn't load activity — are you online?");
    });
  }, [docId, mode, activityKey]);

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
        {mode === "versions" && selected && (
          <div
            className="ml-2 flex rounded-lg bg-zinc-100 p-0.5 text-sm dark:bg-zinc-800"
            role="tablist"
            aria-label="Version view"
          >
            {(["preview", "changes"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1",
                  tab === t
                    ? "bg-white font-medium shadow-sm dark:bg-zinc-700"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                )}
              >
                {t === "preview" ? "Preview" : "What changed"}
              </button>
            ))}
          </div>
        )}
        {mode === "versions" && selected && canRestore && (
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
        {/* Timeline / activity controls */}
        <aside className="doc-scrollbar w-72 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div
            className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800"
            role="tablist"
            aria-label="History mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "versions"}
              onClick={() => setMode("versions")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1",
                mode === "versions"
                  ? "bg-white font-medium shadow-sm dark:bg-zinc-700"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              <Clock className="h-3.5 w-3.5" /> Versions
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "activity"}
              onClick={() => setMode("activity")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1",
                mode === "activity"
                  ? "bg-white font-medium shadow-sm dark:bg-zinc-700"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              <Activity className="h-3.5 w-3.5" /> Activity
            </button>
          </div>

          {mode === "versions" ? (
            <>
              {error && <p className="p-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
              {versions === null && <p className="p-2 text-sm text-zinc-500">Loading…</p>}
              {versions?.length === 0 && !error && (
                <p className="p-2 text-sm text-zinc-500">
                  No versions yet. Versions are captured automatically while editing, or save one
                  from the editor.
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
                        selected?.id === v.id &&
                          "bg-blue-50 hover:bg-blue-50 dark:bg-blue-950 dark:hover:bg-blue-950",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {!v.isAuto && <Bookmark className="h-3 w-3 text-blue-600" />}
                        {versionTitle(v)}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {relativeTime(v.createdAt)}
                        {v.isAuto ? " · auto" : ""}
                      </span>
                      <ContributorLine v={v} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="space-y-4 p-1">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Show changes from
                </p>
                <div className="space-y-0.5" role="radiogroup" aria-label="Activity range">
                  {ACTIVITY_RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      role="radio"
                      aria-checked={activityKey === r.key}
                      onClick={() => setActivityKey(r.key)}
                      className={cn(
                        "block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        activityKey === r.key &&
                          "bg-blue-50 font-medium text-blue-700 hover:bg-blue-50 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-950",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {activity && <ContributorLegend contributors={activity.contributors} />}
              {activity && activity.contributors.length === 0 && (
                <p className="text-sm text-zinc-500">No edits in this period.</p>
              )}
            </div>
          )}
        </aside>

        {/* Main pane */}
        <main className="doc-scrollbar min-w-0 flex-1 overflow-y-auto">
          {mode === "activity" ? (
            activityError ? (
              <div className="flex h-full items-center justify-center text-sm text-red-600 dark:text-red-400">
                {activityError}
              </div>
            ) : activity ? (
              <ChangesView changes={activity} />
            ) : (
              SHEET_SKELETON
            )
          ) : !selected ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Select a version to preview it
            </div>
          ) : tab === "changes" ? (
            changesNote ? (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-500">
                {changesNote}
              </div>
            ) : versionChanges ? (
              <ChangesView changes={versionChanges} />
            ) : (
              SHEET_SKELETON
            )
          ) : previewState ? (
            <VersionPreview state={previewState} />
          ) : (
            SHEET_SKELETON
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
