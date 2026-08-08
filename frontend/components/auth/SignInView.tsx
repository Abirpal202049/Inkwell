"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleAlert, WifiOff } from "lucide-react";
import { getCsrfToken } from "@/lib/api";

/**
 * Custom Auth.js sign-in screen (replaces the unstyled built-in page).
 * Each provider button is a plain form POST to the Auth.js signin
 * endpoint with the double-submit CSRF token; the browser then follows
 * the redirect out to the provider's consent screen.
 */

/** Auth.js error codes (?error=…) → human messages. */
const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "Couldn't start the sign-in flow. Please try again.",
  OAuthCallback: "The provider sent back an unexpected response. Please try again.",
  OAuthCallbackError: "The provider sent back an unexpected response. Please try again.",
  AccessDenied: "Access was denied. Try again with a different account.",
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  Configuration: "Sign-in is misconfigured on the server. Please try again later.",
  Verification: "The sign-in link is no longer valid. Please try again.",
};

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.011h3.878c2.269-2.089 3.578-5.165 3.578-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.956-1.075 7.942-2.907l-3.878-3.011c-1.075.72-2.45 1.145-4.064 1.145-3.125 0-5.77-2.11-6.714-4.947H1.276v3.11A11.995 11.995 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.286 14.28A7.213 7.213 0 0 1 4.909 12c0-.79.136-1.56.377-2.28V6.61H1.276a11.995 11.995 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.773c1.762 0 3.344.605 4.587 1.794l3.442-3.442C17.951 1.19 15.235 0 12 0A11.995 11.995 0 0 0 1.276 6.61l4.01 3.11C6.23 6.883 8.875 4.773 12 4.773Z"
      />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}

const PROVIDERS = [
  {
    id: "google",
    label: "Continue with Google",
    Icon: GoogleIcon,
    className:
      "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
  },
  {
    id: "github",
    label: "Continue with GitHub",
    Icon: GithubIcon,
    className: "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
  },
] as const;

export function SignInView() {
  const searchParams = useSearchParams();
  const [csrfToken, setCsrfToken] = useState<string | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    void getCsrfToken().then(setCsrfToken);
  }, []);

  // Only ever bounce back to a same-site path — never a foreign origin.
  const rawCallback = searchParams.get("callbackUrl") ?? "/documents";
  const callbackUrl = rawCallback.startsWith("/") && !rawCallback.startsWith("//")
    ? rawCallback
    : "/documents";

  const errorCode = searchParams.get("error");
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? "Something went wrong while signing in. Please try again.")
    : null;

  return (
    <>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Sync your documents across devices and collaborate in real time.
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      {csrfToken === null && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
        >
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          Signing in needs a connection, and the server can&apos;t be reached right now. You can
          keep working offline and try again later.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {PROVIDERS.map(({ id, label, Icon, className }) => (
          <form
            key={id}
            method="post"
            action={`/api/auth/signin/${id}`}
            onSubmit={() => setSubmitting(id)}
          >
            <input type="hidden" name="csrfToken" value={csrfToken ?? ""} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
              type="submit"
              disabled={!csrfToken || submitting !== null}
              className={`flex w-full items-center justify-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
            >
              <Icon className="h-5 w-5" />
              {submitting === id ? "Redirecting…" : label}
            </button>
          </form>
        ))}
      </div>

      <p className="mt-6 border-t border-zinc-100 pt-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No account needed to write —{" "}
        <Link href="/documents" className="font-medium text-blue-600 hover:underline">
          keep working locally
        </Link>
        .
      </p>
    </>
  );
}
