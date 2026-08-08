"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type * as Y from "yjs";
import type { SyncProvider } from "@/lib/sync/provider";
import { CONTENT_FRAGMENT } from "@/lib/crdt/doc-manager";
import {
  PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MARGIN,
  type PageMargins,
  type PageSizeId,
} from "./Ruler";
import { Pagination, setPaginationConfig, type PageInfo } from "./pagination";
import { PAGE_GAP, PAGE_MARGIN_BOTTOM } from "./pagination-core";

/**
 * The Tiptap editor bound to the shared Y.Doc (plan/01 §Layers).
 *
 * - Collaboration replaces StarterKit's undoRedo with y-prosemirror's
 *   undo plugin, which tracks only locally-originated transactions —
 *   this IS the per-user undo behavior from plan/14 §1 (Ctrl+Z never
 *   reverts a collaborator's edit).
 * - CollaborationCaret renders named remote cursors with each user's
 *   deterministic color (plan/14 §2) when a sync provider is active.
 * - immediatelyRender: false — required with SSR to avoid hydration
 *   mismatches; the editor mounts client-side only.
 */

export interface CollabContext {
  provider: SyncProvider;
  user: { name: string; color: string };
}

export function useInkwellEditor(
  ydoc: Y.Doc,
  editable: boolean,
  collab?: CollabContext | null,
): TiptapEditor | null {
  return useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({
          undoRedo: false, // Collaboration provides Yjs-aware undo/redo
          link: { openOnClick: false, autolink: true },
        }),
        Collaboration.configure({ document: ydoc, field: CONTENT_FRAGMENT }),
        ...(collab
          ? [CollaborationCaret.configure({ provider: collab.provider, user: collab.user })]
          : []),
        Highlight,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        Pagination,
      ],
      editorProps: {
        attributes: {
          class:
            "tiptap-content flex-1 focus:outline-none",
          "aria-label": "Document content",
        },
      },
    },
    [ydoc, editable, collab?.provider ?? null],
  );
}

const SHEET_CLASSES =
  "absolute inset-x-0 bg-white shadow-sm ring-1 ring-[#dadce0] dark:bg-zinc-900 dark:shadow-md dark:ring-zinc-800";

export function EditorSurface({
  editor,
  margins,
  pageSize = DEFAULT_PAGE_SIZE,
  onPageInfo,
}: {
  editor: TiptapEditor | null;
  /** Page margins in px; falls back to the CSS defaults (1in) when absent. */
  margins?: PageMargins;
  /** Paper size; controls page width and height. */
  pageSize?: PageSizeId;
  /** Live caret page / total pages, for the status bar. */
  onPageInfo?: (info: PageInfo) => void;
}) {
  const size = PAGE_SIZES[pageSize];
  const [pages, setPages] = useState(1);

  // Below the mobile breakpoint globals.css flattens the page padding, so
  // pagination switches off there too (Docs is pageless on mobile as well).
  const [paginated, setPaginated] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 40rem)");
    const apply = () => setPaginated(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const marginTop = margins?.top ?? DEFAULT_MARGIN;
  const marginRight = margins?.right ?? DEFAULT_MARGIN;
  const marginLeft = margins?.left ?? DEFAULT_MARGIN;
  const marginBottom = margins?.bottom ?? PAGE_MARGIN_BOTTOM;

  const handleUpdate = useCallback(
    (info: PageInfo) => {
      setPages(info.pages);
      onPageInfo?.(info);
    },
    [onPageInfo],
  );

  // Feed geometry into the pagination plugin whenever it changes. Margin
  // drags stream through here per pointermove; the plugin debounces.
  useEffect(() => {
    if (!editor) return;
    setPaginationConfig(editor, {
      enabled: paginated,
      pageHeight: size.height,
      gap: PAGE_GAP,
      marginTop,
      marginBottom,
      onUpdate: handleUpdate,
    });
  }, [editor, paginated, size.height, marginTop, marginBottom, handleUpdate]);

  const stackHeight = pages * size.height + (pages - 1) * PAGE_GAP;
  const style = {
    maxWidth: size.width,
    "--page-h": `${size.height}px`,
    ...(paginated && { minHeight: stackHeight }),
    ...(margins && {
      "--page-mt": `${margins.top}px`,
      "--page-mr": `${margins.right}px`,
      "--page-ml": `${margins.left}px`,
      "--page-mb": `${margins.bottom}px`,
    }),
  } as React.CSSProperties;

  return (
    <div style={style} className="doc-sheet-stack relative mx-auto my-6 w-full">
      {/* Browser print handles real fragmentation; mirror the doc's paper
          size and margins, and let print CSS strip the screen chrome. */}
      <style>{`@page { size: ${size.width}px ${size.height}px; margin: ${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px; }`}</style>
      {/* Sheet underlay: content flows continuously on top; spacers from
          the pagination plugin hold it inside these page rectangles. */}
      <div aria-hidden className="print:hidden">
        {paginated ? (
          Array.from({ length: pages }, (_, k) => (
            <div
              key={k}
              className={SHEET_CLASSES}
              style={{ top: k * (size.height + PAGE_GAP), height: size.height }}
            />
          ))
        ) : (
          <div className={`${SHEET_CLASSES} inset-y-0`} />
        )}
      </div>
      <EditorContent editor={editor} className="relative" />
    </div>
  );
}
