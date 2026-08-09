"use client";

import type { CSSProperties } from "react";
import type { ChangeBlock, ChangeSegment, DocumentChanges, VersionContributor } from "@/lib/api";
import { presenceColor, cn } from "@/lib/utils";

/**
 * Attributed changes renderer (audit trail): the document over a chosen
 * range, with each editor's insertions underlined in their presence color
 * and deletions struck through — the same color their live cursor has in
 * the editor, so "who did this" reads at a glance (Google Docs' "show
 * changes" model).
 */

function segmentStyle(seg: ChangeSegment): CSSProperties | undefined {
  if (!seg.change || !seg.authorId) {
    return seg.change === "removed" ? { textDecoration: "line-through", opacity: 0.55 } : undefined;
  }
  const color = presenceColor(seg.authorId);
  return seg.change === "added"
    ? { backgroundColor: `${color}1f`, borderBottom: `2px solid ${color}` }
    : { color, textDecoration: "line-through", opacity: 0.75 };
}

function segmentTitle(seg: ChangeSegment, names: Map<string, string>): string | undefined {
  if (!seg.change) return undefined;
  const who = (seg.authorId && names.get(seg.authorId)) || "Unknown user";
  const when = seg.ts ? ` · ${new Date(seg.ts).toLocaleString()}` : "";
  return `${seg.change === "added" ? "Added" : "Deleted"} by ${who}${when}`;
}

function Block({ block, names }: { block: ChangeBlock; names: Map<string, string> }) {
  const content =
    block.segments.length > 0 ? (
      block.segments.map((seg, i) => (
        <span
          key={i}
          className="whitespace-pre-wrap"
          style={segmentStyle(seg)}
          title={segmentTitle(seg, names)}
        >
          {seg.text}
        </span>
      ))
    ) : (
      <span>&nbsp;</span>
    );

  const removedBlock = block.change === "removed";
  if (block.type === "heading") {
    const sizes = ["text-2xl", "text-xl", "text-lg"] as const;
    return (
      <h3
        className={cn(
          "mt-4 mb-1 font-semibold",
          sizes[Math.min(Math.max((block.level ?? 1) - 1, 0), 2)],
          removedBlock && "opacity-60",
        )}
      >
        {content}
      </h3>
    );
  }
  if (block.type === "codeBlock" || block.type === "code_block") {
    return (
      <pre
        className={cn(
          "my-2 overflow-x-auto rounded bg-zinc-100 p-3 font-mono text-sm dark:bg-zinc-800",
          removedBlock && "opacity-60",
        )}
      >
        {content}
      </pre>
    );
  }
  return <p className={cn("my-1.5 leading-7", removedBlock && "opacity-60")}>{content}</p>;
}

export function ContributorLegend({ contributors }: { contributors: VersionContributor[] }) {
  if (contributors.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Edits by</p>
      {contributors.map((c) => (
        <span key={c.id} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: presenceColor(c.id) }}
          />
          {c.name ?? "Unknown user"}
        </span>
      ))}
    </div>
  );
}

export function ChangesView({ changes }: { changes: DocumentChanges }) {
  const names = new Map(changes.contributors.map((c) => [c.id, c.name ?? "Unknown user"]));
  const hasChanges = changes.blocks.some(
    (b) => b.change !== null || b.segments.some((s) => s.change !== null),
  );

  return (
    <div className="mx-auto my-6 w-full max-w-[820px] rounded-sm bg-white px-16 py-12 text-[15px] text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      {!hasChanges && (
        <p className="mb-6 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800">
          No changes in this range.
        </p>
      )}
      {changes.blocks.map((b, i) => (
        <Block key={i} block={b} names={names} />
      ))}
    </div>
  );
}
