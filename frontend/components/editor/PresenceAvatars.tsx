"use client";

import { useEffect, useState } from "react";
import type { SyncProvider } from "@/lib/sync/provider";

/**
 * Live collaborator avatar stack (plan/14 §2), fed by Yjs Awareness.
 * Shows up to 4 avatars + a "+N" overflow chip on narrow screens.
 */

interface PresentUser {
  clientId: number;
  name: string;
  color: string;
  image?: string | null;
  /** Docs-style anonymous-animal avatar for signed-out viewers. */
  emoji?: string | null;
}

export function PresenceAvatars({ provider }: { provider: SyncProvider | null }) {
  const [users, setUsers] = useState<PresentUser[]>([]);

  useEffect(() => {
    if (!provider) {
      setUsers([]);
      return;
    }
    const awareness = provider.awareness;
    const recompute = () => {
      const next: PresentUser[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue; // remote only
        const user = (
          state as {
            user?: { name?: string; color?: string; image?: string | null; emoji?: string | null };
          }
        ).user;
        if (!user?.name) continue;
        next.push({
          clientId,
          name: user.name,
          color: user.color ?? "#71717a",
          image: user.image,
          emoji: user.emoji,
        });
      }
      setUsers(next);
    };
    recompute();
    awareness.on("change", recompute);
    return () => awareness.off("change", recompute);
  }, [provider]);

  if (users.length === 0) return null;

  const shown = users.slice(0, 4);
  const overflow = users.length - shown.length;

  return (
    <div className="flex items-center -space-x-2" aria-label={`${users.length} collaborators online`}>
      {shown.map((u) => (
        <span
          key={u.clientId}
          title={u.name}
          className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 bg-white text-xs font-medium dark:bg-zinc-800"
          style={{ borderColor: u.color }}
        >
          {u.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- tiny external avatar, next/image overhead not warranted
            <img
              src={u.image}
              alt={u.name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : u.emoji ? (
            <span aria-hidden className="text-sm leading-none">{u.emoji}</span>
          ) : (
            u.name.slice(0, 1).toUpperCase()
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-300 bg-zinc-100 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          +{overflow}
        </span>
      )}
    </div>
  );
}
