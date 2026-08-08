import { describe, expect, it } from "vitest";
import {
  paginate,
  breaksEqual,
  type BlockBox,
  type PageGeometry,
} from "../components/editor/pagination-core";

/**
 * Geometry used throughout: stride = 1020, usable = 800,
 * contentTop(k) = 1020k + 100, limit(k) = 1020k + 900.
 */
const GEO: PageGeometry = { pageHeight: 1000, gap: 20, marginTop: 100, marginBottom: 100 };
const contentTop = (k: number) => k * 1020 + 100;

interface Spec {
  h: number;
  mt?: number;
  mb?: number;
  /** Uniform line height — makes the block a splittable textblock. */
  lineH?: number;
  children?: Spec[];
}

let posCounter = 0;

/**
 * Lay out specs the way CSS block flow would in natural coordinates:
 * first block at containerTop + its margin-top, then collapsed margins
 * (max of adjacent margins) between siblings. Block N gets pos 100·N;
 * line L of a block gets pos blockPos + 1 + L.
 */
function build(specs: Spec[], containerTop: number): BlockBox[] {
  const out: BlockBox[] = [];
  let prevBottom: number | null = null;
  let prevMb = 0;
  for (const s of specs) {
    const mt = s.mt ?? 0;
    const mb = s.mb ?? 0;
    const top = prevBottom == null ? containerTop + mt : prevBottom + Math.max(prevMb, mt);
    const pos = ++posCounter * 100;
    const box: BlockBox = {
      pos,
      top,
      bottom: top + s.h,
      marginTop: mt,
      marginBottom: mb,
      prevBottom,
      prevMarginBottom: prevMb,
    };
    if (s.children) {
      box.children = build(s.children, top);
    } else if (s.lineH) {
      const lineH = s.lineH;
      const n = Math.round(s.h / lineH);
      const lines = Array.from({ length: n }, (_, j) => ({
        top: top + j * lineH,
        bottom: top + (j + 1) * lineH,
      }));
      box.lines = () => lines;
      box.lineStartPos = (line) => pos + 1 + Math.round((line.top - top) / lineH);
    }
    out.push(box);
    prevBottom = box.bottom;
    prevMb = mb;
  }
  return out;
}

function layout(specs: Spec[]): BlockBox[] {
  posCounter = 0;
  return build(specs, GEO.marginTop);
}

describe("paginate", () => {
  it("returns a single page for an empty document", () => {
    expect(paginate([], GEO)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("returns a single page when content fits", () => {
    const blocks = layout([{ h: 300 }, { h: 400, mt: 10 }]);
    expect(paginate(blocks, GEO)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("does not break on a block ending exactly at the page limit", () => {
    // bottom = 100 + 800 = 900 = limit(0); EPS keeps it on page 1
    const blocks = layout([{ h: 800 }]);
    expect(paginate(blocks, GEO)).toEqual({ breaks: [], pageCount: 1 });
  });

  it("pushes a crossing block to the next page with margin-aware spacing", () => {
    // A: 100..900 (mb 8); B: mt 6, collapsed gap max(8,6)=8 → 908..1108, crosses.
    const blocks = layout([{ h: 800, mb: 8 }, { h: 200, mt: 6 }]);
    const plan = paginate(blocks, GEO);
    expect(plan.pageCount).toBe(2);
    expect(plan.breaks).toHaveLength(1);
    const brk = plan.breaks[0]!;
    expect(brk.kind).toBe("block");
    expect(brk.pos).toBe(200);
    // Spacer stops the margins collapsing: 900 + 8 + h + 6 must equal contentTop(1).
    expect(900 + 8 + brk.height + 6).toBeCloseTo(contentTop(1), 5);
    expect(brk.height).toBeCloseTo(206, 5);
  });

  it("pushes a whole block when its first line crosses mid-page", () => {
    // B starts at 880 and its first line (50px) crosses 900 → whole push.
    const blocks = layout([{ h: 780 }, { h: 100, lineH: 50 }]);
    const plan = paginate(blocks, GEO);
    expect(plan.pageCount).toBe(2);
    expect(plan.breaks).toEqual([{ pos: 200, height: contentTop(1) - 880, kind: "block" }]);
  });

  it("splits a page-top paragraph across pages at line boundaries", () => {
    // 100 lines of 20px starting at the top of page 1 (2000px tall).
    const blocks = layout([{ h: 2000, lineH: 20 }]);
    const plan = paginate(blocks, GEO);
    expect(plan.pageCount).toBe(3);
    expect(plan.breaks).toHaveLength(2);
    // Page 1 keeps lines 0..39 (800px of usable height); line 40 (top 900)
    // moves to contentTop(1) = 1120 → spacer 220. Same shape on page 2.
    expect(plan.breaks[0]).toEqual({ pos: 100 + 1 + 40, height: 220, kind: "line" });
    expect(plan.breaks[1]).toEqual({ pos: 100 + 1 + 80, height: 220, kind: "line" });
  });

  it("splits a paragraph that starts mid-page and is taller than a page", () => {
    // A fills 100..700; B (mt 0) is 1200px of 20px lines → taller than
    // usable, so it must split in place, not be pushed.
    const blocks = layout([{ h: 600 }, { h: 1200, lineH: 20 }]);
    const plan = paginate(blocks, GEO);
    // B: 700..1900. Boundary 900 falls inside line 10 (900..920)? Line
    // tops are 700+20j; first line with bottom > 901 is j=10 (bottom 920).
    expect(plan.breaks[0]).toEqual({ pos: 200 + 1 + 10, height: contentTop(1) - 900, kind: "line" });
    // Remainder: lines resume at 1120; they still overrun limit(1) = 1920,
    // so a second split lands line 50 (natural top 1700) at contentTop(2).
    expect(plan.breaks).toHaveLength(2);
    expect(plan.breaks[1]).toEqual({ pos: 200 + 1 + 50, height: contentTop(2) - 1920, kind: "line" });
    expect(plan.pageCount).toBe(3);
  });

  it("recurses into containers and pushes the crossing child", () => {
    // List 100..1000 (9 items × 100px): taller than nothing pushable as a
    // whole once at page top? It starts at page top, so children paginate:
    // item 9 (900..1000) crosses and is pushed to contentTop(1).
    const blocks = layout([{ h: 900, children: Array.from({ length: 9 }, () => ({ h: 100 })) }]);
    const plan = paginate(blocks, GEO);
    expect(plan.pageCount).toBe(2);
    expect(plan.breaks).toHaveLength(1);
    const brk = plan.breaks[0]!;
    expect(brk.kind).toBe("block");
    // prevBottom (item 8) = 900, margins 0 → spacer = 1120 − 900 = 220.
    expect(brk.height).toBe(220);
  });

  it("lets an unsplittable oversized block bleed and resumes below it", () => {
    // A: 100..600. B: unsplittable 1500px (no lines()) starting at 600:
    // taller than usable → bleeds across the gap; C paginates against the
    // page that contains B's bottom (2100 → page 2).
    const blocks = layout([{ h: 500 }, { h: 1500 }, { h: 100 }]);
    const plan = paginate(blocks, GEO);
    expect(plan.breaks).toHaveLength(0);
    expect(plan.pageCount).toBe(3);
  });

  it("gives up gracefully on a single line taller than a page", () => {
    // One line spanning 100..1300 at page top: cannot move, cannot split.
    posCounter = 0;
    const block: BlockBox = {
      pos: 100,
      top: 100,
      bottom: 1320,
      marginTop: 0,
      marginBottom: 0,
      prevBottom: null,
      prevMarginBottom: 0,
      lines: () => [
        { top: 100, bottom: 1300 },
        { top: 1300, bottom: 1320 },
      ],
      lineStartPos: () => 150,
    };
    // Second line target = contentTop(1) = 1120 < its natural top 1300 →
    // negative spacer → bail; the block bleeds onto page 2.
    const plan = paginate([block], GEO);
    expect(plan.breaks).toHaveLength(0);
    expect(plan.pageCount).toBe(2);
  });

  it("splits after a giant first line when the rest can reach the next page", () => {
    posCounter = 0;
    const block: BlockBox = {
      pos: 100,
      top: 100,
      bottom: 970,
      marginTop: 0,
      marginBottom: 0,
      prevBottom: null,
      prevMarginBottom: 0,
      lines: () => [
        { top: 100, bottom: 950 },
        { top: 950, bottom: 970 },
      ],
      lineStartPos: (line) => (line.top === 950 ? 142 : 101),
    };
    const plan = paginate([block], GEO);
    expect(plan.breaks).toEqual([{ pos: 142, height: contentTop(1) - 950, kind: "line" }]);
    expect(plan.pageCount).toBe(2);
  });

  it("accumulates shift across multiple pushed blocks", () => {
    // A 100..800 fits. B 810..1510 pushed to 1120 (spacer 310 = shift).
    // C natural 1520..2220, live 1830..2530 → pushed to contentTop(2).
    const blocks = layout([{ h: 700 }, { h: 700, mt: 10 }, { h: 700, mt: 10 }]);
    const plan = paginate(blocks, GEO);
    expect(plan.pageCount).toBe(3);
    expect(plan.breaks).toHaveLength(2);
    expect(plan.breaks[0]).toEqual({ pos: 200, height: contentTop(1) - (800 + 10), kind: "block" });
    // B's natural bottom 1510 + shift 310 = live 1820; C's spacer closes
    // the distance to contentTop(2) = 2140 through C's 10px margin-top.
    expect(plan.breaks[1]).toEqual({
      pos: 300,
      height: contentTop(2) - (1510 + 310 + 0 + 10),
      kind: "block",
    });
  });

  it("returns no breaks for degenerate geometry", () => {
    const blocks = layout([{ h: 5000, lineH: 20 }]);
    expect(paginate(blocks, { pageHeight: 100, gap: 0, marginTop: 60, marginBottom: 60 })).toEqual({
      breaks: [],
      pageCount: 1,
    });
  });
});

describe("breaksEqual", () => {
  it("compares position, kind, and height with sub-pixel tolerance", () => {
    const a = [{ pos: 5, height: 100, kind: "line" as const }];
    expect(breaksEqual(a, [{ pos: 5, height: 100.4, kind: "line" }])).toBe(true);
    expect(breaksEqual(a, [{ pos: 5, height: 101, kind: "line" }])).toBe(false);
    expect(breaksEqual(a, [{ pos: 6, height: 100, kind: "line" }])).toBe(false);
    expect(breaksEqual(a, [{ pos: 5, height: 100, kind: "block" }])).toBe(false);
    expect(breaksEqual(a, [])).toBe(false);
  });
});
