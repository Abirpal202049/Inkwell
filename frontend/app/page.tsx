import Link from "next/link";
import {
  WifiOff,
  GitMerge,
  History,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Check,
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

/** CSS-only mock of the editor that plays the product story on a loop
 *  (keyframes in globals.css §landing demo): Maya types and the AI line
 *  streams in while "Offline" shows, then the badge flips to "syncing"
 *  and "Synced — nothing lost". No client JS ships with the landing
 *  page, and prefers-reduced-motion gets the static final frame. */
function EditorPreview() {
  const badgeBase =
    "col-start-1 row-start-1 flex items-center gap-1.5 justify-self-end rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm";
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-2xl rounded-2xl border border-zinc-200 bg-[#f9fbfd] p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
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

      {/* paper sheet */}
      <div className="rounded-lg border border-zinc-200 bg-white px-6 py-7 sm:px-10 sm:py-9 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-5 h-4 w-2/5 rounded bg-zinc-300 dark:bg-zinc-600" />

        <div className="space-y-2.5">
          <div className="h-2.5 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-2.5 w-11/12 rounded bg-zinc-200 dark:bg-zinc-700" />

          {/* Maya's line grows while she "types"; the caret rides the end */}
          <div className="relative flex items-center gap-0.5">
            <div className="demo-maya-line h-2.5 rounded bg-zinc-200 dark:bg-zinc-700" />
            <span className="relative">
              <span className="block h-3.5 w-0.5 rounded bg-emerald-500" />
              <span className="absolute -top-5 left-0 rounded-md rounded-bl-none bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                Maya
              </span>
            </span>
          </div>

          <div className="h-2.5 w-full rounded bg-zinc-200 dark:bg-zinc-700" />

          {/* freshly streamed AI text */}
          <div className="demo-ai-line h-2.5 rounded bg-violet-200 dark:bg-violet-900" />

          {/* line with the local caret */}
          <div className="flex items-center gap-0.5">
            <div className="h-2.5 w-1/3 rounded bg-zinc-200 dark:bg-zinc-700" />
            <span className="block h-3.5 w-0.5 animate-pulse rounded bg-blue-600" />
          </div>
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
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
