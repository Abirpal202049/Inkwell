import { Extension } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";

/**
 * Line & paragraph spacing (Docs' ↕ menu) as block-level attributes on
 * paragraphs and headings — like text-align, so they sync through Yjs,
 * survive snapshots, and apply per-paragraph rather than to inline spans.
 *
 * - lineHeight: unitless CSS value ("1", "1.15", …); null falls back to
 *   the .tiptap-content default (1.7).
 * - spaceBefore/spaceAfter: Docs' "Add space before/after paragraph"
 *   toggles; true swaps the default 0.4em margin for EXTRA_SPACE.
 */

export const EXTRA_SPACE = "1em";

const SPACING_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spacing: {
      /** null clears back to the stylesheet default. */
      setLineHeight: (lineHeight: string | null) => ReturnType;
      setSpaceBefore: (on: boolean) => ReturnType;
      setSpaceAfter: (on: boolean) => ReturnType;
    };
  }
}

/** Set attrs on every paragraph/heading touched by the selection. */
function applyToBlocks(attrs: Record<string, unknown>) {
  return ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
    const { from, to } = tr.selection;
    let matched = false;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!SPACING_TYPES.includes(node.type.name)) return;
      matched = true;
      if (dispatch) {
        for (const [key, value] of Object.entries(attrs)) {
          tr.setNodeAttribute(pos, key, value);
        }
      }
    });
    return matched;
  };
}

export const Spacing = Extension.create({
  name: "spacing",

  addGlobalAttributes() {
    return [
      {
        types: SPACING_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (attrs) =>
              attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
          },
          spaceBefore: {
            default: false,
            parseHTML: (el) => el.style.marginTop === EXTRA_SPACE,
            renderHTML: (attrs) =>
              attrs.spaceBefore ? { style: `margin-top: ${EXTRA_SPACE}` } : {},
          },
          spaceAfter: {
            default: false,
            parseHTML: (el) => el.style.marginBottom === EXTRA_SPACE,
            renderHTML: (attrs) =>
              attrs.spaceAfter ? { style: `margin-bottom: ${EXTRA_SPACE}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight: (lineHeight) => applyToBlocks({ lineHeight }),
      setSpaceBefore: (on) => applyToBlocks({ spaceBefore: on }),
      setSpaceAfter: (on) => applyToBlocks({ spaceAfter: on }),
    };
  },
});
