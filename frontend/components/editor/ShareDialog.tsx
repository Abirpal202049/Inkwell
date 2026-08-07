"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Link as LinkIcon, Check, UserPlus } from "lucide-react";
import {
  getDocument,
  inviteMember,
  changeMemberRole,
  removeMember,
  patchDocument,
  type DocumentDetails,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Docs-style share dialog (plan/14 §5): copy-link row with share-mode
 * dropdown on top, people list with per-person role dropdowns below.
 * Owner only — the trigger button is hidden for other roles.
 */
export function ShareDialog({
  docId,
  open,
  onClose,
}: {
  docId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    void getDocument(docId).then(setDetails);
  }, [docId]);

  useEffect(() => {
    if (open) {
      reload();
      setNotice(null);
    }
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const result = await inviteMember(docId, email.trim(), inviteRole);
    setBusy(false);
    if (!result) {
      setNotice("Couldn't invite — check the email and try again.");
      return;
    }
    setNotice(result.pending ? `Invite saved — ${email.trim()} will get access when they sign up.` : null);
    setEmail("");
    reload();
  };

  const setShareMode = async (mode: string) => {
    setBusy(true);
    await patchDocument(docId, { shareMode: mode });
    setBusy(false);
    reload();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/documents/${docId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share document"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share “{details?.title ?? "…"}”</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Link sharing row */}
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-700">
          <LinkIcon className="h-4 w-4 shrink-0 text-zinc-500" />
          <select
            value={details?.shareMode ?? "private"}
            onChange={(e) => void setShareMode(e.target.value)}
            disabled={busy || !details}
            aria-label="Link sharing mode"
            className="flex-1 bg-transparent text-sm outline-none"
          >
            <option value="private">Restricted — members only</option>
            <option value="link-view">Anyone with the link can view</option>
            <option value="link-edit">Anyone with the link can edit</option>
          </select>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300"
          >
            {copied ? <Check className="h-3 w-3" /> : null}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        {/* Invite row */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void invite()}
            placeholder="Add people by email"
            aria-label="Invite by email"
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
            aria-label="Role for invitee"
            className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="button"
            onClick={() => void invite()}
            disabled={busy || !email.trim()}
            aria-label="Send invite"
            className="rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <UserPlus className="h-4 w-4" />
          </button>
        </div>

        {notice && <p className="mb-3 text-xs text-zinc-500">{notice}</p>}

        {/* People list */}
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {(details?.members ?? []).map((m) => (
            <li key={m.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-xs font-medium dark:bg-zinc-700">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny external avatar
                  <img src={m.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  (m.name ?? m.email).slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{m.name ?? m.email}</span>
                <span className="block truncate text-xs text-zinc-500">
                  {m.email}
                  {m.grantedVia === "link" ? " · via link" : ""}
                </span>
              </span>
              {m.role === "owner" ? (
                <span className="text-xs text-zinc-500">Owner</span>
              ) : (
                <>
                  <select
                    value={m.role}
                    onChange={(e) => {
                      void changeMemberRole(docId, m.userId, e.target.value as "editor" | "viewer").then(reload);
                    }}
                    aria-label={`Role for ${m.name ?? m.email}`}
                    className={cn(
                      "rounded border border-zinc-200 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800",
                    )}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void removeMember(docId, m.userId).then(reload)}
                    aria-label={`Remove ${m.name ?? m.email}`}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
