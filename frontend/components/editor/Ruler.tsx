"use client";

import { useCallback, useEffect, useState } from "react";
import { useRef } from "react";
import type * as Y from "yjs";
import { localOrigin } from "@/lib/crdt/origins";
import { cn } from "@/lib/utils";

/**
 * Google-Docs-style rulers with draggable margin stops.
 *
 * Margins live in Y.Map('meta') next to the title, so they persist
 * offline, survive reloads, and sync to collaborators like any other
 * document property. Values are px at 96dpi (96px = 1 inch, the Docs
 * default margin).
 */

export interface PageMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Paper sizes at CSS 96dpi. */
export type PageSizeId = "a4" | "letter" | "legal" | "tabloid";
export const PAGE_SIZES: Record<PageSizeId, { label: string; width: number; height: number }> = {
  a4: { label: "A4", width: 794, height: 1123 }, // 210mm × 297mm
  letter: { label: "Letter", width: 816, height: 1056 }, // 8.5in × 11in
  legal: { label: "Legal", width: 816, height: 1344 }, // 8.5in × 14in
  tabloid: { label: "Tabloid", width: 1056, height: 1632 }, // 11in × 17in
};
export const DEFAULT_PAGE_SIZE: PageSizeId = "a4";

export const DEFAULT_MARGIN = 96; // 1 inch
const MARGIN_MIN = 24; // 0.25 inch
const MARGIN_MAX_SIDE = 288; // 3 inches
const MARGIN_MAX_TOP = 240; // 2.5 inches
const MIN_TEXT_WIDTH = 192; // never let the margins squeeze the text below 2in
const HALF_INCH = 48;
const INCH = 96;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

function readMargins(meta: Y.Map<unknown>): PageMargins {
  const num = (key: string, max: number) => {
    const v = meta.get(key);
    return typeof v === "number" && Number.isFinite(v)
      ? clamp(v, MARGIN_MIN, max)
      : DEFAULT_MARGIN;
  };
  return {
    left: num("marginLeft", MARGIN_MAX_SIDE),
    right: num("marginRight", MARGIN_MAX_SIDE),
    top: num("marginTop", MARGIN_MAX_TOP),
    bottom: num("marginBottom", MARGIN_MAX_TOP),
  };
}

function readPageSize(meta: Y.Map<unknown>): PageSizeId {
  const v = meta.get("pageSize");
  return typeof v === "string" && v in PAGE_SIZES ? (v as PageSizeId) : DEFAULT_PAGE_SIZE;
}

/**
 * Page-setup state bridged to the shared meta map: `preview` updates
 * only local state (used live while dragging), `commit` writes the
 * final margins into the Y.Doc on pointer-up, `setPageSize` commits
 * the paper size immediately.
 */
export function useDocMargins(meta: Y.Map<unknown>, ydoc: Y.Doc) {
  const [margins, setMargins] = useState<PageMargins>(() => readMargins(meta));
  const [pageSize, setPageSizeState] = useState<PageSizeId>(() => readPageSize(meta));
  const draggingRef = useRef(false);

  useEffect(() => {
    const observer = () => {
      setPageSizeState(readPageSize(meta));
      if (draggingRef.current) return;
      setMargins(readMargins(meta));
    };
    observer();
    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [meta]);

  const preview = useCallback((next: PageMargins) => {
    draggingRef.current = true;
    setMargins(next);
  }, []);

  const commit = useCallback(
    (next: PageMargins) => {
      draggingRef.current = false;
      setMargins(next);
      ydoc.transact(() => {
        meta.set("marginLeft", next.left);
        meta.set("marginRight", next.right);
        meta.set("marginTop", next.top);
        meta.set("marginBottom", next.bottom);
      }, localOrigin);
    },
    [meta, ydoc],
  );

  const setPageSize = useCallback(
    (next: PageSizeId) => {
      setPageSizeState(next);
      ydoc.transact(() => meta.set("pageSize", next), localOrigin);
    },
    [meta, ydoc],
  );

  return { margins, pageSize, preview, commit, setPageSize };
}

interface RulerProps {
  margins: PageMargins;
  editable: boolean;
  onPreview: (next: PageMargins) => void;
  onCommit: (next: PageMargins) => void;
}

/** Shared drag plumbing: capture the pointer, stream previews, commit on release. */
function startDrag(
  e: React.PointerEvent,
  compute: (ev: { clientX: number; clientY: number }) => PageMargins,
  onPreview: (m: PageMargins) => void,
  onCommit: (m: PageMargins) => void,
) {
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => onPreview(compute(ev));
  const onUp = (ev: PointerEvent) => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
    onCommit(compute(ev));
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

/** Downward-pointing margin stop (horizontal ruler). */
function StopDown() {
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-blue-600"
    />
  );
}

/** Right-pointing margin stop (vertical ruler). */
function StopRight() {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent border-l-blue-600"
    />
  );
}

/**
 * Horizontal ruler above the page. Numbers count inches outward from
 * the left text edge (Docs behavior), so they slide with the margin.
 */
export function HorizontalRuler({
  margins,
  editable,
  onPreview,
  onCommit,
  pageWidth,
}: RulerProps & { pageWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);

  const dragSide = (side: "left" | "right") => (e: React.PointerEvent) => {
    if (!editable || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const base = { ...margins };
    startDrag(
      e,
      (ev) =>
        side === "left"
          ? {
              ...base,
              left: clamp(
                ev.clientX - rect.left,
                MARGIN_MIN,
                Math.min(MARGIN_MAX_SIDE, rect.width - base.right - MIN_TEXT_WIDTH),
              ),
            }
          : {
              ...base,
              right: clamp(
                rect.right - ev.clientX,
                MARGIN_MIN,
                Math.min(MARGIN_MAX_SIDE, rect.width - base.left - MIN_TEXT_WIDTH),
              ),
            },
      onPreview,
      onCommit,
    );
  };

  const marks: React.ReactNode[] = [];
  for (
    let rel = -Math.floor(margins.left / HALF_INCH) * HALF_INCH;
    margins.left + rel <= pageWidth;
    rel += HALF_INCH
  ) {
    const x = margins.left + rel;
    if (x < 4 || x > pageWidth - 4) continue;
    const inches = Math.abs(rel) / INCH;
    if (rel % INCH === 0 && inches !== 0) {
      marks.push(
        <span
          key={rel}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] leading-none text-zinc-500 dark:text-zinc-400"
          style={{ left: x }}
        >
          {inches}
        </span>,
      );
    } else {
      marks.push(
        <span
          key={rel}
          className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-zinc-400 dark:bg-zinc-600"
          style={{ left: x }}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative h-5 select-none overflow-hidden bg-white dark:bg-zinc-900"
    >
      {/* margin zones */}
      <div
        className="absolute inset-y-0 left-0 bg-[#e9eef6] dark:bg-zinc-800"
        style={{ width: margins.left }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-[#e9eef6] dark:bg-zinc-800"
        style={{ width: margins.right }}
      />
      {marks}
      {/* drag handles on the margin boundaries */}
      <div
        title={editable ? "Drag to adjust the left margin" : undefined}
        onPointerDown={dragSide("left")}
        className={cn(
          "absolute inset-y-0 z-10 w-3 -translate-x-1/2 touch-none",
          editable && "cursor-col-resize",
        )}
        style={{ left: margins.left }}
      >
        <StopDown />
      </div>
      <div
        title={editable ? "Drag to adjust the right margin" : undefined}
        onPointerDown={dragSide("right")}
        className={cn(
          "absolute inset-y-0 z-10 w-3 translate-x-1/2 touch-none",
          editable && "cursor-col-resize",
        )}
        style={{ right: margins.right }}
      >
        <StopDown />
      </div>
    </div>
  );
}

/**
 * Vertical ruler pinned to the extreme left of the document area (the
 * short leg of Docs' inverted-L). It fills its column top to bottom and
 * doesn't scroll; instead the page's position in the scroll area is
 * passed in so ticks and the margin stop track the page while scrolling.
 */
export function VerticalRuler({
  margins,
  editable,
  onPreview,
  onCommit,
  pageTop,
  scrollTop,
  pageHeight,
}: RulerProps & {
  /** Distance from the top of the scroll area to the page's top edge (px). */
  pageTop: number;
  /** Current scrollTop of the document scroll area. */
  scrollTop: number;
  /** Page height in px; ticks stop at the page's bottom edge. */
  pageHeight: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pageY = pageTop - scrollTop; // page's top edge in ruler coordinates

  const dragTop = (e: React.PointerEvent) => {
    if (!editable || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const base = { ...margins };
    startDrag(
      e,
      (ev) => ({
        ...base,
        top: clamp(ev.clientY - rect.top - pageY, MARGIN_MIN, MARGIN_MAX_TOP),
      }),
      onPreview,
      onCommit,
    );
  };

  const dragBottom = (e: React.PointerEvent) => {
    if (!editable || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const base = { ...margins };
    startDrag(
      e,
      (ev) => ({
        ...base,
        bottom: clamp(pageY + pageHeight - (ev.clientY - rect.top), MARGIN_MIN, MARGIN_MAX_TOP),
      }),
      onPreview,
      onCommit,
    );
  };

  const marks: React.ReactNode[] = [];
  for (
    let rel = -Math.floor(margins.top / HALF_INCH) * HALF_INCH;
    margins.top + rel <= pageHeight;
    rel += HALF_INCH
  ) {
    const y = pageY + margins.top + rel;
    if (y < 4) continue;
    const inches = Math.abs(rel) / INCH;
    if (rel % INCH === 0 && inches !== 0) {
      marks.push(
        <span
          key={rel}
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 text-[9px] leading-none text-zinc-500 dark:text-zinc-400"
          style={{ top: y }}
        >
          {inches}
        </span>,
      );
    } else {
      marks.push(
        <span
          key={rel}
          className="absolute left-1/2 h-px w-1 -translate-x-1/2 bg-zinc-400 dark:bg-zinc-600"
          style={{ top: y }}
        />,
      );
    }
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative h-full select-none overflow-hidden bg-white dark:bg-zinc-900"
    >
      <div
        className="absolute inset-x-0 bg-[#e9eef6] dark:bg-zinc-800"
        style={{ top: pageY, height: margins.top }}
      />
      <div
        className="absolute inset-x-0 bg-[#e9eef6] dark:bg-zinc-800"
        style={{ top: pageY + pageHeight - margins.bottom, height: margins.bottom }}
      />
      {marks}
      <div
        title={editable ? "Drag to adjust the top margin" : undefined}
        onPointerDown={dragTop}
        className={cn(
          "absolute inset-x-0 z-10 h-3 -translate-y-1/2 touch-none",
          editable && "cursor-row-resize",
        )}
        style={{ top: pageY + margins.top }}
      >
        <StopRight />
      </div>
      <div
        title={editable ? "Drag to adjust the bottom margin" : undefined}
        onPointerDown={dragBottom}
        className={cn(
          "absolute inset-x-0 z-10 h-3 -translate-y-1/2 touch-none",
          editable && "cursor-row-resize",
        )}
        style={{ top: pageY + pageHeight - margins.bottom }}
      >
        <StopRight />
      </div>
    </div>
  );
}
