"use client";

import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import type * as Y from "yjs";
import type { SyncProvider } from "@/lib/sync/provider";
import { CONTENT_FRAGMENT } from "@/lib/crdt/doc-manager";

/**
 * The Tiptap editor bound to the shared Y.Doc (plan/01 §Layers).
 *
 * - Collaboration replaces StarterKit's undoRedo with y-prosemirror's
 *   undo plugin, which tracks only locally-originated transactions —
 *   this IS the per-user undo behavior from plan/14 §1 (Ctrl+Z never
 *   reverts a collaborator's edit).
 * - CollaborationCaret renders named remote cursors with each user's
 *   deterministic color (plan/14 §2) when a sync provider is active.
 * - immediatelyRender: false — required with SSR to avoid hydration
 *   mismatches; the editor mounts client-side only.
 */

export interface CollabContext {
  provider: SyncProvider;
  user: { name: string; color: string };
}

export function useInkwellEditor(
  ydoc: Y.Doc,
  editable: boolean,
  collab?: CollabContext | null,
): TiptapEditor | null {
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
        ...(collab
          ? [CollaborationCaret.configure({ provider: collab.provider, user: collab.user })]
          : []),
        Highlight,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Start writing…" }),
      ],
      editorProps: {
        attributes: {
          class:
            "tiptap-content flex-1 focus:outline-none min-h-[65vh] px-12 py-10 max-sm:px-6 max-sm:py-6",
          "aria-label": "Document content",
        },
      },
    },
    [ydoc, editable, collab?.provider ?? null],
  );
}

export function EditorSurface({ editor }: { editor: TiptapEditor | null }) {
  return (
    <div className="mx-auto my-6 flex w-full max-w-[820px] flex-1 flex-col rounded-sm bg-white shadow-md ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <EditorContent editor={editor} className="flex flex-1 flex-col" />
    </div>
  );
}
