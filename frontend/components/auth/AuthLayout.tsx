import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { InkwellLogo } from "@/components/InkwellLogo";

/** Shared chrome for the /signin and /signout screens: editor-canvas
 *  background, brand header, centered card, required site footer. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f9fbfd] dark:bg-zinc-950">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link
          href="/"
          className="mb-8 flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-zinc-800 dark:text-zinc-50"
        >
          <InkwellLogo className="h-8 w-8 text-blue-600" />
          Inkwell
        </Link>
        <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
