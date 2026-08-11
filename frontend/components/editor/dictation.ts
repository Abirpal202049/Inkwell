import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Dictation support (speech-to-text).
 *
 * Interim recognition results are shown as a WIDGET DECORATION at the
 * caret — never inserted into the document. The speech API revises
 * interim text constantly; inserting it would broadcast every revision
 * to collaborators over Yjs and pollute undo history. Only finalized
 * results become real transactions (via insertDictatedText), which then
 * sync/version/undo exactly like typing.
 */

export const dictationPreviewKey = new PluginKey<string | null>("dictationPreview");

/** Show `text` as ghost text at the caret; null clears it. */
export function setDictationPreview(editor: TiptapEditor, text: string | null): void {
  if (editor.isDestroyed) return;
  if (!dictationPreviewKey.get(editor.state)) return; // extension not registered
  const current = dictationPreviewKey.getState(editor.state) ?? null;
  if (current === (text || null)) return;
  editor.view.dispatch(editor.state.tr.setMeta(dictationPreviewKey, { text: text || null }));
}

export const Dictation = Extension.create({
  name: "dictation",

  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: dictationPreviewKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(dictationPreviewKey) as { text: string | null } | undefined;
            if (meta !== undefined) return meta.text;
            return value;
          },
        },
        props: {
          // The widget is rebuilt per state read — cheap for one node,
          // and it keeps the ghost glued to the (moving) caret.
          decorations(state) {
            const text = dictationPreviewKey.getState(state);
            if (!text) return null;
            const widget = Decoration.widget(
              state.selection.head,
              () => {
                const span = document.createElement("span");
                span.className = "dictation-ghost";
                span.textContent = text;
                return span;
              },
              { side: 1, ignoreSelection: true },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },
});

/**
 * Insert a finalized transcript segment at the caret as one ordinary
 * transaction (replacing any selection). Newline runs become paragraph
 * breaks, the ai-command streaming pattern. With Collaboration active it
 * syncs and undoes like human typing. Returns the inserted range, which
 * the dictation session tracks for the "tidy with AI" pass.
 */
export function insertDictatedText(
  editor: TiptapEditor,
  text: string,
): { from: number; to: number } | null {
  if (editor.isDestroyed || !text) return null;
  let tr = editor.state.tr;
  if (!tr.selection.empty) tr = tr.deleteSelection();
  const from = tr.selection.from;
  let pos = from;
  text.split(/\n+/).forEach((part, i) => {
    if (i > 0) {
      tr = tr.split(pos);
      pos += 2; // past the close/open tokens the split inserted
    }
    if (part) {
      tr = tr.insertText(part, pos);
      pos += part.length;
    }
  });
  tr = tr.setSelection(TextSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
  return { from, to: pos };
}

/** Tail of the text right before the caret — feeds formatSegment. */
export function textBeforeCaret(editor: TiptapEditor, maxChars = 80): string {
  const { $from } = editor.state.selection;
  return $from.parent.textBetween(Math.max(0, $from.parentOffset - maxChars), $from.parentOffset);
}
