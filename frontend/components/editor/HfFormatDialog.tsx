"use client";

import { useEffect, useState } from "react";
import { X, PanelTop } from "lucide-react";
import type { HfOptions, HfSettings } from "./hf";

/**
 * Docs' "Header format" dialog (plan/16 §4.4): header/footer distances
 * from the page edge (in inches, like the rulers) plus the layout
 * variants. Applies as one Yjs transaction via useHfSettings.setOptions.
 */

const PX_PER_INCH = 96;

function toInches(px: number): string {
  return (Math.round((px / PX_PER_INCH) * 100) / 100).toString();
}

function fromInches(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * PX_PER_INCH) : fallback;
}

export function HfFormatDialog({
  open,
  settings,
  onClose,
  onApply,
}: {
  open: boolean;
  settings: HfSettings;
  onClose: () => void;
  onApply: (options: HfOptions) => void;
}) {
  // Remount per open so the fields initialize from the live settings
  // without any state-syncing effects.
  if (!open) return null;
  return <HfFormatDialogInner settings={settings} onClose={onClose} onApply={onApply} />;
}

function HfFormatDialogInner({
  settings,
  onClose,
  onApply,
}: {
  settings: HfSettings;
  onClose: () => void;
  onApply: (options: HfOptions) => void;
}) {
  const [headerIn, setHeaderIn] = useState(() => toInches(settings.headerMargin));
  const [footerIn, setFooterIn] = useState(() => toInches(settings.footerMargin));
  const [diffFirst, setDiffFirst] = useState(settings.diffFirstPage);
  const [diffOddEven, setDiffOddEven] = useState(settings.diffOddEven);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    onClose();
    onApply({
      headerMargin: fromInches(headerIn, settings.headerMargin),
      footerMargin: fromInches(footerIn, settings.footerMargin),
      diffFirstPage: diffFirst,
      diffOddEven: diffOddEven,
    });
  };

  const field =
    "w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Header and footer format"
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            <PanelTop className="h-5 w-5 text-blue-600" />
            Headers &amp; footers
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Margins are measured from the page edge (inches).
          </p>
          <label className="flex items-center justify-between gap-3">
            Header margin
            <input
              type="number"
              step="0.05"
              min="0.125"
              max="2.5"
              value={headerIn}
              onChange={(e) => setHeaderIn(e.target.value)}
              className={field}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            Footer margin
            <input
              type="number"
              step="0.05"
              min="0.125"
              max="2.5"
              value={footerIn}
              onChange={(e) => setFooterIn(e.target.value)}
              className={field}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={diffFirst}
              onChange={(e) => setDiffFirst(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Different first page
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={diffOddEven}
              onChange={(e) => setDiffOddEven(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
            Different odd &amp; even pages
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
