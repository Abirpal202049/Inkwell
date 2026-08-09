import type { z } from "zod";
import type { aiGenerateSchema } from "@shared/schemas/api";
import { AI_LABEL_CONTEXT_MAX_CHARS } from "@shared/constants";

/**
 * Prompt construction for every AI feature, kept as pure functions so
 * they're unit-testable without a model (plan/09 testing style).
 *
 * All document text arrives pre-capped by the wire schemas (client
 * inputs) or extractDocText (server-side reads), so prompts here have a
 * bounded size by construction.
 */

type AiGenerate = z.infer<typeof aiGenerateSchema>;

const WRITER_SYSTEM = [
  "You are a writing assistant inside a collaborative document editor.",
  "Return ONLY the text to be inserted into the document - no preamble,",
  "no explanations, no markdown fences, no surrounding quotes. Write in",
  "plain prose; use blank lines between paragraphs. Match the language,",
  "tone and tense of the provided document text.",
].join(" ");

export function buildGeneratePrompt(req: AiGenerate): { system: string; prompt: string } {
  const context = req.context?.trim();
  const selection = req.selection?.trim();

  switch (req.action) {
    case "continue":
      return {
        system: WRITER_SYSTEM,
        prompt: [
          "Continue writing the document below from where it stops.",
          "Write the next passage (a sentence up to a few paragraphs -",
          "match the document's rhythm). Do not repeat existing text.",
          "",
          "--- document (may be truncated at the start) ---",
          context || "(the document is empty - start it)",
        ].join("\n"),
      };
    case "concise":
      return {
        system: WRITER_SYSTEM,
        prompt: [
          "Rewrite the passage below to be more concise. Preserve meaning,",
          "facts and the author's voice. Return only the rewritten passage.",
          "",
          "--- passage ---",
          selection ?? "",
        ].join("\n"),
      };
    case "grammar":
      return {
        system: WRITER_SYSTEM,
        prompt: [
          "Fix spelling, grammar and punctuation in the passage below.",
          "Change nothing else - keep wording and style as-is wherever",
          "correct. Return only the corrected passage.",
          "",
          "--- passage ---",
          selection ?? "",
        ].join("\n"),
      };
    case "custom":
      return {
        system: WRITER_SYSTEM,
        prompt: [
          `Instruction from the author: ${req.prompt ?? ""}`,
          "",
          selection
            ? `--- selected passage the instruction applies to ---\n${selection}`
            : `--- document so far (may be truncated; your text will be inserted at the end) ---\n${context ?? "(empty document)"}`,
        ].join("\n"),
      };
  }
}

export const SUMMARY_SYSTEM = [
  "You summarize documents for their readers. Produce a compact summary:",
  "2-4 short paragraphs or up to 6 bullet points, whichever fits the",
  "content better. Scale the summary to the input - a short passage gets",
  "a sentence or two. Plain text only - no markdown headings or fences.",
  "Use the text's own language.",
].join(" ");

export function buildSummaryPrompt(text: string, scope: "document" | "selection" = "document"): string {
  return scope === "selection"
    ? `Summarize the following passage selected from a larger document.\n\n--- passage ---\n${text}`
    : `Summarize the following document.\n\n--- document ---\n${text}`;
}

const LABEL_SYSTEM = [
  "You label document versions. Given the previous and current text of a",
  "document, describe what changed in at most 8 words - like a terse,",
  "specific commit subject (e.g. \"Restructured intro, added pricing",
  "section\"). Plain text only: no quotes, no trailing period, no",
  "prefixes like 'Changed:'. If everything is new, describe the content.",
].join(" ");

export function buildLabelPrompt(
  prevText: string | null,
  currText: string,
): { system: string; prompt: string } {
  const cap = (s: string) => s.slice(0, AI_LABEL_CONTEXT_MAX_CHARS);
  return {
    system: LABEL_SYSTEM,
    prompt: [
      "--- previous version ---",
      prevText === null ? "(no previous version - this is the first snapshot)" : cap(prevText),
      "",
      "--- current version ---",
      cap(currText),
    ].join("\n"),
  };
}

/** Normalize model output into a storable label (schema caps at 120). */
export function sanitizeLabel(raw: string): string | null {
  const label = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .slice(0, 120)
    .trim();
  return label.length > 0 ? label : null;
}
