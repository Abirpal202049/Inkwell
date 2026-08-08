import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SignInView } from "@/components/auth/SignInView";

export const metadata: Metadata = {
  title: "Sign in — Inkwell",
};

export default function SignInPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignInView />
      </Suspense>
    </AuthLayout>
  );
}
