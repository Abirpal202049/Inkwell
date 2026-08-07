import { Suspense } from "react";
import { DocumentShell } from "@/components/editor/DocumentShell";

export default async function DocumentPage({ params }: PageProps<"/documents/[docId]">) {
  const { docId } = await params;
  return (
    <Suspense>
      <DocumentShell docId={docId} />
    </Suspense>
  );
}
