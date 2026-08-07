"use client";

import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type * as Y from "yjs";
import { CONTENT_FRAGMENT } from "@/lib/crdt/doc-manager";

/**
 * The Tiptap editor bound to the shared Y.Doc (plan/01 §Layers).
 *
 * - Collaboration replaces StarterKit's undoRedo with y-prosemirror's
 *   undo plugin, which tracks only locally-originated transactions —
 *   this IS the per-user undo behavior from plan/14 §1 (Ctrl+Z never
 *   reverts a collaborator's edit).
 * - immediatelyRender: false — required with SSR to avoid hydration
 *   mismatches; the editor mounts client-side only.
 */
export function useInkwellEditor(ydoc: Y.Doc, editable: boolean): TiptapEditor | null {
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
        Highlight,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Start writing…" }),
      ],
      editorProps: {
        attributes: {
          class:
            "tiptap-content focus:outline-none min-h-[65vh] px-12 py-10 max-sm:px-6 max-sm:py-6",
          "aria-label": "Document content",
        },
      },
    },
    [ydoc, editable],
  );
}

export function EditorSurface({ editor }: { editor: TiptapEditor | null }) {
  return (
    <div className="mx-auto my-6 w-full max-w-[820px] rounded-sm bg-white shadow-md ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <EditorContent editor={editor} />
    </div>
  );
}
