import Link from "next/link";
import { WifiOff, GitMerge, History } from "lucide-react";
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
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-6 flex items-center gap-3">
          <InkwellLogo className="h-10 w-10 text-blue-600" />
          <h1 className="text-4xl font-bold tracking-tight">Inkwell</h1>
        </div>
        <p className="mb-8 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
          A collaborative document editor that never blocks on the network,
          never silently loses your edits, and always lets you roll back to
          exactly what happened.
        </p>
        <Link
          href="/documents"
          className="rounded-full bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700"
        >
          Open your documents
        </Link>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-zinc-200 p-5 text-left dark:border-zinc-800"
            >
              <Icon className="mb-3 h-6 w-6 text-blue-600" />
              <h2 className="mb-1 font-semibold">{title}</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
