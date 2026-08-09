"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  History,
  BookmarkPlus,
  LogIn,
  Lock,
  FilePlus2,
  FileDown,
  Printer,
  Check,
  PanelTop,
  PanelBottom,
  Hash,
  Sparkles,
  ScrollText,
} from "lucide-react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { openDocument, extractDocPreview } from "@/lib/crdt/doc-manager";
import { upsertLocalDoc, getLocalDoc, deleteLocalDoc } from "@/lib/local/meta-store";
import { clearDocument as clearOutbox } from "@/lib/sync/outbox";
import { TITLE_MIRROR_DEBOUNCE_MS, DEFAULT_DOC_TITLE } from "@/lib/constants";
import { presenceColor } from "@/lib/utils";
import { getSession, getDocument, createVersion, type SessionUser } from "@/lib/api";
import { SyncProvider, type SyncState } from "@/lib/sync/provider";
import { ConnectionBadge, type ConnectionState } from "@/components/ConnectionBadge";
import { AuthorCredit } from "@/components/SiteFooter";
import { useInkwellEditor, EditorSurface, type CollabContext } from "./Editor";
import type { PageInfo } from "./pagination";
import { PAGE_GAP, type HfBandConfig } from "./pagination-core";
import { HF_FRAGMENTS, type HfKind } from "@/lib/constants";
import {
  useHfSettings,
  enabledFor,
  hfHeightsEqual,
  renderHfFragment,
  ZERO_HF_HEIGHTS,
  type HfHeights,
} from "./hf";
import { HeaderFooterLayer, type HfActive } from "./HeaderFooterLayer";
import { HfFormatDialog } from "./HfFormatDialog";
import {
  HorizontalRuler,
  VerticalRuler,
  useDocMargins,
  PAGE_SIZES,
  type PageSizeId,
} from "./Ruler";
import { Toolbar } from "./Toolbar";
import { TitleInput } from "./TitleInput";
import { StatusFooter } from "./StatusFooter";
import { PresenceAvatars } from "./PresenceAvatars";
import { ShareDialog } from "./ShareDialog";
import { SaveVersionDialog } from "./SaveVersionDialog";
import { downloadAsPdf, downloadAsWord } from "@/lib/export";
import { AiMenu } from "./AiMenu";
import { AiSummaryPanel, type SummaryTarget } from "./AiSummaryPanel";
import { AiSelectionChip } from "./AiSelectionChip";
import { getAiStatus } from "@/lib/ai";
import { AI_INTRO_SEEN_KEY } from "@/lib/constants";

/**
 * Client orchestrator for the editor page (plan/07 §Component
 * Architecture): owns the Y.Doc lifecycle, the sync provider (when
 * signed in), role state (including live downgrades pushed over the
 * socket), and the surrounding chrome.
 *
 * Signed out or offline, everything still works — edits persist to
 * IndexedDB and sync whenever a session + connection appear.
 */
type Role = "owner" | "editor" | "viewer";

const MENU_ITEM =
  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800";

function cnMenuButton(open: boolean) {
  return `rounded px-2 py-0.5 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
    open ? "bg-zinc-100 dark:bg-zinc-800" : ""
  }`;
}

const PAGE_DIMS: Record<PageSizeId, string> = {
  a4: "210 × 297 mm",
  letter: "8.5 × 11 in",
  legal: "8.5 × 14 in",
  tabloid: "11 × 17 in",
};

/** Docs-style identities for signed-out link viewers: a recognizable
 *  animal instead of an anonymous-looking initial. Picked per session
 *  from the Y.Doc client id. */
const ANON_ANIMALS: { name: string; emoji: string }[] = [
  { name: "Fox", emoji: "🦊" },
  { name: "Panda", emoji: "🐼" },
  { name: "Koala", emoji: "🐨" },
  { name: "Tiger", emoji: "🐯" },
  { name: "Owl", emoji: "🦉" },
  { name: "Penguin", emoji: "🐧" },
  { name: "Frog", emoji: "🐸" },
  { name: "Octopus", emoji: "🐙" },
  { name: "Rabbit", emoji: "🐰" },
  { name: "Bear", emoji: "🐻" },
  { name: "Wolf", emoji: "🐺" },
  { name: "Turtle", emoji: "🐢" },
];

export function DocumentShell({ docId }: { docId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  const open = useMemo(() => openDocument(docId), [docId]);
  useEffect(() => () => open.release(), [open]);

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void open.whenLoaded.then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ---- session + sync provider -------------------------------------------
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [provider, setProvider] = useState<SyncProvider | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("offline");
  const [role, setRole] = useState<Role>("owner"); // local-only docs: full control
  const [revoked, setRevoked] = useState(false);
  /** The owner hard-deleted this document while it was open here. */
  const [deletedRemotely, setDeletedRemotely] = useState(false);
  /**
   * Access gate (plan/14 §5). Signed-out visitors of docs that came from
   * a share (or are unknown locally) must be confirmed by the server
   * before anything renders — a doc flipped back to Restricted shows the
   * access screen, not the stale local cache. Docs created on this
   * device and signed-in sessions are "ok" immediately.
   */
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    void getSession().then(setSession);
  }, []);

  useEffect(() => {
    if (session === undefined) return; // session still resolving
    let cancelled = false;
    let p: SyncProvider | null = null;

    const attach = (user: { id: string; name: string; image?: string | null; emoji?: string }) => {
      p = new SyncProvider(docId, open.ydoc, {
        onState: setSyncState,
        onRole: (r) => setRole(r),
        onRevoked: () => {
          setRevoked(true);
          // Anonymous link access has no "local copy stays readable"
          // promise — losing access hides the document.
          if (!session) setAccess("denied");
        },
        onDeleted: () => {
          // Hard delete: the document (and all its history) is gone for
          // everyone. Drop the local list entry and queued edits; the
          // per-doc content DB is released on unmount.
          setDeletedRemotely(true);
          void clearOutbox(docId);
          void deleteLocalDoc(docId);
        },
        registerRemote: session !== null,
      });
      p.awareness.setLocalStateField("user", {
        id: user.id,
        name: user.name,
        color: presenceColor(user.id),
        image: user.image ?? null,
        emoji: user.emoji ?? null,
      });
      setProvider(p);
    };

    if (session) {
      setAccess("ok");
      attach({ id: session.id, name: session.name ?? session.email, image: session.image });
      void getDocument(docId).then((d) => {
        if (cancelled || !d) return;
        setRole(d.role);
        void upsertLocalDoc(docId, { role: d.role, title: d.title });
      });
    } else {
      // Signed out: docs created on this device stay fully local; docs
      // that came from a share need the server's confirmation before
      // anything renders (plan/14 §5 — Restricted must actually restrict).
      void (async () => {
        const local = await getLocalDoc(docId);
        if (cancelled) return;
        if (local?.role === "owner") {
          setAccess("ok");
          return;
        }
        const d = await getDocument(docId);
        if (cancelled) return;
        if (!d) {
          setAccess("denied");
          return;
        }
        setRole(d.role);
        setAccess("ok");
        void upsertLocalDoc(docId, { role: d.role, title: d.title });
        const animal = ANON_ANIMALS[open.ydoc.clientID % ANON_ANIMALS.length]!;
        attach({
          id: `anon-${open.ydoc.clientID}`,
          name: `Anonymous ${animal.name}`,
          emoji: animal.emoji,
        });
      })();
    }

    return () => {
      cancelled = true;
      p?.destroy();
      setProvider(null);
      setSyncState("offline");
    };
  }, [session, open, docId]);

  // Content edits -> mirror title/preview/updatedAt into the dashboard
  // meta store (debounced). Runs for remote edits too, on purpose — the
  // thumbnail should reflect what collaborators typed. Deliberately does
  // NOT touch `dirty`: that flag tracks the outbox (set on enqueue in the
  // sync provider, cleared on server ACK), and a debounced write here
  // would land after the ACK and mark fully-synced documents dirty.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void upsertLocalDoc(docId, {
          title: (open.meta.get("title") as string) ?? undefined,
          ...extractDocPreview(open.ydoc),
          updatedAt: Date.now(),
        });
      }, TITLE_MIRROR_DEBOUNCE_MS);
    };
    open.ydoc.on("update", onUpdate);
    return () => {
      open.ydoc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [open, docId]);

  const editable = role !== "viewer" && !revoked;

  const collab: CollabContext | null =
    provider && session
      ? {
          provider,
          user: { name: session.name ?? session.email, color: presenceColor(session.id) },
        }
      : null;

  // ---- AI add-ons (plan/08) ----------------------------------------------
  /** Whether the backend has an AI key configured (null until known). */
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  /** Caret-anchored "/ai" menu; null = closed. */
  const [aiAnchor, setAiAnchor] = useState<{ x: number; y: number } | null>(null);
  /** Summary panel: null closed, {} whole doc, {selection} a passage. */
  const [summaryTarget, setSummaryTarget] = useState<SummaryTarget | null>(null);
  /** One-time "meet AI" coach mark under the Tools menu. */
  const [showAiIntro, setShowAiIntro] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void getAiStatus().then((enabled) => {
      if (cancelled) return;
      setAiEnabled(enabled);
      if (enabled && !window.localStorage.getItem(AI_INTRO_SEEN_KEY)) setShowAiIntro(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const dismissAiIntro = useCallback(() => {
    setShowAiIntro(false);
    try {
      window.localStorage.setItem(AI_INTRO_SEEN_KEY, "1");
    } catch {
      // storage unavailable (private mode) — the card shows again next visit
    }
  }, []);

  // Stable trigger for the editor extension ("/ai", Ctrl/Cmd+J): the
  // editor depends on this callback, so it must not depend on the editor.
  const editorRef = useRef<TiptapEditor | null>(null);
  const openAiMenu = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const coords = ed.view.coordsAtPos(ed.state.selection.from);
    setAiAnchor({ x: coords.left, y: coords.bottom });
  }, []);

  const editor = useInkwellEditor(
    open.ydoc,
    editable,
    collab,
    openAiMenu,
    aiEnabled ? "Start writing — or type /ai for AI help" : undefined,
  );
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Why AI can't run right now — null means it can (plan/08: the one
  // deliberate exception to "works fully offline", clearly communicated).
  const aiUnavailable = !session
    ? "Sign in to use AI writing help."
    : aiEnabled === false
      ? "AI features aren't configured on this server."
      : syncState === "offline"
        ? "AI needs a connection. Everything else keeps working offline — writing help returns when you're back online."
        : null;
  const aiReady = session && aiEnabled === true;

  // ---- save version -------------------------------------------------------
  const [savingVersion, setSavingVersion] = useState<"idle" | "saving" | "saved">("idle");
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const saveVersion = async (label?: string) => {
    setSavingVersion("saving");
    const result = await createVersion(docId, label);
    setSavingVersion(result ? "saved" : "idle");
    setTimeout(() => setSavingVersion("idle"), 1500);
  };

  const [shareOpen, setShareOpen] = useState(false);
  // Scroll offset of the document area; the vertical ruler (pinned
  // outside the scroll container) uses it to keep ticks on the page.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  // Total pages, reported by the pagination plugin.
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, pages: 1 });
  const handlePageInfo = useCallback((info: PageInfo) => {
    setPageInfo((prev) => (prev.page === info.page && prev.pages === info.pages ? prev : info));
  }, []);

  const { margins, pageSize, preview, commit, setPageSize } = useDocMargins(open.meta, open.ydoc);

  // Docs shows the page you're looking at, not the caret page: derive it
  // from the scroll offset (24 = the page stack's my-6 top inset).
  const stride = PAGE_SIZES[pageSize].height + PAGE_GAP;
  const viewportPage = Math.min(
    pageInfo.pages,
    Math.max(1, Math.floor((scrollTop + viewportH / 2 - 24) / stride) + 1),
  );

  // ---- headers & footers (plan/16) ---------------------------------------
  const hf = useHfSettings(open.meta, open.ydoc);
  /** The band being edited; while set, the toolbar targets the segment editor. */
  const [hfActive, setHfActive] = useState<HfActive | null>(null);
  const [hfEditor, setHfEditor] = useState<TiptapEditor | null>(null);
  const [hfHeights, setHfHeights] = useState<HfHeights>(ZERO_HF_HEIGHTS);
  const [hfFormatOpen, setHfFormatOpen] = useState(false);
  /** Insert > Page numbers waits for the segment editor to mount. */
  const hfPendingPageNumber = useRef(false);

  const handleHfHeights = useCallback((next: HfHeights) => {
    setHfHeights((prev) => (hfHeightsEqual(prev, next) ? prev : next));
  }, []);

  const bands: HfBandConfig = useMemo(
    () => ({
      headerMargin: hf.settings.headerMargin,
      footerMargin: hf.settings.footerMargin,
      diffFirstPage: hf.settings.diffFirstPage,
      diffOddEven: hf.settings.diffOddEven,
      headerHeights: hfHeights.header,
      footerHeights: hfHeights.footer,
    }),
    [hf.settings, hfHeights],
  );

  const handleHfActivate = useCallback(
    (a: HfActive) => {
      if (!editable) return;
      if (!enabledFor(hf.settings, a.kind)) hf.enable(a.kind);
      setHfActive(a);
    },
    [editable, hf],
  );

  const handleHfDeactivate = useCallback(
    (refocusBody: boolean) => {
      setHfActive(null);
      if (refocusBody && editor && !editor.isDestroyed) editor.commands.focus();
    },
    [editor],
  );

  // A role downgrade or a collaborator removing the segment suspends the
  // editing session (derived, not an effect — no cascading renders).
  const activeBand = hfActive && editable && enabledFor(hf.settings, hfActive.kind) ? hfActive : null;

  // Clicking back into the body ends header/footer editing (Docs behavior).
  useEffect(() => {
    if (!activeBand || !editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const onDown = () => setHfActive(null);
    dom.addEventListener("mousedown", onDown);
    return () => dom.removeEventListener("mousedown", onDown);
  }, [activeBand, editor]);

  /** Insert menu: open (creating if needed) the header/footer of the page in view. */
  const activateHf = useCallback(
    (kind: HfKind) => {
      handleHfActivate({ kind, page: viewportPage - 1 });
    },
    [handleHfActivate, viewportPage],
  );

  // Docs' "Insert > Page numbers" preset: a right-aligned page number in
  // the chosen segment, inserted once its editor mounts.
  useEffect(() => {
    if (!hfPendingPageNumber.current || !hfEditor || hfEditor.isDestroyed) return;
    hfPendingPageNumber.current = false;
    hfEditor
      .chain()
      .focus("end")
      .setTextAlign("right")
      .insertContent({ type: "pageNumber" })
      .run();
  }, [hfEditor]);

  // ---- File/View/Insert menus (Docs-style menu bar under the title) -------
  const [menu, setMenu] = useState<"file" | "view" | "insert" | "tools" | null>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menusRef.current && !menusRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const createNewDocument = async () => {
    setMenu(null);
    const id = crypto.randomUUID();
    await upsertLocalDoc(id, { title: DEFAULT_DOC_TITLE, role: "owner" });
    router.push(`/documents/${id}?new=1`);
  };

  // ---- File > Download (client-side, works offline and signed out) --------
  const docTitle = () => ((open.meta.get("title") as string) ?? DEFAULT_DOC_TITLE);
  const canDownload = loaded && access === "ok";

  const handleDownloadPdf = () => {
    setMenu(null);
    downloadAsPdf(docTitle());
  };

  const handleDownloadWord = () => {
    setMenu(null);
    if (!editor || editor.isDestroyed) return;
    downloadAsWord(editor.getHTML(), {
      title: docTitle(),
      pageSize,
      margins,
      hf: {
        header: hf.settings.headerEnabled
          ? renderHfFragment(open.ydoc, HF_FRAGMENTS.header.default) || undefined
          : undefined,
        footer: hf.settings.footerEnabled
          ? renderHfFragment(open.ydoc, HF_FRAGMENTS.footer.default) || undefined
          : undefined,
        headerMargin: hf.settings.headerMargin,
        footerMargin: hf.settings.footerMargin,
      },
    });
  };

  const badgeState: ConnectionState =
    syncState === "connecting" ? "syncing" : (syncState as ConnectionState);

  if (deletedRemotely) {
    return (
      <div className="flex h-dvh flex-col bg-[#f9fbfd] dark:bg-zinc-950">
        <header className="border-b border-transparent bg-[#f9fbfd] px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 text-lg text-zinc-600 dark:text-zinc-50"
          >
            <FileText className="h-7 w-7 text-blue-600" />
            Inkwell
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-sm text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <FileText className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </span>
            <h1 className="mt-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
              This document was deleted
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              The owner permanently deleted this document, including its version history. It is no
              longer available to anyone.
            </p>
            <Link
              href="/documents"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Back to documents
            </Link>
          </div>
        </main>
        <div className="flex items-center justify-center border-t border-[#dadce0] bg-[#f9fbfd] px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
          <AuthorCredit />
        </div>
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="flex h-dvh flex-col bg-[#f9fbfd] dark:bg-zinc-950">
        <header className="border-b border-transparent bg-[#f9fbfd] px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 text-lg text-zinc-600 dark:text-zinc-50"
          >
            <FileText className="h-7 w-7 text-blue-600" />
            Inkwell
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-sm text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <Lock className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </span>
            <h1 className="mt-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
              You need access
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              This document is restricted. Ask the owner to share it with you, or sign in with an
              account that has access.
            </p>
            <Link
              href={`/signin?callbackUrl=/documents/${docId}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </div>
        </main>
        <div className="flex items-center justify-center border-t border-[#dadce0] bg-[#f9fbfd] px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
          <AuthorCredit />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-[#f9fbfd] print:block print:h-auto print:bg-white dark:bg-zinc-950">
      <header className="border-b border-transparent bg-[#f9fbfd] px-4 py-2 print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <Link href="/documents" aria-label="Back to documents" className="shrink-0">
            <FileText className="h-9 w-9 text-blue-600 max-sm:h-7 max-sm:w-7" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <TitleInput docId={docId} meta={open.meta} ydoc={open.ydoc} autoFocus={isNew} />
              {role === "viewer" && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  View only
                </span>
              )}
              <span className="shrink-0 max-sm:hidden">
                <ConnectionBadge state={badgeState} />
              </span>
            </div>
            <div ref={menusRef} aria-label="Menu bar" className="-mt-1 flex items-center gap-0.5 text-[13px]">
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menu === "file"}
                  onClick={() => setMenu(menu === "file" ? null : "file")}
                  className={cnMenuButton(menu === "file")}
                >
                  File
                </button>
                {menu === "file" && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <button type="button" role="menuitem" onClick={() => void createNewDocument()} className={MENU_ITEM}>
                      <FilePlus2 className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      New document
                    </button>
                    {session && editable && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={savingVersion !== "idle"}
                        onClick={() => {
                          setMenu(null);
                          setVersionDialogOpen(true);
                        }}
                        className={MENU_ITEM}
                      >
                        <BookmarkPlus className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        {savingVersion === "saving" ? "Saving…" : "Save version"}
                      </button>
                    )}
                    {session && (
                      <Link
                        role="menuitem"
                        href={`/documents/${docId}/history`}
                        onClick={() => setMenu(null)}
                        className={MENU_ITEM}
                      >
                        <History className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        Version history
                      </Link>
                    )}
                    <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
                    <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      Download
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canDownload}
                      onClick={handleDownloadPdf}
                      className={MENU_ITEM}
                    >
                      <Printer className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      PDF document (.pdf)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canDownload || !editor}
                      onClick={handleDownloadWord}
                      className={MENU_ITEM}
                    >
                      <FileDown className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Microsoft Word (.doc)
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menu === "view"}
                  onClick={() => setMenu(menu === "view" ? null : "view")}
                  className={cnMenuButton(menu === "view")}
                >
                  View
                </button>
                {menu === "view" && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      Page size
                    </p>
                    {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={pageSize === id}
                        disabled={!editable}
                        onClick={() => {
                          setPageSize(id);
                          setMenu(null);
                        }}
                        className={MENU_ITEM}
                      >
                        <span className="flex w-4 justify-center">
                          {pageSize === id && <Check className="h-3.5 w-3.5 text-blue-600" />}
                        </span>
                        {PAGE_SIZES[id].label}
                        <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                          {PAGE_DIMS[id]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menu === "insert"}
                  onClick={() => setMenu(menu === "insert" ? null : "insert")}
                  className={cnMenuButton(menu === "insert")}
                >
                  Insert
                </button>
                {menu === "insert" && (
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!editable}
                      onClick={() => {
                        setMenu(null);
                        activateHf("header");
                      }}
                      className={MENU_ITEM}
                    >
                      <PanelTop className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Header
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!editable}
                      onClick={() => {
                        setMenu(null);
                        activateHf("footer");
                      }}
                      className={MENU_ITEM}
                    >
                      <PanelBottom className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      Footer
                    </button>
                    <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
                    <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                      Page numbers
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!editable}
                      onClick={() => {
                        setMenu(null);
                        activateHf("header");
                        hfPendingPageNumber.current = true;
                      }}
                      className={MENU_ITEM}
                    >
                      <Hash className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      In header
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!editable}
                      onClick={() => {
                        setMenu(null);
                        activateHf("footer");
                        hfPendingPageNumber.current = true;
                      }}
                      className={MENU_ITEM}
                    >
                      <Hash className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                      In footer
                    </button>
                  </div>
                )}
              </div>
              {aiReady && (
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menu === "tools"}
                    onClick={() => {
                      if (showAiIntro) dismissAiIntro();
                      setMenu(menu === "tools" ? null : "tools");
                    }}
                    className={cnMenuButton(menu === "tools")}
                  >
                    Tools
                    <Sparkles className="ml-1 inline h-3 w-3 align-[-1px] text-violet-500" />
                  </button>
                  {showAiIntro && menu !== "tools" && (
                    <div className="absolute left-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-violet-200 bg-white p-3 shadow-xl dark:border-violet-900 dark:bg-zinc-900">
                      <div className="flex items-start gap-2.5">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                        <div className="min-w-0 text-[13px] text-zinc-700 dark:text-zinc-200">
                          <p className="font-medium">Meet your AI writing assistant</p>
                          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                            Select any text for quick AI edits, type /ai (or Ctrl+J) to write with
                            AI, or summarize this document — all here under Tools.
                          </p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={dismissAiIntro}
                          className="rounded-full px-3 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                          Got it
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            dismissAiIntro();
                            openAiMenu();
                          }}
                          className="rounded-full bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
                        >
                          Try it
                        </button>
                      </div>
                    </div>
                  )}
                  {menu === "tools" && (
                    <div
                      role="menu"
                      className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={syncState === "offline"}
                        title={syncState === "offline" ? "AI needs a connection" : undefined}
                        onClick={() => {
                          setMenu(null);
                          setSummaryTarget({});
                        }}
                        className={MENU_ITEM}
                      >
                        <ScrollText className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        Summarize document
                      </button>
                      {editable && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={syncState === "offline"}
                          title={syncState === "offline" ? "AI needs a connection" : undefined}
                          onClick={() => {
                            setMenu(null);
                            openAiMenu();
                          }}
                          className={MENU_ITEM}
                        >
                          <Sparkles className="h-4 w-4 text-violet-500" />
                          AI writing help
                          <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500">
                            /ai · Ctrl+J
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <PresenceAvatars provider={provider} />
            {session && editable && (
              <button
                type="button"
                onClick={() => setVersionDialogOpen(true)}
                disabled={savingVersion !== "idle"}
                title="Save a named version"
                aria-label="Save version"
                className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <BookmarkPlus className="h-5 w-5" />
              </button>
            )}
            {session && (
              <Link
                href={`/documents/${docId}/history`}
                title="Version history"
                aria-label="Version history"
                className="rounded-full p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <History className="h-5 w-5" />
              </Link>
            )}
            {session === null && (
              <Link
                href={`/signin?callbackUrl=/documents/${docId}`}
                className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in to sync
              </Link>
            )}
            {session && role === "owner" && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#c2e7ff] px-4 py-2 text-sm font-medium text-[#001d35] transition-shadow hover:shadow-md dark:bg-blue-600 dark:text-white dark:shadow-none dark:hover:bg-blue-700"
              >
                <Lock className="h-3.5 w-3.5" />
                Share
              </button>
            )}
            {session && (
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-sm font-medium dark:bg-zinc-700">
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
            )}
          </div>
        </div>
      </header>

      {editor && editable && access === "ok" && (
        <div className="print:hidden">
          {/* While a header/footer band is being edited, the toolbar
              formats that segment (plan/16 §4.2). */}
          <Toolbar
            editor={activeBand && hfEditor && !hfEditor.isDestroyed ? hfEditor : editor}
            onAiClick={aiReady && !activeBand ? openAiMenu : undefined}
          />
        </div>
      )}

      {/* Top leg of the rulers' inverted-L: a full-width band flush with
          the canvas; pl-6 keeps the ticks centered over the page, which
          sits right of the vertical ruler column below. */}
      {loaded && access === "ok" && (
        // pr-72 mirrors the summary panel's width so the ruler stays
        // centered over the page while the panel is open.
        <div
          className={`bg-white pl-6 max-lg:hidden print:hidden dark:bg-zinc-900 ${summaryTarget ? "md:pr-72" : ""}`}
        >
          <div className="mx-auto w-full" style={{ maxWidth: PAGE_SIZES[pageSize].width }}>
            <HorizontalRuler
              margins={margins}
              editable={editable}
              onPreview={preview}
              onCommit={commit}
              pageWidth={PAGE_SIZES[pageSize].width}
            />
          </div>
        </div>
      )}

      {revoked && (
        <div className="bg-red-50 px-4 py-2 text-center text-sm text-red-700 print:hidden dark:bg-red-950 dark:text-red-300">
          Your access to this document was removed. Your local copy stays readable on this device.
        </div>
      )}

      <main className="flex min-h-0 flex-1 print:block">
        {/* Left leg of the inverted-L: full-height ruler column pinned to
            the extreme left, outside the scroll area. The ruler tracks the
            page currently in view (same page the footer reports): its top
            sits at the stack's my-6 inset plus that page's offset. */}
        {loaded && access === "ok" && (
          <div className="w-6 shrink-0 max-lg:hidden print:hidden">
            <VerticalRuler
              margins={margins}
              editable={editable}
              onPreview={preview}
              onCommit={commit}
              pageTop={24 + (viewportPage - 1) * stride}
              scrollTop={scrollTop}
              pageHeight={PAGE_SIZES[pageSize].height}
            />
          </div>
        )}
        {/* Symmetric scrollbar gutters keep the page centered exactly
            under the ruler band above (which has no scrollbar). */}
        <div
          onScroll={(e) => {
            setScrollTop(e.currentTarget.scrollTop);
            setViewportH(e.currentTarget.clientHeight);
          }}
          ref={(el) => {
            if (el) setViewportH(el.clientHeight);
          }}
          className="doc-scrollbar flex flex-1 flex-col overflow-y-auto scrollbar-gutter-both print:block print:overflow-visible"
        >
          {loaded && access === "ok" ? (
            <EditorSurface
              editor={editor}
              margins={margins}
              pageSize={pageSize}
              onPageInfo={handlePageInfo}
              bands={bands}
              hfLayer={
                <HeaderFooterLayer
                  ydoc={open.ydoc}
                  settings={hf.settings}
                  bands={bands}
                  pages={pageInfo.pages}
                  pageHeight={PAGE_SIZES[pageSize].height}
                  margins={margins}
                  editable={editable}
                  active={activeBand}
                  onActivate={handleHfActivate}
                  onDeactivate={handleHfDeactivate}
                  onEditorReady={setHfEditor}
                  onHeights={handleHfHeights}
                  onOpenFormat={() => setHfFormatOpen(true)}
                  onRemove={(kind) => {
                    hf.remove(kind);
                    setHfActive(null);
                  }}
                  onToggleDiffFirst={(on) => hf.setOptions({ diffFirstPage: on })}
                />
              }
            />
          ) : (
            <div
              className="mx-auto my-6 w-full shrink-0 animate-pulse bg-white ring-1 ring-[#dadce0] dark:bg-zinc-900 dark:ring-zinc-800"
              style={{ maxWidth: PAGE_SIZES[pageSize].width, height: PAGE_SIZES[pageSize].height }}
            />
          )}
        </div>
        <AiSummaryPanel docId={docId} target={summaryTarget} onClose={() => setSummaryTarget(null)} />
      </main>

      {/* Single status bar: word count left, author credit centered
          (submission requirement), transient notices right. */}
      <div className="relative flex items-center justify-between border-t border-[#dadce0] bg-[#f9fbfd] px-3 py-1.5 print:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <StatusFooter editor={editor} pageInfo={{ page: viewportPage, pages: pageInfo.pages }} />
        <span className="absolute left-1/2 -translate-x-1/2 max-sm:hidden">
          <AuthorCredit />
        </span>
        {savingVersion === "saved" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">Version saved</span>
        )}
      </div>

      <ShareDialog docId={docId} open={shareOpen} onClose={() => setShareOpen(false)} />
      <HfFormatDialog
        open={hfFormatOpen}
        settings={hf.settings}
        onClose={() => setHfFormatOpen(false)}
        onApply={(options) => hf.setOptions(options)}
      />
      <SaveVersionDialog
        open={versionDialogOpen}
        onClose={() => setVersionDialogOpen(false)}
        onSave={(label) => void saveVersion(label)}
        aiHint={aiEnabled === true}
      />
      {editor && (
        <AiMenu
          editor={editor}
          docId={docId}
          anchor={aiAnchor}
          unavailable={aiUnavailable}
          onSummarizeSelection={(text) => setSummaryTarget({ selection: text })}
          onClose={() => setAiAnchor(null)}
        />
      )}
      {editor && (
        <AiSelectionChip
          editor={editor}
          visible={Boolean(aiReady && editable && !activeBand && !aiAnchor)}
          scrollTop={scrollTop}
          onOpen={openAiMenu}
        />
      )}
    </div>
  );
}
