import Link from "next/link";
import {
  WifiOff,
  GitMerge,
  History,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Check,
  Mic,
  PenLine,
  Minimize2,
  SpellCheck2,
  ScrollText,
  Bookmark,
  Activity,
  RotateCcw,
  Users,
  Printer,
} from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { InkwellLogo } from "@/components/InkwellLogo";

const FEATURES = [
  {
    Icon: WifiOff,
    title: "Local-first",
    body: "Open, edit and close documents with zero network requests. Your device is the source of truth.",
  },
  {
    Icon: GitMerge,
    title: "Deterministic merge",
    body: "CRDT-backed sync reconciles offline edits from every collaborator without ever losing a keystroke.",
  },
  {
    Icon: History,
    title: "Time travel",
    body: "Capture versions, browse the timeline, and restore safely — even while others keep editing.",
  },
  {
    Icon: Sparkles,
    title: "AI writing tools",
    body: "Summarize, rewrite, and continue your draft in place — with every AI edit clearly marked until you accept it.",
  },
  {
    Icon: Users,
    title: "Share with roles",
    body: "Invite people as editors or viewers. Owners can change roles or revoke access at any time.",
  },
  {
    Icon: Printer,
    title: "Real pages",
    body: "A4 and Letter sheets with rulers, headers, footers and page numbers — and clean print output.",
  },
];

const STEPS = [
  {
    title: "Write anywhere",
    body: "Documents live on your device first, so the editor opens instantly — on a plane, in a tunnel, or fully offline.",
  },
  {
    title: "Sync without conflicts",
    body: "When you reconnect, everyone's edits merge deterministically. No conflict dialogs, no overwritten paragraphs.",
  },
  {
    title: "Roll back with confidence",
    body: "Named versions and a full timeline mean any state of the document is one click away — restores never destroy history.",
  },
];

/** Docs-style remote caret: a thin colored bar in the text flow with the
 *  collaborator's name flag above it, mirroring the real
 *  .collaboration-carets styles the editor renders. */
function RemoteCaret({
  name,
  caretClass,
  flagClass,
}: {
  name: string;
  caretClass: string;
  flagClass: string;
}) {
  return (
    <span className="relative">
      <span
        className={`inline-block h-[1.1em] w-[1.5px] rounded align-[-0.2em] ${caretClass}`}
      />
      <span
        className={`absolute -top-4 left-0 whitespace-nowrap rounded-md rounded-bl-none px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ${flagClass}`}
      >
        {name}
      </span>
    </span>
  );
}

const PRESENCE = [
  { initial: "M", color: "bg-emerald-500" },
  { initial: "S", color: "bg-rose-500" },
  { initial: "Y", color: "bg-blue-600" },
];

/** CSS-only mock of the editor that plays the product story on a loop
 *  (keyframes in globals.css §landing demo): Maya's sentence types out
 *  and Sam holds a selection while "Offline" shows, then the badge flips
 *  to "syncing" and "Synced — nothing lost". Real text, real-looking
 *  carets — but no client JS ships with the landing page, and
 *  prefers-reduced-motion gets the static final frame. */
function EditorPreview() {
  const badgeBase =
    "col-start-1 row-start-1 flex items-center gap-1.5 justify-self-end rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm";
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-[#f9fbfd] p-4 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
    >
      {/* status badge: offline → syncing → synced (stacked in one grid cell) */}
      <div className="absolute -top-3 right-6 grid">
        <div
          className={`demo-badge-offline ${badgeBase} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300`}
        >
          <WifiOff className="h-3 w-3" />
          Offline — edits saved locally
        </div>
        <div
          className={`demo-badge-syncing ${badgeBase} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300`}
        >
          <RefreshCw className="h-3 w-3 animate-spin" />
          Back online — syncing
        </div>
        <div
          className={`demo-badge-synced ${badgeBase} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300`}
        >
          <Check className="h-3 w-3" />
          Synced — nothing lost
        </div>
      </div>

      {/* doc chrome: title + who's here */}
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Q3 launch plan
          </span>
          <span className="hidden text-xs text-zinc-400 sm:inline dark:text-zinc-500">
            Edited just now
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {PRESENCE.map(({ initial, color }) => (
              <span
                key={initial}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-[#f9fbfd] transition-transform duration-200 hover:z-10 hover:-translate-y-0.5 hover:scale-110 dark:ring-zinc-950 ${color}`}
              >
                {initial}
              </span>
            ))}
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            3 editing
          </span>
        </div>
      </div>

      {/* paper sheet */}
      <div className="rounded-lg border border-zinc-200 bg-white px-6 py-7 text-left shadow-sm sm:px-10 sm:py-9 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-3 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Q3 launch plan
        </h3>
        <div className="space-y-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          <p>
            Pilot customers get access on Monday. Most of this doc was
            written on the train, fully offline — every word landed here
            the moment we were back in range.
          </p>
          <p>
            Sam is reviewing{" "}
            <span className="rounded-sm bg-rose-500/20 transition-colors hover:bg-rose-500/35 dark:bg-rose-400/25 dark:hover:bg-rose-400/40">
              the pricing tiers for launch week
            </span>
            <RemoteCaret
              name="Sam"
              caretClass="bg-rose-500"
              flagClass="bg-rose-500"
            />{" "}
            while the rollout checklist keeps growing below.
          </p>
          <p>
            Maya, drafting from hotel wifi:{" "}
            <span className="demo-typing">
              &ldquo;sync can wait — writing can&rsquo;t.&rdquo;
            </span>
            <RemoteCaret
              name="Maya"
              caretClass="bg-emerald-500"
              flagClass="bg-emerald-500"
            />
          </p>
          <p>
            <span className="rounded-sm bg-violet-500/15 px-0.5 transition-colors hover:bg-violet-500/25 dark:bg-violet-400/20 dark:hover:bg-violet-400/30">
              AI summary: three devices edited offline today. Every change
              merged cleanly — zero conflicts.
            </span>{" "}
            <span className="inline-block h-[1.1em] w-[1.5px] animate-pulse rounded bg-blue-600 align-[-0.2em]" />
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* nav */}
      <header className="border-b border-zinc-200 px-4 dark:border-zinc-800">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <InkwellLogo className="h-6 w-6 text-blue-600" />
            Inkwell
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/signin"
              className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Sign in
            </Link>
            <Link
              href="/documents"
              className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:-translate-y-px hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:translate-y-0 active:scale-95"
            >
              Open documents
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* hero */}
        <section className="relative overflow-hidden px-4 pb-16 pt-16 sm:pt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.10),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.18),transparent_65%)]"
          />
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
            <p className="mb-5 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
              Local-first · CRDT sync · Full version history
            </p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Documents that never
              <br className="hidden sm:block" /> wait on the network
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
              Inkwell is a collaborative editor that opens instantly, keeps
              every keystroke through any outage, and lets you roll back to
              exactly what happened.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/documents"
                className="group inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 font-medium text-white transition hover:-translate-y-px hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:translate-y-0 active:scale-95"
              >
                Open your documents
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/signin"
                className="rounded-full border border-zinc-300 px-6 py-2.5 font-medium text-zinc-700 transition hover:-translate-y-px hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:translate-y-0 active:scale-95 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Sign in to collaborate
              </Link>
            </div>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              No account needed to start writing — everything works offline.
            </p>
          </div>

          <div className="mx-auto mt-14 w-full max-w-2xl">
            <EditorPreview />
          </div>
        </section>

        {/* features */}
        <section className="px-4 py-16">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              Built for the moments the network isn&apos;t there
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ Icon, title, body }) => (
                <div
                  key={title}
                  className="reveal rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800"
                >
                  <div className="mb-4 inline-flex rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950">
                    <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="mb-1.5 font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* voice + AI showcase */}
        <section className="px-4 py-16">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              Speak it — or ask AI to write it
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-600 dark:text-zinc-400">
              Inkwell isn&apos;t just a place to type. Dictate hands-free from
              the toolbar, and pull in AI exactly where your cursor is.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {/* speech-to-text */}
              <div className="reveal rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800">
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950">
                    <Mic className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold">
                    Speech-to-text, built in
                  </h3>
                </div>

                {/* dictation mock */}
                <div
                  aria-hidden
                  className="mt-5 rounded-xl border border-zinc-200 bg-[#f9fbfd] p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                      <span className="absolute inset-0 rounded-full bg-red-500/50 motion-safe:animate-ping" />
                      <Mic className="relative h-4 w-4" />
                    </span>
                    <span className="flex h-5 items-center gap-0.75 text-blue-600 dark:text-blue-400">
                      {[0, 180, 360, 90, 270].map((delay, i) => (
                        <span
                          key={i}
                          className="demo-eq-bar h-4 w-0.75 rounded-full bg-current"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </span>
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Listening…
                    </span>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    You say{" "}
                    <span className="italic">
                      &ldquo;ship the beta monday full stop&rdquo;
                    </span>
                    <br />
                    Inkwell writes{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      &ldquo;Ship the beta Monday.&rdquo;
                    </span>
                  </p>
                </div>

                <ul className="mt-5 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    Dictate straight into the document — spoken punctuation
                    like &ldquo;comma&rdquo; and &ldquo;new paragraph&rdquo;
                    just works.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    No speech support in your browser? Inkwell records the
                    audio and AI transcribes it.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    One tap and AI tidies the ums, false starts and run-on
                    sentences.
                  </li>
                </ul>
              </div>

              {/* AI assistant */}
              <div className="reveal rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-violet-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-800">
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg bg-violet-50 p-2.5 dark:bg-violet-950">
                    <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <h3 className="text-lg font-semibold">
                    AI, right where your cursor is
                  </h3>
                </div>

                {/* AI menu mock — mirrors the real in-editor menu */}
                <div
                  aria-hidden
                  className="mt-5 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="m-1 flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
                    <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                    <span className="text-[13px] text-zinc-400">
                      Ask AI to edit the selection…
                    </span>
                    <span className="ml-auto inline-block h-[1.1em] w-[1.5px] animate-pulse rounded bg-violet-500" />
                  </div>
                  <div className="mt-1">
                    {(
                      [
                        [PenLine, "Continue writing"],
                        [Minimize2, "Make more concise"],
                        [SpellCheck2, "Fix spelling & grammar"],
                        [ScrollText, "Summarize selection"],
                      ] as const
                    ).map(([ItemIcon, label]) => (
                      <div
                        key={label}
                        className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-700 transition-colors hover:bg-violet-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <ItemIcon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        {label}
                      </div>
                    ))}
                  </div>
                </div>

                <ul className="mt-5 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    AI text streams in highlighted, and stays marked until you
                    take over — you always know who wrote what.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    Summarize a selection or the whole document in a side
                    panel.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    Saved versions get AI-written labels — like commit
                    messages you never had to think up.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* version control + activity showcase */}
        <section className="border-t border-zinc-200 px-4 py-16 dark:border-zinc-800">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              Every change, on the record
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-600 dark:text-zinc-400">
              Version control and a full audit trail are built into every
              document — see what changed, who changed it, and roll back
              without losing a thing.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {/* version history */}
              <div className="reveal rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800">
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950">
                    <History className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold">
                    Version history that can&apos;t hurt you
                  </h3>
                </div>

                {/* timeline mock — mirrors the real history panel */}
                <div
                  aria-hidden
                  className="mt-5 space-y-1.5 rounded-xl border border-zinc-200 bg-[#f9fbfd] p-2 text-left dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900 dark:bg-blue-950/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                        <Bookmark className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                        Final pricing pass
                      </span>
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Current
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Today, 9:41 AM
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                      <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Maya
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="h-2 w-2 rounded-full bg-rose-500" />
                        Sam
                      </span>
                    </div>
                  </div>

                  <div className="group/row flex items-center justify-between gap-2 rounded-lg p-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <div>
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                        Restructured intro, added rollout plan
                      </span>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Yesterday, 6:12 PM
                      </div>
                    </div>
                    <span className="flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 opacity-0 transition-opacity group-hover/row:opacity-100 dark:border-zinc-700 dark:text-zinc-300">
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg p-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <div>
                      <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
                        Aug 10, 2:03 PM
                      </span>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Auto snapshot
                      </div>
                    </div>
                  </div>
                </div>

                <ul className="mt-5 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    Restores are non-destructive — history stays intact, even
                    while others keep editing.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    AI names your snapshots for you — like commit messages,
                    without the typing.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    Preview any version read-only before you decide.
                  </li>
                </ul>
              </div>

              {/* activity / audit trail */}
              <div className="reveal rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-800">
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950">
                    <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-semibold">
                    See who changed what
                  </h3>
                </div>

                {/* attributed-changes mock — mirrors the Activity view */}
                <div
                  aria-hidden
                  className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <Activity className="h-3.5 w-3.5" />
                      Activity
                    </span>
                    <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      Last 24 hours
                    </span>
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    Pilot customers get access{" "}
                    <span className="text-rose-500 line-through opacity-75">
                      sometime next week
                    </span>{" "}
                    <span className="border-b-2 border-emerald-500 bg-emerald-500/10 transition-colors hover:bg-emerald-500/25">
                      on Monday, right after the sync demo
                    </span>
                    . Pricing ships with{" "}
                    <span className="border-b-2 border-rose-500 bg-rose-500/10 transition-colors hover:bg-rose-500/25">
                      three tiers, billed monthly or yearly
                    </span>
                    .
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Maya
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      Sam
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="h-2 w-2 rounded-full bg-blue-600" />
                      You
                    </span>
                  </div>
                </div>

                <ul className="mt-5 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    Every insertion and deletion is attributed, in the same
                    color as that person&apos;s live cursor.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    Filter the trail from the last hour back to all time.
                  </li>
                  <li className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    Hover any change to see exactly who made it, and when.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section className="border-y border-zinc-200 bg-[#f9fbfd] px-4 py-16 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto w-full max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {STEPS.map(({ title, body }, i) => (
                <li key={title} className="reveal flex flex-col items-start">
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mb-1.5 font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* closing CTA */}
        <section className="px-4 py-16">
          <div className="reveal mx-auto flex w-full max-w-3xl flex-col items-center rounded-2xl border border-zinc-200 bg-white px-6 py-12 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <InkwellLogo className="mb-4 h-9 w-9 text-blue-600" />
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your words, always yours
            </h2>
            <p className="mt-3 max-w-md text-zinc-600 dark:text-zinc-300">
              Start a document now — it lives on your device from the first
              keystroke, and syncs whenever you&apos;re ready.
            </p>
            <Link
              href="/documents"
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 font-medium text-white transition hover:-translate-y-px hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:translate-y-0 active:scale-95"
            >
              Start writing
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
