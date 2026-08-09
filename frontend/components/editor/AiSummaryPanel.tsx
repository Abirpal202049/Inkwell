"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, RefreshCw, CircleStop } from "lucide-react";
import { streamAiSummary, aiErrorMessage } from "@/lib/ai";

/**
 * Summary side panel (plan/08 §2): the whole document, or just the
 * selected passage when `target.selection` is set. A read-only op —
 * viewers can use it too. The summary streams in and lives only in
 * component state; closing the panel discards it (remount-on-open, and
 * the key remounts when the target changes).
 */
export interface SummaryTarget {
  /** Present = summarize this passage; absent = whole document. */
  selection?: string;
}

export function AiSummaryPanel({
  docId,
  target,
  onClose,
}: {
  docId: string;
  /** Null = closed. */
  target: SummaryTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  return (
    <SummaryBody
      key={target.selection ?? "@doc"}
      docId={docId}
      selection={target.selection}
      onClose={onClose}
    />
  );
}

function SummaryBody({
  docId,
  selection,
  onClose,
}: {
  docId: string;
  selection?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"streaming" | "done" | "error">("streaming");
  const [error, setError] = useState("");
  /** Bumping this re-runs the stream effect (Regenerate). */
  const [runId, setRunId] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      const result = await streamAiSummary(
        docId,
        (chunk) => setText((prev) => prev + chunk),
        controller.signal,
        selection,
      );
      if (controller.signal.aborted) return; // closed or superseded
      if (result.ok) {
        setPhase("done");
      } else {
        setError(
          result.errorCode === "CONFLICT"
            ? "There's nothing to summarize yet — write something first."
            : aiErrorMessage(result.errorCode),
        );
        setPhase("error");
      }
    })();
    return () => controller.abort();
  }, [docId, selection, runId]);

  const regenerate = () => {
    setText("");
    setError("");
    setPhase("streaming");
    setRunId((n) => n + 1);
  };

  const stop = () => {
    abortRef.current?.abort();
    setPhase("done");
  };

  return (
    <aside
      aria-label="Document summary"
      className="flex w-72 shrink-0 flex-col border-l border-[#dadce0] bg-white max-md:hidden print:hidden dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {selection ? "Selection summary" : "Summary"}
        </h2>
        <div className="flex items-center gap-1">
          {phase === "streaming" ? (
            <button
              type="button"
              onClick={stop}
              title="Stop"
              aria-label="Stop summarizing"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <CircleStop className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={regenerate}
              title="Regenerate summary"
              aria-label="Regenerate summary"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="doc-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {phase === "error" ? (
          <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
        ) : text ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-200">
            {text}
            {phase === "streaming" && (
              <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-violet-500 align-middle" />
            )}
          </p>
        ) : (
          <p className="animate-pulse text-[13px] text-zinc-400 dark:text-zinc-500">
            Reading the document…
          </p>
        )}
      </div>
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        AI-generated — may be inaccurate.
      </p>
    </aside>
  );
}
