"use client";

import { Cloud, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sync state machine display (plan/07 §Connection Status Indicator).
 * Stage B: the sync engine doesn't exist yet, so callers pass "offline";
 * the component contract (all four states + aria-live) is final now so
 * later stages only change the input, not the UI.
 */
export type ConnectionState = "synced" | "syncing" | "offline" | "error";

const CONFIG: Record<
  ConnectionState,
  { label: string; className: string; Icon: typeof Cloud }
> = {
  synced: {
    label: "All changes saved",
    className: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950",
    Icon: Cloud,
  },
  syncing: {
    label: "Syncing…",
    className: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950",
    Icon: Loader2,
  },
  offline: {
    label: "Offline — saved on this device",
    className: "text-zinc-600 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800",
    Icon: CloudOff,
  },
  error: {
    label: "Sync issue — retrying",
    className: "text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950",
    Icon: AlertTriangle,
  },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const { label, className, Icon } = CONFIG[state];
  return (
    <div
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      <Icon className={cn("h-3 w-3", state === "syncing" && "animate-spin")} aria-hidden />
      {label}
    </div>
  );
}
