import type { Response } from "express";

/** Response envelope per plan/13 §Global Conventions. */

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const errors = {
  invalidPayload: (msg?: string) => new ApiError(400, "INVALID_PAYLOAD", msg),
  unauthenticated: () => new ApiError(401, "UNAUTHENTICATED"),
  forbidden: () => new ApiError(403, "FORBIDDEN"),
  /** 404 (not 403) for non-members — never leak document existence. */
  notFound: () => new ApiError(404, "NOT_FOUND"),
  conflict: (msg?: string) => new ApiError(409, "CONFLICT", msg),
  tooLarge: () => new ApiError(413, "PAYLOAD_TOO_LARGE"),
  rateLimited: () => new ApiError(429, "RATE_LIMITED"),
};
