import type { z } from "zod";
import type { aiGenerateSchema, aiActionSchema } from "./schemas/api";

/**
 * Client for the AI endpoints (plan/08). Unlike lib/api.ts's json()
 * helper, generation responses are chunked text/plain streams — read
 * incrementally so words appear as the model writes them.
 */

export type AiAction = z.infer<typeof aiActionSchema>;
export type AiGenerateRequest = z.infer<typeof aiGenerateSchema>;

export interface AiStreamResult {
  ok: boolean;
  /** Error envelope code (AI_UNAVAILABLE, RATE_LIMITED, …) or "NETWORK". */
  errorCode?: string;
  /** True when the caller aborted; any partial output was already delivered. */
  aborted?: boolean;
}

/** Whether the backend has an AI provider configured (null = unreachable). */
export async function getAiStatus(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/ai/status");
    if (!res.ok) return null;
    const body = await res.json();
    return Boolean(body?.data?.enabled);
  } catch {
    return null;
  }
}

async function streamPost(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiStreamResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let code = "AI_FAILED";
      try {
        const envelope = await res.json();
        code = envelope?.error?.code ?? code;
      } catch {
        // non-JSON error body — keep the generic code
      }
      return { ok: false, errorCode: code };
    }
    if (!res.body) return { ok: false, errorCode: "AI_FAILED" };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) onChunk(text);
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, aborted: true };
    }
    return { ok: false, errorCode: "NETWORK" };
  }
}

/** Streamed writing help; requires editor role (403 for viewers). */
export function streamAiGenerate(
  docId: string,
  request: AiGenerateRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiStreamResult> {
  return streamPost(`/api/documents/${docId}/ai/generate`, request, onChunk, signal);
}

/** Streamed summary of the document — or of `selection` when given.
 *  Any member may request one. */
export function streamAiSummary(
  docId: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  selection?: string,
): Promise<AiStreamResult> {
  return streamPost(
    `/api/documents/${docId}/ai/summarize`,
    selection ? { selection } : {},
    onChunk,
    signal,
  );
}

/** Human-readable message for an AI error code. */
export function aiErrorMessage(code?: string): string {
  switch (code) {
    case "AI_UNAVAILABLE":
      return "AI features aren't configured on this server.";
    case "RATE_LIMITED":
      return "Too many AI requests — wait a minute and try again.";
    case "FORBIDDEN":
      return "You need edit access to use AI writing.";
    case "NETWORK":
      return "AI needs a connection — you appear to be offline.";
    default:
      return "AI generation failed — please try again.";
  }
}
