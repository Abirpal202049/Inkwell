"use client";

import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  paginate,
  breaksEqual,
  type BlockBox,
  type LineBox,
  type PageBreak,
  type PageGeometry,
  type PaginationPlan,
} from "./pagination-core";

/**
 * Docs-style pagination as a view-layer concern (plan follow-up to
 * plan/07): a plugin measures the rendered blocks, plans page breaks
 * with the pure core, and applies them as widget decorations — spacer
 * divs that push content past each sheet boundary. The Y.Doc is never
 * written to, so collaboration, history, and offline sync are untouched
 * and every client paginates from the same shared inputs (content +
 * pageSize + margins) using its own font metrics.
 *
 * Measurement happens with the spacers display:none'd (the .pm-measuring
 * class on the editor host), which yields the "natural" layout the core
 * needs. The hide → measure → restore cycle is synchronous within one
 * task, so nothing ever paints in the hidden state.
 */

export interface PageInfo {
  page: number;
  pages: number;
}

export interface PaginationConfig extends PageGeometry {
  enabled: boolean;
  onUpdate?: (info: PageInfo) => void;
}

interface PluginState {
  config: PaginationConfig | null;
  breaks: PageBreak[];
  deco: DecorationSet;
}

type Meta =
  | { type: "config"; config: PaginationConfig }
  | { type: "breaks"; breaks: PageBreak[] };

export const paginationKey = new PluginKey<PluginState>("inkwell-pagination");

/** Dispatch a config change (page size, margins, enabled) into the plugin. */
export function setPaginationConfig(editor: Editor, config: PaginationConfig) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(paginationKey, { type: "config", config } satisfies Meta),
  );
}

function buildDecorations(state: EditorState, breaks: PageBreak[]): DecorationSet {
  if (breaks.length === 0) return DecorationSet.empty;
  const decos = breaks.map((b) =>
    Decoration.widget(
      b.pos,
      () => {
        const el = document.createElement("div");
        el.className = "pm-pagebreak";
        el.style.height = `${b.height}px`;
        el.contentEditable = "false";
        return el;
      },
      {
        side: -1,
        ignoreSelection: true,
        key: `${b.kind}:${b.pos}:${Math.round(b.height)}`,
      },
    ),
  );
  return DecorationSet.create(state.doc, decos);
}

// ---- DOM measurement (runs while spacers are hidden) ----------------------

/** Group a Range's client rects into visual line boxes (y in natural coords). */
function measureLines(el: HTMLElement, origin: number): LineBox[] {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.height > 0 && r.width > 0)
    .map((r) => ({ top: r.top - origin, bottom: r.bottom - origin }))
    .sort((a, b) => a.top - b.top);
  const lines: LineBox[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    // Same line when the rect overlaps the current line box vertically.
    if (last && r.top < last.bottom - 2) {
      if (r.bottom > last.bottom) last.bottom = r.bottom;
    } else {
      lines.push({ top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

/**
 * First document position on the line whose top is `targetTop` (client
 * coords). Caret rects sit inside their line box and line tops increase
 * monotonically with pos inside a textblock, so binary search works.
 */
function findLineStart(
  view: EditorView,
  from: number,
  to: number,
  targetTop: number,
): number | null {
  try {
    if (to <= from) return null;
    const topAt = (pos: number) => view.coordsAtPos(pos, 1).top;
    if (topAt(to) < targetTop - 2) return null;
    let lo = from;
    let hi = to;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topAt(mid) >= targetTop - 2) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  } catch {
    return null;
  }
}

function collectBlocks(view: EditorView): BlockBox[] {
  const origin = view.dom.getBoundingClientRect().top;
  const out: BlockBox[] = [];

  const walk = (parent: PMNode, basePos: number, into: BlockBox[]) => {
    let prevBottom: number | null = null;
    let prevMarginBottom = 0;
    parent.forEach((child, offset) => {
      const nodePos = basePos + offset;
      const dom = view.nodeDOM(nodePos);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect();
      const cs = window.getComputedStyle(dom);
      const box: BlockBox = {
        pos: nodePos,
        top: rect.top - origin,
        bottom: rect.bottom - origin,
        marginTop: parseFloat(cs.marginTop) || 0,
        marginBottom: parseFloat(cs.marginBottom) || 0,
        prevBottom,
        prevMarginBottom,
      };
      if (child.isTextblock) {
        // Lazy: only blocks that actually cross a boundary get measured.
        box.lines = () => measureLines(dom, origin);
        box.lineStartPos = (line) =>
          findLineStart(view, nodePos + 1, nodePos + child.nodeSize - 1, line.top + origin);
      } else if (!child.isAtom && child.childCount > 0) {
        const kids: BlockBox[] = [];
        walk(child, nodePos + 1, kids);
        if (kids.length > 0) box.children = kids;
      }
      into.push(box);
      prevBottom = box.bottom;
      prevMarginBottom = box.marginBottom;
    });
  };

  walk(view.state.doc, 0, out);
  return out;
}

// ---- plugin view: scheduling + reporting ----------------------------------

/**
 * Throttle interval. A trailing-only debounce would freeze pagination for
 * the whole duration of a sustained change (margin drags stream config
 * updates per pointermove; fast typing streams doc updates), leaving
 * stale page breaks visibly wrong until the user pauses. Instead,
 * measure at most every N ms with a guaranteed trailing run — page
 * breaks track drags and typing at ~10 fps and always settle exactly.
 */
const MEASURE_INTERVAL_MS = 100;

class PaginationView {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf: number | null = null;
  private ro: ResizeObserver | null = null;
  private pageCount = 1;
  private destroyed = false;
  private lastRun = 0;

  constructor(private view: EditorView) {
    if (typeof ResizeObserver !== "undefined") {
      // Catches width changes (window resize, sidebar toggles) that reflow
      // text and move every break.
      this.ro = new ResizeObserver(() => this.schedule());
      this.ro.observe(view.dom);
    }
    // Web fonts swapping in changes every line height — remeasure once ready.
    document.fonts?.ready.then(() => this.schedule()).catch(() => undefined);
    this.schedule();
  }

  update(view: EditorView, prevState: EditorState) {
    const cur = paginationKey.getState(view.state);
    const prev = paginationKey.getState(prevState);
    if (!cur) return;
    if (view.state.doc !== prevState.doc) {
      // Edits repaginate pre-paint: a keystroke at a page boundary must
      // never render a frame where text and the sheet edges disagree.
      this.scheduleImmediate();
    } else if (cur.config !== prev?.config) {
      this.schedule();
    } else if (!view.state.selection.eq(prevState.selection)) {
      this.reportCaret();
    }
  }

  destroy() {
    this.destroyed = true;
    this.ro?.disconnect();
    if (this.timer) clearTimeout(this.timer);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }

  private schedule(delay?: number) {
    if (this.destroyed) return;
    if (delay !== undefined) {
      // Explicit backoff (e.g. IME composition) replaces any pending run.
      if (this.timer) clearTimeout(this.timer);
    } else if (this.timer) {
      return; // a run is already pending — coalesce into it
    }
    const wait =
      delay ??
      Math.min(
        Math.max(MEASURE_INTERVAL_MS - (performance.now() - this.lastRun), 0),
        MEASURE_INTERVAL_MS,
      );
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.raf !== null) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.measure();
      });
    }, wait);
  }

  /**
   * Coalesced pre-paint measure for document edits. rAF callbacks run
   * before the frame that contains the edit paints, so the breaks are
   * corrected before any stale layout becomes visible.
   */
  private scheduleImmediate() {
    if (this.destroyed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.measure();
    });
  }

  private measure() {
    const view = this.view;
    if (this.destroyed || view.isDestroyed) return;
    this.lastRun = performance.now();
    // Dispatching decoration updates mid-composition breaks IME input.
    if (view.composing) {
      this.schedule(250);
      return;
    }
    const state = paginationKey.getState(view.state);
    if (!state) return;
    const config = state.config;

    if (!config || !config.enabled) {
      this.pageCount = 1;
      if (state.breaks.length > 0) {
        view.dispatch(
          view.state.tr
            .setMeta(paginationKey, { type: "breaks", breaks: [] } satisfies Meta)
            .setMeta("addToHistory", false),
        );
      }
      config?.onUpdate?.({ page: 1, pages: 1 });
      return;
    }

    // Hide spacers so we measure the natural (unpaginated) layout. The
    // class lives on the host element, not view.dom, to stay out of
    // ProseMirror's mutation observer. Synchronous, so it never paints.
    const host = view.dom.parentElement;
    host?.classList.add("pm-measuring");
    let plan: PaginationPlan;
    try {
      plan = paginate(collectBlocks(view), config);
    } finally {
      host?.classList.remove("pm-measuring");
    }

    this.pageCount = plan.pageCount;
    if (!breaksEqual(plan.breaks, state.breaks)) {
      view.dispatch(
        view.state.tr
          .setMeta(paginationKey, { type: "breaks", breaks: plan.breaks } satisfies Meta)
          .setMeta("addToHistory", false),
      );
    }
    this.alignMasks(config);
    this.reportCaret();
  }

  /**
   * Breaks are planned from text rects, but a spacer lands on a line-box
   * boundary — half a line-leading above the text — so its bottom edge
   * ends slightly above the next page's content top. The masked spacers
   * (globals.css) paint sheet/gap bands measured from that bottom edge,
   * so give each one its measured offset as a CSS variable. Widgets
   * ignore mutations, so this never re-enters ProseMirror.
   */
  private alignMasks(config: PaginationConfig) {
    const view = this.view;
    const origin = view.dom.getBoundingClientRect().top;
    const stride = config.pageHeight + config.gap;
    for (const el of Array.from(view.dom.querySelectorAll<HTMLElement>(".pm-pagebreak"))) {
      const y = el.getBoundingClientRect().bottom - origin;
      const page = Math.round((y - config.marginTop) / stride);
      const expected = page * stride + config.marginTop;
      el.style.setProperty("--pb-shift", `${(y - expected).toFixed(2)}px`);
    }
  }

  private reportCaret() {
    if (this.destroyed || this.view.isDestroyed) return;
    const config = paginationKey.getState(this.view.state)?.config;
    if (!config?.onUpdate) return;
    let page = 1;
    if (config.enabled && this.pageCount > 1) {
      try {
        const coords = this.view.coordsAtPos(this.view.state.selection.head);
        const origin = this.view.dom.getBoundingClientRect().top;
        const stride = config.pageHeight + config.gap;
        page = Math.floor((coords.top - origin) / stride) + 1;
        page = Math.min(this.pageCount, Math.max(1, page));
      } catch {
        // selection can be momentarily unmappable during large rebases
      }
    }
    config.onUpdate({ page, pages: this.pageCount });
  }
}

function createPaginationPlugin(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: paginationKey,
    state: {
      init: (): PluginState => ({ config: null, breaks: [], deco: DecorationSet.empty }),
      apply(tr: Transaction, prev: PluginState, _old, newState): PluginState {
        const meta = tr.getMeta(paginationKey) as Meta | undefined;
        if (meta?.type === "breaks") {
          return { ...prev, breaks: meta.breaks, deco: buildDecorations(newState, meta.breaks) };
        }
        let next = prev;
        if (meta?.type === "config") next = { ...next, config: meta.config };
        if (tr.docChanged) {
          // Keep decorations roughly in place until the next measure pass.
          next = {
            ...next,
            deco: next.deco.map(tr.mapping, tr.doc),
            breaks: next.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos) })),
          };
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.deco;
      },
    },
    view: (view) => new PaginationView(view),
  });
}

export const Pagination = Extension.create({
  name: "pagination",
  addProseMirrorPlugins() {
    return [createPaginationPlugin()];
  },
});
