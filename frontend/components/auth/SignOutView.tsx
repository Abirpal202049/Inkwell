"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, LogOut, WifiOff } from "lucide-react";
import { getCsrfToken, getSession, type SessionUser } from "@/lib/api";
import { listLocalDocs } from "@/lib/local/meta-store";
import { count as outboxCount } from "@/lib/sync/outbox";
import { purgeAllLocalData } from "@/lib/local/purge";

/**
 * Custom Auth.js sign-out confirmation screen (replaces the unstyled
 * built-in page). Signing out is a privacy boundary on shared devices:
 * before the session-ending POST is submitted, ALL locally cached
 * document data (titles, previews, content, outbox) is purged so the
 * next person on this browser sees nothing of this account.
 */
export function SignOutView() {
  const formRef = useRef<HTMLFormElement>(null);
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [csrfToken, setCsrfToken] = useState<string | null | undefined>(undefined);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void getSession().then(setSession);
    void getCsrfToken().then(setCsrfToken);
    // "Unsynced" = documents with updates still queued in the outbox —
    // the authoritative ledger (rows are deleted only on server ACK).
    // The meta-store `dirty` flag is advisory and can go stale.
    void listLocalDocs()
      .then(async (docs) => {
        const pending = await Promise.all(
          docs.map(async (d) => (await outboxCount(d.documentId)) > 0),
        );
        setDirtyCount(pending.filter(Boolean).length);
      })
      .catch(() => setDirtyCount(0));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csrfToken || submitting) return;
    setSubmitting(true);
    void (async () => {
      // Purge first, while we still can — best-effort: a storage error
      // must not leave the user unable to end the session.
      try {
        await purgeAllLocalData();
      } catch {
        /* best-effort */
      }
      // Native submit performs the real signout POST + redirect and does
      // NOT re-fire this handler.
      formRef.current?.submit();
    })();
  };

  // Still resolving the session — mirror the card layout with a skeleton.
  if (session === undefined) {
    return (
      <div className="animate-pulse">
        <div className="mx-auto h-14 w-14 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="mx-auto mt-4 h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mx-auto mt-2 h-3 w-52 rounded bg-zinc-100 dark:bg-zinc-800/60" />
        <div className="mt-6 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <LogOut className="h-6 w-6 text-zinc-500 dark:text-zinc-400" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          You&apos;re signed out
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          There&apos;s no active session on this device.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/signin"
            className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in
          </Link>
          <Link
            href="/documents"
            className="rounded-full px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Back to documents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-lg font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
        {session.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny external avatar
          <img
            src={session.image}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          (session.name ?? session.email).slice(0, 1).toUpperCase()
        )}
      </span>
      <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Sign out?</h1>
      <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
        {session.name ? `${session.name} · ${session.email}` : session.email}
      </p>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        Signing out removes your documents from this browser. Everything synced to your account is
        safe and comes back the next time you sign in.
      </p>

      {dirtyCount > 0 && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {dirtyCount === 1
            ? "1 document has changes that haven't synced yet — they will be discarded. Go back online to sync before signing out."
            : `${dirtyCount} documents have changes that haven't synced yet — they will be discarded. Go back online to sync before signing out.`}
        </div>
      )}

      {csrfToken === null && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
        >
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          The server can&apos;t be reached right now, so signing out isn&apos;t possible yet. Try
          again once you&apos;re back online.
        </div>
      )}

      <form
        ref={formRef}
        method="post"
        action="/api/auth/signout"
        onSubmit={handleSubmit}
        className="mt-6 flex flex-col gap-2"
      >
        <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
        <input type="hidden" name="callbackUrl" value="/" />
        <button
          type="submit"
          disabled={!csrfToken || submitting}
          className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing out…" : "Sign out"}
        </button>
        <Link
          href="/documents"
          className="rounded-full px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </Link>
      </form>
    </div>
  );
}
