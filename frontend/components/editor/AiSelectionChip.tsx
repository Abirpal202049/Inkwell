"use client";

import { useEditorState, type Editor as TiptapEditor } from "@tiptap/react";
import { Sparkles } from "lucide-react";

/**
 * Floating "Ask AI" chip that appears automatically under any text
 * selection — the zero-training entry point to AI writing (plan/08):
 * users discover the feature the moment they select text, no shortcut
 * knowledge needed. Clicking opens the same menu as "/ai" / Ctrl+J.
 */
export function AiSelectionChip({
  editor,
  visible,
  scrollTop,
  onOpen,
}: {
  editor: TiptapEditor;
  /** Gate from the shell: AI ready + editable + online + menu closed. */
  visible: boolean;
  /** Scroll offset of the document area — re-renders keep the chip glued
   *  to the selection while scrolling (coords are re-read per render). */
  scrollTop: number;
  onOpen: () => void;
}) {
  // Subscribe to just the selection bounds, not every transaction detail.
  const sel = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed) return null;
      const { empty, to } = e.state.selection;
      return { empty, to };
    },
  });
  void scrollTop;

  if (!visible || !sel || sel.empty) return null;

  let coords: { left: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(sel.to);
  } catch {
    return null; // position momentarily out of range mid-transaction
  }
  // Off-viewport selections (scrolled away) shouldn't leave a floating chip.
  if (coords.bottom < 0 || coords.bottom > window.innerHeight) return null;
  const left = Math.max(8, Math.min(coords.left, window.innerWidth - 120));

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the selection
      onClick={onOpen}
      style={{ left, top: coords.bottom + 8 }}
      className="fixed z-30 flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1 text-[13px] font-medium text-violet-700 shadow-md hover:bg-violet-50 dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-zinc-800"
    >
      <Sparkles className="h-3.5 w-3.5" />
      Ask AI
    </button>
  );
}
