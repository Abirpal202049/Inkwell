# AI Add-On Features

Using the **Vercel AI SDK** (`ai` package) with a fast/cheap-inference
provider (Groq — Llama models, low latency — or Gemini Flash) as the primary
target, keeping the provider swappable behind a single `lib/ai/client.ts`.
AI features are explicitly **add-ons layered on top of the core sync
engine**, not the core deliverable — scoped to be genuinely useful without
risking project timeline.

## Planned Features (roughly priority order)

1. **AI-assisted writing (inline slash command `/ai`)** — select text or
   place cursor, invoke a prompt ("continue writing", "make more concise",
   "fix grammar"); streamed completion is inserted as a real CRDT edit
   (goes through the same `Y.Doc` transaction as human typing) so it's
   naturally offline-safe, mergeable, and versioned like any other edit. If
   offline, the action is simply disabled with an explanatory tooltip (AI
   calls require network; this is the one deliberate exception to "works
   fully offline," clearly communicated in the UI).
2. **Smart summarization** — "Summarize this document" button generates a
   short summary shown in a side panel and optionally saved as document
   metadata (searchable from a future document list view).
3. **Auto-generated version labels** — when a user creates a manual
   snapshot without typing a label, an AI call proposes one based on a diff
   against the previous version (e.g. "Restructured intro, added pricing
   section") — makes the version timeline actually scannable at a glance.
4. **Semantic conflict/merge summary (stretch)** — after a big reconnect
   merge (many concurrent edits from multiple offline users reconciled at
   once), show a plain-English summary of what changed ("Alice rewrote
   paragraph 2, Bob added a table") derived from a diff — pure UX sugar on
   top of the deterministic CRDT merge, never influences the merge itself.
5. **Command palette search (stretch)** — natural-language search across a
   user's documents ("find the doc where we discussed pricing") using
   embeddings stored in Postgres (`pgvector`).

## Implementation Notes

- All AI endpoints are separate Route Handlers (`/api/ai/*`), rate-limited
  and auth-checked identically to other API routes — Viewers can request
  summaries (read-only op) but not "continue writing" (a write op).
- Streaming responses via AI SDK's `streamText`/`useChat`/`useCompletion`
  hooks for responsive UX.
- AI-inserted content is visually tagged (subtle highlight) until the user's
  next keystroke, so provenance is clear without being intrusive — an
  explicit answer to "how do you keep AI content distinguishable/trustworthy."
- No AI call is ever in the critical path of core sync/save — this keeps
  the "AI is a plus" requirement honestly scoped as additive.
