import type { RequestHandler } from "express";
import { errors } from "../http.js";
import { AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS } from "@shared/constants";

/**
 * Per-user fixed-window limiter for the AI endpoints (plan/08
 * §Implementation: "rate-limited and auth-checked identically to other
 * API routes"). In-memory like the WS token bucket in realtime/index.ts —
 * fine for the single-process deployment; a multi-node deploy would move
 * this to Redis behind the same interface.
 */

export interface RateLimiter {
  /** True when the caller is within budget (and the hit is recorded). */
  allow(key: string, now?: number): boolean;
}

export function createRateLimiter(max: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key, now = Date.now()) {
      // Opportunistic sweep so abandoned keys never accumulate.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) {
          if (now - w.start >= windowMs) windows.delete(k);
        }
      }
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      w.count++;
      return w.count <= max;
    },
  };
}

const limiter = createRateLimiter(AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS);

export const aiRateLimit: RequestHandler = (req, res, next) => {
  const key = res.locals.user?.id ?? req.ip ?? "anonymous";
  if (!limiter.allow(key)) {
    next(errors.rateLimited());
    return;
  }
  next();
};
