import { Extension, InputRule } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as PmDomParser } from "@tiptap/pm/model";
import { markdownToHtml, hasMarkdownSyntax } from "./markdown";

/**
 * AI writing entry points + provenance marking (plan/08 §1).
 *
 * - Typing "/ai" (or Ctrl/Cmd+J) opens the AI menu at the caret. The
 *   typed trigger text is removed, exactly like Docs' "@" menu.
 * - Streamed AI output is tracked with inline DECORATIONS, not marks:
 *   provenance display is per-viewer UI state and must not become part
 *   of the synced document. The highlight clears on the user's next
 *   keystroke (plan/08: "visually tagged until the next keystroke").
 */

export const aiHighlightKey = new PluginKey<DecorationSet>("aiHighlight");

interface AiHighlightMeta {
  /** Replace the highlight with this range (one insertion active at a time). */
  set?: { from: number; to: number };
  clear?: boolean;
}

export interface AiCommandOptions {
  /** Opens the AI menu. Null (e.g. header/footer editors) disables the triggers. */
  onTrigger: (() => void) | null;
}

export const AiCommand = Extension.create<AiCommandOptions>({
  name: "aiCommand",

  addOptions() {
    return { onTrigger: null };
  },

  addInputRules() {
    if (!this.options.onTrigger) return [];
    return [
      new InputRule({
        find: /\/ai$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).run();
          // After the deletion transaction settles, open the menu.
          queueMicrotask(() => this.options.onTrigger?.());
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-j": () => {
        if (!this.options.onTrigger) return false;
        this.options.onTrigger();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: aiHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, deco) {
            const meta = tr.getMeta(aiHighlightKey) as AiHighlightMeta | undefined;
            if (meta?.clear) return DecorationSet.empty;
            if (meta?.set) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.set.from, meta.set.to, { class: "ai-generated" }),
              ]);
            }
            return deco.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return aiHighlightKey.getState(state);
          },
          handleDOMEvents: {
            // First keystroke after an AI insertion clears the highlight.
            keydown: (view) => {
              const deco = aiHighlightKey.getState(view.state);
              if (deco && deco.find().length > 0) {
                view.dispatch(view.state.tr.setMeta(aiHighlightKey, { clear: true }));
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Inserts streamed plain-text chunks at a moving position as ordinary
 * editor transactions — with Collaboration active each dispatch becomes a
 * normal Yjs update: synced, offline-queued, versioned and undoable like
 * human typing (plan/08 §1). Newline runs become paragraph breaks.
 *
 * The model writes in the toolbar's Markdown subset (see WRITER_SYSTEM
 * on the backend). Text streams in raw for live feedback; `finish()`
 * then replaces the inserted range with the parsed rich content — real
 * bold/heading/list nodes, so the toolbar reflects them and no Markdown
 * syntax survives in the document. Call it on completion AND on abort
 * (partial output parses fine; unclosed markers stay literal).
 */
export function createStreamInserter(editor: TiptapEditor, startPos: number) {
  const start = startPos;
  let pos = startPos;
  let raw = "";

  return {
    insert(chunk: string) {
      if (editor.isDestroyed) return;
      raw += chunk;
      let tr = editor.state.tr;
      const parts = chunk.split(/\n+/);
      parts.forEach((part, i) => {
        if (i > 0) {
          tr = tr.split(pos);
          pos += 2; // past the close/open tokens the split inserted
        }
        if (part) {
          tr = tr.insertText(part, pos);
          pos += part.length;
        }
      });
      tr.setMeta(aiHighlightKey, { set: { from: start, to: pos } });
      editor.view.dispatch(tr);
    },
    /** Swap the raw streamed text for its rich-formatted parse. */
    finish() {
      if (editor.isDestroyed || pos === start || !hasMarkdownSyntax(raw)) return;
      try {
        // Parse against the schema and apply ONE plain replace step.
        // (Not insertContentAt: its list auto-join heuristic throws
        // "Cannot join orderedList onto paragraph" when the inserted
        // list's neighbor is one of the raw streamed paragraphs.)
        const el = document.createElement("div");
        el.innerHTML = markdownToHtml(raw);
        const parsed = PmDomParser.fromSchema(editor.state.schema).parse(el);
        const tr = editor.state.tr.replaceWith(start, pos, parsed.content);
        const end = tr.mapping.map(pos);
        tr.setMeta(aiHighlightKey, { set: { from: start, to: end } });
        editor.view.dispatch(tr);
        pos = end;
      } catch (err) {
        // Formatting is best-effort: on any parse/fit failure the raw
        // streamed text simply stays in place.
        console.warn("[ai] could not apply rich formatting:", err);
      }
    },
    /** Position just after everything inserted so far. */
    get end() {
      return pos;
    },
  };
}
