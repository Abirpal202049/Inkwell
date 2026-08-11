/**
 * Pure text transforms for speech-to-text (dictation). Browser speech
 * recognition returns raw lowercase-ish word streams with unreliable
 * punctuation; these functions turn spoken commands into real characters
 * and decide spacing/capitalization at the insertion point. Kept pure so
 * they're unit-testable without a browser (the prompts.ts style).
 */

/** Spoken phrases → characters. Longer phrases must match first. */
const COMMANDS: [RegExp, string][] = [
  [/\bnew\s+paragraph\b/gi, "\n\n"],
  [/\bnew\s+line\b/gi, "\n"],
  [/\bfull\s+stop\b/gi, "."],
  [/\bperiod\b/gi, "."],
  [/\bcomma\b/gi, ","],
  [/\bquestion\s+mark\b/gi, "?"],
  [/\bexclamation\s+(?:mark|point)\b/gi, "!"],
  [/\bsemicolon\b/gi, ";"],
  [/\bsemi\s+colon\b/gi, ";"],
  [/\bcolon\b/gi, ":"],
  [/\bopen\s+quote\b/gi, "“"],
  [/\bclose\s+quote\b/gi, "”"],
];

/**
 * Replace spoken punctuation/navigation commands with their characters,
 * then normalize whitespace around them: punctuation attaches to the
 * preceding word; newlines swallow surrounding spaces.
 */
export function applyVoiceCommands(raw: string): string {
  let text = raw;
  for (const [pattern, replacement] of COMMANDS) {
    text = text.replace(pattern, replacement);
  }
  return (
    text
      // punctuation hugs the word before it: "hello ." → "hello."
      .replace(/[ \t]+([.,!?;:”])/g, "$1")
      // opening quotes hug the word after them
      .replace(/“[ \t]+/g, "“")
      // newlines swallow surrounding spaces
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      // collapse runs of spaces the replacements may have produced
      .replace(/[ \t]{2,}/g, " ")
  );
}

/** Uppercase the first letter of each sentence within the segment. */
function capitalizeSentences(text: string, capitalizeFirst: boolean): string {
  let out = text.replace(/([.!?]\s+|\n+\s*)(\p{Ll})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  if (capitalizeFirst) out = out.replace(/^(\s*)(\p{Ll})/u, (_m, ws: string, ch: string) => ws + ch.toUpperCase());
  return out;
}

/**
 * Prepare a finalized transcript segment for insertion at the caret.
 *
 * `prevText` is the document text immediately before the caret (the tail
 * of the current block is enough; "" at the start of a block). It decides:
 * - leading space: needed when gluing onto a word ("hello" + "world"),
 *   not after whitespace/opening brackets/quotes or at a block start,
 *   and never when the segment starts with punctuation or a newline;
 * - capitalization: at a block start or after sentence-ending punctuation.
 */
export function formatSegment(raw: string, prevText: string): string {
  let text = applyVoiceCommands(raw).replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  if (!text) return "";

  const trimmedPrev = prevText.replace(/[ \t]+$/, "");
  const prevChar = prevText.slice(-1);
  const lastMeaningful = trimmedPrev.slice(-1);

  const capitalize = trimmedPrev === "" || /[.!?]/.test(lastMeaningful);
  text = capitalizeSentences(text, capitalize);

  const startsWithGlue = /^[.,!?;:”\n]/.test(text);
  const noSpaceAfter = prevChar === "" || /[\s([{“'"—-]/.test(prevChar);
  if (!startsWithGlue && !noSpaceAfter) text = " " + text;

  return text;
}
