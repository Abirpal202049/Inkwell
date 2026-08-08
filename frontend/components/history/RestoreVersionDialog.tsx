"use client";

import { useEffect } from "react";
import { X, RotateCcw } from "lucide-react";

/**
 * Docs-style confirmation dialog replacing the native window.confirm for
 * "Restore this version": Enter/Restore to confirm, Escape/Cancel/backdrop
 * to dismiss. Restoring is non-destructive — the current state stays in
 * history — and the copy says so.
 */
export function RestoreVersionDialog({
  open,
  versionLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  versionLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = () => {
    onClose();
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore version"
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RotateCcw className="h-5 w-5 text-blue-600" />
            Restore this version?
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

        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          The document will go back to{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {versionLabel ?? "this version"}
          </span>
          . Your current state is kept in history, so nothing is lost.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
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
              autoFocus
              className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Restore
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
