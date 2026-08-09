"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, PenLine, Minimize2, SpellCheck2, CircleStop, WifiOff, ScrollText } from "lucide-react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { streamAiGenerate, aiErrorMessage, type AiAction } from "@/lib/ai";
import { AI_DOC_CONTEXT_MAX_CHARS, AI_SELECTION_MAX_CHARS } from "@/lib/constants";
import { createStreamInserter } from "./ai-command";

/**
 * The "/ai" popover (plan/08 §1): quick actions + a free-form prompt,
 * anchored at the caret. Streamed output is inserted through
 * createStreamInserter, so it merges/syncs/undoes like human typing.
 *
 * A non-null `unavailable` message renders the explanatory disabled
 * state instead of actions (offline / signed out / not configured) — the
 * one deliberate exception to "works fully offline", clearly explained.
 */

type Phase = "menu" | "streaming" | "error";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800";

export function AiMenu({
  anchor,
  ...rest
}: {
  editor: TiptapEditor;
  docId: string;
  /** Viewport coords of the caret; null = closed. */
  anchor: { x: number; y: number } | null;
  /** When set, AI can't run right now — shown instead of the actions. */
  unavailable: string | null;
  /** Sends the selected text to the summary side panel. */
  onSummarizeSelection: (text: string) => void;
  onClose: () => void;
}) {
  // Remount-on-open (the HfFormatDialog pattern): fresh state each time.
  if (anchor === null) return null;
  return <AiMenuBody anchor={anchor} {...rest} />;
}

function AiMenuBody({
  editor,
  docId,
  anchor,
  unavailable,
  onSummarizeSelection,
  onClose,
}: {
  editor: TiptapEditor;
  docId: string;
  anchor: { x: number; y: number };
  unavailable: string | null;
  onSummarizeSelection: (text: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Escape closes; while streaming it also stops generation (text stays).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      abortRef.current?.abort();
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        abortRef.current?.abort();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const selection = editor.state.selection;
  const hasSelection = !selection.empty;

  const run = async (action: AiAction, customPrompt?: string) => {
    if (editor.isDestroyed) return onClose();
    const { state } = editor;
    const sel = state.selection;
    const selectionText = sel.empty
      ? undefined
      : state.doc.textBetween(sel.from, sel.to, "\n").slice(0, AI_SELECTION_MAX_CHARS);
    // Context = text before the caret/selection, truncated from the START
    // (the model needs what the document was building toward).
    const context = state.doc
      .textBetween(0, sel.from, "\n")
      .slice(-AI_DOC_CONTEXT_MAX_CHARS);

    // Transforms (and custom-with-selection) replace the selection.
    const replacing = action === "concise" || action === "grammar" || (action === "custom" && !sel.empty);
    let insertAt = sel.empty ? sel.from : sel.to;
    if (replacing) {
      editor.chain().deleteRange({ from: sel.from, to: sel.to }).run();
      insertAt = sel.from;
    }

    const inserter = createStreamInserter(editor, insertAt);
    setPhase("streaming");
    abortRef.current = new AbortController();
    const result = await streamAiGenerate(
      docId,
      { action, prompt: customPrompt, selection: selectionText, context },
      (chunk) => inserter.insert(chunk),
      abortRef.current.signal,
    );
    abortRef.current = null;

    if (result.ok || result.aborted) {
      onClose();
      if (!editor.isDestroyed) {
        editor.chain().focus().setTextSelection(Math.min(inserter.end, editor.state.doc.content.size)).run();
      }
    } else {
      setError(aiErrorMessage(result.errorCode));
      setPhase("error");
    }
  };

  // Clamp the popover into the viewport (it opens near the caret).
  const width = 288;
  const left = Math.max(8, Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 1024) - width - 8));
  const top = anchor.y + 6;

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="AI writing help"
      style={{ left, top, width }}
      className="fixed z-40 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {unavailable ? (
        <div className="flex items-start gap-2.5 px-2.5 py-2 text-[13px] text-zinc-500 dark:text-zinc-400">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{unavailable}</span>
        </div>
      ) : phase === "streaming" ? (
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
            <Sparkles className="h-4 w-4 animate-pulse text-violet-500" />
            Writing…
          </span>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <CircleStop className="h-3.5 w-3.5" />
            Stop
          </button>
        </div>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) void run("custom", prompt.trim());
            }}
            className="p-1"
          >
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={hasSelection ? "Ask AI to edit the selection…" : "Ask AI to write…"}
                maxLength={2000}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
              />
            </div>
          </form>
          {phase === "error" && (
            <p className="px-2.5 py-1 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="mt-0.5">
            <button type="button" onClick={() => void run("continue")} className={ITEM}>
              <PenLine className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              Continue writing
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              title={hasSelection ? undefined : "Select some text first"}
              onClick={() => void run("concise")}
              className={ITEM}
            >
              <Minimize2 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              Make more concise
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              title={hasSelection ? undefined : "Select some text first"}
              onClick={() => void run("grammar")}
              className={ITEM}
            >
              <SpellCheck2 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              Fix spelling &amp; grammar
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              title={hasSelection ? undefined : "Select some text first"}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const text = editor.state.doc
                  .textBetween(from, to, "\n")
                  .slice(0, AI_SELECTION_MAX_CHARS);
                onClose();
                if (text.trim()) onSummarizeSelection(text);
              }}
              className={ITEM}
            >
              <ScrollText className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
              Summarize selection
            </button>
          </div>
        </>
      )}
    </div>
  );
}
