"use client";

import { useEffect, useRef, useState } from "react";
import { X, BookmarkPlus } from "lucide-react";

/**
 * Small Docs-style dialog replacing the native window.prompt for
 * "Save version": optional label input, Enter/Save to confirm,
 * Escape/Cancel/backdrop to dismiss.
 */
export function SaveVersionDialog({
  open,
  onClose,
  onSave,
  aiHint = false,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (label?: string) => void;
  /** AI is configured: an empty label will be auto-generated (plan/08 §3). */
  aiHint?: boolean;
}) {
  const [label, setLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      // Focus after the dialog mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    onClose();
    onSave(label.trim() || undefined);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save version"
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BookmarkPlus className="h-5 w-5 text-blue-600" />
            Save version
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="version-label" className="mb-1 block text-sm text-zinc-600 dark:text-zinc-300">
            Version label <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          <input
            id="version-label"
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. First draft"
            maxLength={120}
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
          {aiHint && (
            <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              Leave blank and AI will label it from what changed.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
