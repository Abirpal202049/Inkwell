import { generateText } from "ai";
import { aiEnabled, aiModel, aiProviderOptions } from "./client.js";
import { buildLabelPrompt, sanitizeLabel } from "./prompts.js";
import { AI_LABEL_TIMEOUT_MS, AI_LABEL_MAX_TOKENS } from "@shared/constants";

/**
 * Auto-label for unlabeled manual snapshots (plan/08 §3): propose a short
 * description of what changed since the previous version. Strictly
 * best-effort — any failure (no key, timeout, provider error) returns
 * null and the caller falls back to the dated label. Version creation
 * itself must never fail or block on AI (plan/08 §Implementation).
 */
export async function suggestVersionLabel(
  prevText: string | null,
  currText: string,
): Promise<string | null> {
  if (!aiEnabled() || currText.trim().length === 0) return null;
  try {
    const { system, prompt } = buildLabelPrompt(prevText, currText);
    const { text } = await generateText({
      model: aiModel(),
      system,
      prompt,
      maxOutputTokens: AI_LABEL_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(AI_LABEL_TIMEOUT_MS),
      providerOptions: aiProviderOptions(),
    });
    return sanitizeLabel(text);
  } catch {
    return null;
  }
}
