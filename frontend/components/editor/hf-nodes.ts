"use client";

import { Node } from "@tiptap/react";

/**
 * Inline page-number atoms for header/footer segments (plan/16 §4.5).
 * The NODE is shared through Yjs like any other content; the DIGIT it
 * shows is a purely local projection — every band stamps its own value
 * (stampPageNumbers), so page renumbering causes zero CRDT churn and can
 * never feed back into pagination. The node view ignores those DOM
 * mutations so ProseMirror doesn't try to reconcile them.
 */
function pageAtom(name: string, attr: string) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,

    parseHTML() {
      return [{ tag: `span[${attr}]` }];
    },

    renderHTML() {
      // Static fallback (mirrors, clipboard); bands overwrite the digit.
      return ["span", { [attr]: "" }, "1"];
    },

    addNodeView() {
      return () => {
        const dom = document.createElement("span");
        dom.setAttribute(attr, "");
        dom.textContent = "1";
        return { dom, ignoreMutation: () => true };
      };
    },
  });
}

export const PageNumber = pageAtom("pageNumber", "data-hf-pagenum");
export const PageCount = pageAtom("pageCount", "data-hf-pagecount");

/** Write the per-page values into a rendered segment (mirror or live). */
export function stampPageNumbers(root: ParentNode, page: number, pages: number): void {
  for (const el of root.querySelectorAll("[data-hf-pagenum]")) el.textContent = String(page);
  for (const el of root.querySelectorAll("[data-hf-pagecount]")) el.textContent = String(pages);
}
