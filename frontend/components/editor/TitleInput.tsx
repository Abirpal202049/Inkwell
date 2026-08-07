"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { localOrigin } from "@/lib/crdt/origins";
import { upsertLocalDoc } from "@/lib/local/meta-store";
import { DEFAULT_DOC_TITLE, TITLE_MAX_LENGTH, TITLE_MIRROR_DEBOUNCE_MS } from "@/lib/constants";

/**
 * Inline title editing (plan/14 §3). The title's source of truth is
 * Y.Map('meta').title so renames work offline and merge like content;
 * this component mirrors it (debounced) into the local meta store so the
 * dashboard list stays fresh.
 */
export function TitleInput({
  docId,
  meta,
  ydoc,
  autoFocus,
}: {
  docId: string;
  meta: Y.Map<unknown>;
  ydoc: Y.Doc;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState<string>(() => (meta.get("title") as string) ?? DEFAULT_DOC_TITLE);
  const editingRef = useRef(false);
  const beforeEditRef = useRef(value);
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remote/local Y.Map changes -> input (skip while the user is typing in it).
  useEffect(() => {
    const observer = () => {
      if (editingRef.current) return;
      setValue((meta.get("title") as string) ?? DEFAULT_DOC_TITLE);
    };
    observer();
    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [meta]);

  const commit = (next: string) => {
    const title = next.trim().slice(0, TITLE_MAX_LENGTH) || DEFAULT_DOC_TITLE;
    setValue(title);
    if (title !== meta.get("title")) {
      ydoc.transact(() => meta.set("title", title), localOrigin);
    }
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    mirrorTimer.current = setTimeout(() => {
      void upsertLocalDoc(docId, { title, updatedAt: Date.now() });
    }, TITLE_MIRROR_DEBOUNCE_MS);
  };

  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onFocus={(e) => {
        editingRef.current = true;
        beforeEditRef.current = value;
        if (autoFocus) e.currentTarget.select();
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        editingRef.current = false;
        commit(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur(); // commit
        if (e.key === "Escape") {
          setValue(beforeEditRef.current); // revert, Docs behavior
          editingRef.current = false;
          e.currentTarget.blur();
        }
      }}
      aria-label="Document title"
      maxLength={TITLE_MAX_LENGTH}
      className="w-full max-w-md truncate rounded px-2 py-1 text-lg font-medium text-zinc-900 outline-none hover:bg-zinc-100 focus:bg-white focus:ring-2 focus:ring-blue-500 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:focus:bg-zinc-900"
    />
  );
}
