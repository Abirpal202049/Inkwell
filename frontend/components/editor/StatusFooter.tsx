"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { WORD_COUNT_DEBOUNCE_MS } from "@/lib/constants";

/**
 * Word/character count (plan/14 §8) — recomputed on a debounce, never per
 * keystroke. Click toggles reading-time estimate (~200 wpm). When the
 * pagination plugin reports page info, a Docs-style "Page X of N" leads.
 */
export function StatusFooter({
  editor,
  pageInfo,
}: {
  editor: Editor | null;
  pageInfo?: { page: number; pages: number };
}) {
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [showReadingTime, setShowReadingTime] = useState(false);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const recompute = () => {
      const text = editor.getText();
      const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
      setStats({ words, chars: text.length });
    };
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(recompute, WORD_COUNT_DEBOUNCE_MS);
    };
    recompute();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);

  const readingMinutes = Math.max(1, Math.round(stats.words / 200));

  return (
    <button
      type="button"
      onClick={() => setShowReadingTime((v) => !v)}
      className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      aria-label="Toggle document statistics"
    >
      {showReadingTime
        ? `~${readingMinutes} min read`
        : `${pageInfo ? `Page ${pageInfo.page} of ${pageInfo.pages} · ` : ""}${stats.words} words · ${stats.chars} characters`}
    </button>
  );
}
