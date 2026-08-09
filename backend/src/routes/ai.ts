import { Router, type Response } from "express";
import { streamText } from "ai";
import { ok, errors, ApiError } from "../http.js";
import { requireAuth } from "../auth.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import { aiGenerateSchema, aiSummarizeSchema } from "@shared/schemas/api";
import {
  AI_DOC_CONTEXT_MAX_CHARS,
  AI_GENERATE_MAX_TOKENS,
  AI_SUMMARY_MAX_TOKENS,
} from "@shared/constants";
import { aiEnabled, aiModel, aiProviderOptions } from "../ai/client.js";
import { aiRateLimit } from "../ai/rate-limit.js";
import { buildGeneratePrompt, buildSummaryPrompt, SUMMARY_SYSTEM } from "../ai/prompts.js";
import { extractDocText } from "../ai/text.js";
import { loadDocState } from "../persistence/doc-store.js";
import { getLiveDocState } from "../realtime/rooms.js";

/**
 * AI endpoints (plan/08). Doc-scoped routes reuse the standard
 * membership/role checks: summarize is a read op (any member), generate
 * is a write op (owner|editor) — plan/08 §Implementation. Nothing here is
 * ever in the critical path of sync or save.
 */

/** GET /api/ai/status — lets the UI show/hide AI affordances. */
export const aiStatusRouter = Router();
aiStatusRouter.get("/status", requireAuth, (_req, res) => {
  ok(res, { enabled: aiEnabled() });
});

export const aiRouter = Router({ mergeParams: true });
aiRouter.use(requireAuth, aiRateLimit);

function requireAi(): void {
  if (!aiEnabled()) throw errors.aiUnavailable();
}

/**
 * Pipe a streamText result to the response as chunked text/plain.
 * Headers are only sent once the first chunk arrives, so provider errors
 * that occur before any output still produce a clean JSON error envelope
 * (thrown here, caught by the global handler). Mid-stream failures can
 * only truncate — the client treats an aborted body as a partial result.
 */
async function pipeText(res: Response, result: ReturnType<typeof streamText>): Promise<void> {
  let started = false;
  try {
    for await (const chunk of result.textStream) {
      if (!started) {
        started = true;
        res.status(200).set({
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          // Disable proxy buffering so chunks reach the browser live.
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
      }
      res.write(chunk);
    }
    if (!started) throw errors.aiFailed("Model returned no output");
    res.end();
  } catch (err) {
    if (!started) {
      if (err instanceof ApiError) throw err;
      // Provider errors (quota, billing, invalid key, timeouts) are
      // expected operational states, not internal bugs — surface them as
      // a clean 502 with the provider's reason for the server log.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn("[ai] generation failed:", reason);
      throw errors.aiFailed();
    }
    res.end();
  }
}

/** POST /generate — streamed writing help; a WRITE op (owner|editor). */
aiRouter.post("/generate", async (req, res) => {
  requireAi();
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner", "editor"]);
  const body = aiGenerateSchema.parse(req.body);

  const { system, prompt } = buildGeneratePrompt(body);
  const result = streamText({
    model: aiModel(),
    system,
    prompt,
    maxOutputTokens: AI_GENERATE_MAX_TOKENS,
    providerOptions: aiProviderOptions(),
  });
  await pipeText(res, result);
});

/** POST /summarize — streamed summary of the document or, when a
 *  `selection` is sent, of just that passage. A READ op (any member). */
aiRouter.post("/summarize", async (req, res) => {
  requireAi();
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  await resolveMembership(user.id, documentId);
  const { selection } = aiSummarizeSchema.parse(req.body);

  let text: string;
  if (selection) {
    text = selection;
  } else {
    const state = getLiveDocState(documentId) ?? (await loadDocState(documentId));
    text = state ? extractDocText(state, AI_DOC_CONTEXT_MAX_CHARS) : "";
  }
  if (text.trim().length === 0) throw errors.conflict("Document has no content to summarize");

  const result = streamText({
    model: aiModel(),
    system: SUMMARY_SYSTEM,
    prompt: buildSummaryPrompt(text, selection ? "selection" : "document"),
    maxOutputTokens: AI_SUMMARY_MAX_TOKENS,
    providerOptions: aiProviderOptions(),
  });
  await pipeText(res, result);
});
