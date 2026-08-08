"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  useEditor,
  EditorContent,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { ChevronDown, Trash2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HF_FRAGMENTS,
  HF_KINDS,
  HF_ROLES,
  type HfKind,
  type HfRole,
} from "@/lib/constants";
import {
  PAGE_GAP,
  pageInsets,
  resolveHfRole,
  type HfBandConfig,
  type PageGeometry,
} from "./pagination-core";
import type { PageMargins } from "./Ruler";
import {
  enabledFor,
  hfBaseExtensions,
  renderHfFragment,
  type HfSettings,
} from "./hf";
import { stampPageNumbers } from "./hf-nodes";

/**
 * The repeating header/footer bands over the sheet stack (plan/16 §4).
 * Each page shows a static, non-editable projection (mirror) of its
 * resolved segment; double-clicking a band swaps in ONE live Tiptap
 * editor bound to that segment's Y.XmlFragment — the Docs model: the
 * content exists once, the pages show projections of it.
 */

/** The band being edited: which kind, on which page (0-based). */
export interface HfActive {
  kind: HfKind;
  page: number;
}

const MIRROR_THROTTLE_MS = 120; // matches the pagination measure cadence

function HfMirror({ html, page, pages }: { html: string; page: number; pages: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    stampPageNumbers(el, page, pages);
  }, [html, page, pages]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="tiptap-content hf-band-content pointer-events-none select-none"
    />
  );
}

function HfSegmentEditor({
  ydoc,
  fragment,
  kind,
  page,
  pages,
  onReady,
  onEscape,
}: {
  ydoc: Y.Doc;
  fragment: string;
  kind: HfKind;
  page: number;
  pages: number;
  onReady: (editor: TiptapEditor | null) => void;
  onEscape: () => void;
}) {
  // handleKeyDown closes over editor creation — route through a ref so a
  // parent re-render can't leave it stale.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        ...hfBaseExtensions(),
        Collaboration.configure({ document: ydoc, field: fragment }),
        Placeholder.configure({
          placeholder: kind === "header" ? "Header — type here" : "Footer — type here",
        }),
      ],
      editorProps: {
        attributes: {
          class: "tiptap-content hf-band-content focus:outline-none",
          "aria-label": kind === "header" ? "Page header" : "Page footer",
        },
        handleKeyDown: (_view, event) => {
          if (event.key === "Escape") {
            onEscapeRef.current();
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: e }) => e.commands.focus("end"),
    },
    [ydoc, fragment],
  );

  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);

  // Page-number node views mount with a placeholder digit — restamp on
  // every repaint (the digit is a local projection, never doc state).
  useEffect(() => {
    if (!editor) return;
    const stamp = () => stampPageNumbers(editor.view.dom, page, pages);
    stamp();
    editor.on("transaction", stamp);
    return () => {
      editor.off("transaction", stamp);
    };
  }, [editor, page, pages]);

  return <EditorContent editor={editor} />;
}

/**
 * Docs' full-width edit bar at the band/body boundary: label on the left,
 * "Different first page" + Options on the right, spanning the whole sheet.
 * Sits below the header area / above the footer area while editing.
 */
function HfEditBar({
  kind,
  diffFirstPage,
  onToggleDiffFirst,
  onOpenFormat,
  onRemove,
}: {
  kind: HfKind;
  diffFirstPage: boolean;
  onToggleDiffFirst: (on: boolean) => void;
  onOpenFormat: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const label = kind === "header" ? "Header" : "Footer";

  return (
    <div
      ref={ref}
      style={kind === "header" ? { top: "100%" } : { bottom: "100%" }}
      className="absolute inset-x-0 z-30 flex h-10 items-center whitespace-nowrap border-y border-[#dadce0] bg-[#f8f9fa] px-6 text-sm text-[#202124] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
    >
      <span className="font-medium">{label}</span>
      <label className="ml-auto flex cursor-pointer items-center gap-2.5 text-[#202124] dark:text-zinc-200">
        <input
          type="checkbox"
          checked={diffFirstPage}
          onChange={(e) => onToggleDiffFirst(e.target.checked)}
          className="h-4 w-4 accent-blue-600"
        />
        Different first page
      </label>
      <div className="relative ml-6">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()} // keep the segment editor's selection
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-1.5 rounded px-2 py-1 font-medium text-[#1a73e8] hover:bg-[#e8f0fe] dark:text-blue-400 dark:hover:bg-zinc-700"
        >
          Options
          <ChevronDown className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-40 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenuOpen(false);
                onOpenFormat();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <SlidersHorizontal className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              Format options…
            </button>
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenuOpen(false);
                onRemove();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" />
              Remove {label.toLowerCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function HeaderFooterLayer({
  ydoc,
  settings,
  bands,
  pages,
  pageHeight,
  margins,
  editable,
  active,
  onActivate,
  onDeactivate,
  onEditorReady,
  onHeights,
  onOpenFormat,
  onRemove,
  onToggleDiffFirst,
}: {
  ydoc: Y.Doc;
  settings: HfSettings;
  bands: HfBandConfig;
  pages: number;
  pageHeight: number;
  margins: PageMargins;
  editable: boolean;
  active: HfActive | null;
  onActivate: (a: HfActive) => void;
  onDeactivate: (refocusBody: boolean) => void;
  onEditorReady: (editor: TiptapEditor | null) => void;
  onHeights: (heights: Record<HfKind, Record<HfRole, number>>) => void;
  onOpenFormat: () => void;
  onRemove: (kind: HfKind) => void;
  onToggleDiffFirst: (on: boolean) => void;
}) {
  const geo: PageGeometry = {
    pageHeight,
    gap: PAGE_GAP,
    marginTop: margins.top,
    marginBottom: margins.bottom,
    bands,
  };
  const stride = pageHeight + PAGE_GAP;

  // ---- segment HTML projections (one per fragment, cloned per page) ------
  const [htmls, setHtmls] = useState<Record<string, string>>({});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const regen = () => {
      timer = null;
      const next: Record<string, string> = {};
      for (const kind of HF_KINDS) {
        for (const role of HF_ROLES) {
          const name = HF_FRAGMENTS[kind][role];
          next[name] = renderHfFragment(ydoc, name);
        }
      }
      setHtmls(next);
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(regen, MIRROR_THROTTLE_MS);
    };
    const frags = HF_KINDS.flatMap((kind) =>
      HF_ROLES.map((role) => ydoc.getXmlFragment(HF_FRAGMENTS[kind][role])),
    );
    for (const f of frags) f.observeDeep(schedule);
    regen();
    return () => {
      for (const f of frags) f.unobserveDeep(schedule);
      if (timer) clearTimeout(timer);
    };
  }, [ydoc]);

  // ---- band height measurement (feeds the pagination band reserve) -------
  const measureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const report = () => {
      const next: Record<HfKind, Record<HfRole, number>> = {
        header: { default: 0, first: 0, even: 0 },
        footer: { default: 0, first: 0, even: 0 },
      };
      for (const el of root.querySelectorAll<HTMLElement>("[data-hf-measure]")) {
        const [kind, role] = el.dataset.hfMeasure!.split(":") as [HfKind, HfRole];
        next[kind][role] = el.offsetHeight;
      }
      onHeights(next);
    };
    const ro = new ResizeObserver(report);
    for (const el of root.querySelectorAll("[data-hf-measure]")) ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [onHeights, settings.headerEnabled, settings.footerEnabled, htmls]);

  const enabledKinds = HF_KINDS.filter((kind) => enabledFor(settings, kind));

  // Print reserve: default-role insets (page 3 = index 2 is always default).
  const printInsets = pageInsets(geo, 2);

  return (
    <>
      {/* Hidden measurers: one per enabled kind × role, at content width. */}
      <div
        ref={measureRef}
        aria-hidden
        className="invisible absolute top-0 -z-10 print:hidden"
        style={{ left: margins.left, right: margins.right }}
      >
        {enabledKinds.flatMap((kind) =>
          HF_ROLES.map((role) => (
            <div key={`${kind}:${role}`} data-hf-measure={`${kind}:${role}`}>
              <div
                className="tiptap-content hf-band-content"
                dangerouslySetInnerHTML={{ __html: htmls[HF_FRAGMENTS[kind][role]] ?? "" }}
              />
            </div>
          )),
        )}
      </div>

      {/* Per-page bands (screen only). */}
      <div className="print:hidden">
        {Array.from({ length: pages }, (_, k) => {
          const insets = pageInsets(geo, k);
          const role = resolveHfRole(k, bands);
          return HF_KINDS.map((kind) => {
            const isHeader = kind === "header";
            const isActive = active?.kind === kind && active.page === k;
            const fragName = HF_FRAGMENTS[kind][role];
            // The hit zone is the whole margin strip (Docs: double-click
            // anywhere in the top/bottom margin to edit).
            const zoneTop = isHeader ? k * stride : k * stride + pageHeight - insets.bottom;
            const zoneH = isHeader ? insets.top : insets.bottom;
            return (
              <div
                key={`${kind}-${k}`}
                role="group"
                aria-label={`Page ${kind}, page ${k + 1} of ${pages}`}
                onDoubleClick={
                  editable && !isActive ? () => onActivate({ kind, page: k }) : undefined
                }
                className={cn(
                  "hf-band absolute inset-x-0",
                  editable && "cursor-text",
                  // Docs marks the area being edited as a bordered box.
                  isActive &&
                    "bg-white ring-1 ring-[#dadce0] dark:bg-zinc-900 dark:ring-zinc-700",
                )}
                style={{ top: zoneTop, height: zoneH }}
              >
                <div
                  data-active={isActive || undefined}
                  className="hf-band-inner absolute"
                  style={
                    isHeader
                      ? { top: settings.headerMargin, left: margins.left, right: margins.right }
                      : {
                          bottom: settings.footerMargin,
                          left: margins.left,
                          right: margins.right,
                        }
                  }
                >
                  {isActive ? (
                    <HfSegmentEditor
                      ydoc={ydoc}
                      fragment={fragName}
                      kind={kind}
                      page={k + 1}
                      pages={pages}
                      onReady={onEditorReady}
                      onEscape={() => onDeactivate(true)}
                    />
                  ) : (
                    <HfMirror html={htmls[fragName] ?? ""} page={k + 1} pages={pages} />
                  )}
                </div>
                {isActive && (
                  <HfEditBar
                    kind={kind}
                    diffFirstPage={settings.diffFirstPage}
                    onToggleDiffFirst={onToggleDiffFirst}
                    onOpenFormat={onOpenFormat}
                    onRemove={() => onRemove(kind)}
                  />
                )}
              </div>
            );
          });
        })}
      </div>

      {/* Print projection (v1, plan/16 §5): the DEFAULT header/footer as
          fixed elements that repeat on every printed page. The injected
          @page rule reserves the band insets; negative offsets lift the
          text into the reserved margin. First-page / odd-even variants and
          live page numbers are a PDF-export concern (v2). */}
      <div aria-hidden className="hidden print:block">
        {settings.headerEnabled && (
          <div
            className="hf-print-header tiptap-content hf-band-content"
            style={{ top: -(printInsets.top - settings.headerMargin) }}
            dangerouslySetInnerHTML={{ __html: htmls[HF_FRAGMENTS.header.default] ?? "" }}
          />
        )}
        {settings.footerEnabled && (
          <div
            className="hf-print-footer tiptap-content hf-band-content"
            style={{ bottom: -(printInsets.bottom - settings.footerMargin) }}
            dangerouslySetInnerHTML={{ __html: htmls[HF_FRAGMENTS.footer.default] ?? "" }}
          />
        )}
      </div>
    </>
  );
}
