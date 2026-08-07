import { HistoryView } from "@/components/history/HistoryView";

export const metadata = { title: "Version history — Inkwell" };

export default async function HistoryPage({ params }: PageProps<"/documents/[docId]/history">) {
  const { docId } = await params;
  return <HistoryView docId={docId} />;
}
