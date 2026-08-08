/**
 * Pure pagination math (no DOM, no ProseMirror imports) so it can be
 * unit-tested with synthetic measurements.
 *
 * Model: the document renders as one continuous flow; pagination inserts
 * invisible spacers (widget decorations) that push content past each page
 * boundary. Everything here works in two coordinate spaces:
 *
 * - "natural" y: where content sits with every spacer removed (this is
 *   what the plugin measures, with spacers display:none'd).
 * - "live" y: natural + `shift`, where shift is the total height the
 *   spacers planned so far add above a point. Page geometry (sheet edges,
 *   margins, gaps) is fixed in live coordinates.
 *
 * Pagination itself is presentation only — it never touches the Y.Doc,
 * so it is safe under collaboration and offline sync.
 */

export const PAGE_GAP = 24; // px between sheets (matches the my-6 canvas inset)
export const PAGE_MARGIN_BOTTOM = 96; // fixed 1in bottom margin (globals.css padding)

export interface PageGeometry {
  /** Sheet height in px (e.g. 1123 for A4 @96dpi). */
  pageHeight: number;
  /** Vertical gap between sheets in px. */
  gap: number;
  /** Top margin (adjustable via the ruler). */
  marginTop: number;
  /** Bottom margin. */
  marginBottom: number;
}

export interface LineBox {
  top: number;
  bottom: number;
}

export type BreakKind = "block" | "line";

export interface PageBreak {
  /** Document position the spacer widget is anchored to. */
  pos: number;
  /** Spacer height in px. */
  height: number;
  /** "block" = between blocks; "line" = inside a textblock between lines. */
  kind: BreakKind;
}

/** One block-level node, measured in natural coordinates. */
export interface BlockBox {
  /** Position immediately before the node. */
  pos: number;
  top: number;
  bottom: number;
  marginTop: number;
  marginBottom: number;
  /** Natural bottom of the previous in-flow sibling (null = first child). */
  prevBottom: number | null;
  prevMarginBottom: number;
  /** Child blocks for containers (lists, blockquotes) we can recurse into. */
  children?: BlockBox[] | null;
  /** Line boxes for splittable textblocks (lazy — only called on breaks). */
  lines?: () => LineBox[];
  /** Doc position of the first character of the given line (null = unknown). */
  lineStartPos?: (line: LineBox) => number | null;
}

export interface PaginationPlan {
  breaks: PageBreak[];
  pageCount: number;
}

const EPS = 1;

export function paginate(blocks: BlockBox[], geo: PageGeometry): PaginationPlan {
  const { pageHeight: H, gap, marginTop: mt, marginBottom: mb } = geo;
  const stride = H + gap;
  const usable = H - mt - mb;
  if (!(H > 0) || !(usable > EPS)) return { breaks: [], pageCount: 1 };

  const contentTop = (page: number) => page * stride + mt;
  const limit = (page: number) => page * stride + H - mb;

  const breaks: PageBreak[] = [];
  let k = 0; // current page index
  let shift = 0; // px the planned spacers have added above the current point

  /** Push a whole block to the top of the next page. */
  const pushWholeBlock = (b: BlockBox) => {
    const target = contentTop(k + 1);
    // A spacer in flow stops the neighbours' margins from collapsing, so
    // the pushed block lands at prevBottom + prevMarginBottom + spacer +
    // its own marginTop. Solve for the spacer height.
    const height =
      b.prevBottom == null
        ? target - (b.top + shift)
        : target - (b.prevBottom + shift + b.prevMarginBottom + b.marginTop);
    breaks.push({ pos: b.pos, height: Math.max(0, height), kind: "block" });
    shift = target - b.top;
    k += 1;
  };

  const processBlock = (b: BlockBox): void => {
    let guard = 0;
    while (b.bottom + shift > limit(k) + EPS) {
      if (++guard > 500) return; // never wedge the editor on bad measurements

      const liveTop = b.top + shift;
      const atPageTop = liveTop <= contentTop(k) + EPS;
      const blockH = b.bottom - b.top;

      // Move the whole block when it isn't already at a page top and fits.
      if (!atPageTop && blockH <= usable + EPS) {
        pushWholeBlock(b);
        continue; // now starts at a page top and fits — loop exits
      }

      // Containers: paginate their children instead.
      if (b.children && b.children.length > 0) {
        for (const child of b.children) processBlock(child);
        // Trailing padding may still cross a boundary; just advance pages.
        while (limit(k) + EPS < b.bottom + shift) k += 1;
        return;
      }

      // Textblocks: split between line boxes (Docs splits mid-paragraph).
      if (b.lines && b.lineStartPos) {
        const lines = b.lines();
        const boundary = limit(k) - shift; // back to natural coords
        let idx = lines.findIndex((l) => l.bottom > boundary + EPS);
        if (idx < 0) return; // measurement disagreement — leave it alone
        if (idx === 0) {
          if (!atPageTop) {
            pushWholeBlock(b);
            continue;
          }
          // Already at a page top and the first line alone overflows the
          // page (giant line): it cannot move or split — let it bleed.
          if (lines.length === 1) break;
          idx = 1; // keep the giant first line, push the rest
        }
        const line = lines[idx]!;
        const pos = b.lineStartPos(line);
        if (pos == null) break;
        const target = contentTop(k + 1);
        const height = target - (line.top + shift);
        if (height <= EPS) break; // no forward progress — bail out
        breaks.push({ pos, height, kind: "line" });
        shift = target - line.top;
        k += 1;
        continue; // a very tall block keeps splitting page after page
      }

      // Unsplittable overflow (atom taller than a page): let it bleed
      // across the gap; pagination resumes below it.
      break;
    }
    // If the block still overflows (bleed cases above), advance the page
    // cursor so later blocks paginate against the page holding its bottom.
    while (limit(k) + EPS < b.bottom + shift) k += 1;
  };

  for (const b of blocks) processBlock(b);
  return { breaks, pageCount: k + 1 };
}

export function breaksEqual(a: PageBreak[], b: PageBreak[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.pos !== y.pos || x.kind !== y.kind || Math.abs(x.height - y.height) > 0.5) return false;
  }
  return true;
}
