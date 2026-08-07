import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { PRESENCE_PALETTE } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Deterministic user color (plan/14 §2): same user -> same color, for
 * every viewer, in every session. FNV-1a over the userId.
 */
export function presenceColor(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PRESENCE_PALETTE[(hash >>> 0) % PRESENCE_PALETTE.length];
}

/** "3 minutes ago" style relative time for the dashboard. */
export function relativeTime(iso: string | number | Date): string {
  const then = new Date(iso).getTime();
  const diffS = Math.round((Date.now() - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const table: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of table) {
    if (Math.abs(diffS) >= secs) return rtf.format(-Math.round(diffS / secs), unit);
  }
  return "just now";
}
