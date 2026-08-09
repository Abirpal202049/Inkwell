import { createGoogle, type GoogleProvider } from "@ai-sdk/google";
import { env } from "../env.js";
import { AI_DEFAULT_MODEL } from "@shared/constants";

/**
 * The single seam between Inkwell and its inference provider (plan/08).
 * Everything else imports `aiModel()` — swapping Gemini for Groq/OpenAI/
 * Anthropic later means changing only this file (and the env var).
 *
 * No API key → `aiEnabled()` is false and every AI endpoint degrades to a
 * clear 503; core editing is never affected (plan/08 §Implementation).
 */

let provider: GoogleProvider | null = null;

export function aiEnabled(): boolean {
  return Boolean(env.googleAiApiKey);
}

export function aiModelId(): string {
  return env.aiModelId ?? AI_DEFAULT_MODEL;
}

export function aiModel() {
  provider ??= createGoogle({ apiKey: env.googleAiApiKey });
  return provider(aiModelId());
}

/**
 * Gemini 2.5 Flash spends `maxOutputTokens` on hidden "thinking" by
 * default, which can eat most of a small budget and truncate the actual
 * answer. Our tasks are simple text jobs — disable thinking on flash
 * models (2.5 Pro rejects a zero budget, so gate on the model id).
 */
export function aiProviderOptions() {
  if (!aiModelId().includes("flash")) return undefined;
  return { google: { thinkingConfig: { thinkingBudget: 0 } } };
}
