import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SignOutView } from "@/components/auth/SignOutView";

export const metadata: Metadata = {
  title: "Sign out — Inkwell",
};

export default function SignOutPage() {
  return (
    <AuthLayout>
      <Suspense>
        <SignOutView />
      </Suspense>
    </AuthLayout>
  );
}
