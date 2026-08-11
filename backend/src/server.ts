import { createServer } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { env } from "./env.js";
import { authHandler, attachSession } from "./auth.js";
import { documentsRouter } from "./routes/documents.js";
import { membersRouter } from "./routes/members.js";
import { versionsRouter } from "./routes/versions.js";
import { changesRouter } from "./routes/changes.js";
import { aiRouter, aiStatusRouter } from "./routes/ai.js";
import { attachRealtime } from "./realtime/index.js";
import { startPruneScheduler } from "./persistence/prune.js";
import { ApiError } from "./http.js";

/**
 * The Inkwell backend: one Node process serving REST (Express),
 * OAuth (@auth/express) and the realtime WebSocket (ws) — plan/01.
 * Next.js proxies /api/* here; the WS connects directly to /doc.
 */

const app = express();
app.set("trust proxy", true);
// Explicit body cap — malformed/oversized payloads die here, not in a
// handler (plan/06 §2). Express returns 413 beyond this.
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// The Next.js rewrite proxy targets this process directly, so the Host
// header is our internal host — but Auth.js builds OAuth redirect_uris
// from it. Restore the original public host from X-Forwarded-Host (sent
// by Next's proxy and by production load balancers) so redirect_uris
// match the callback URLs registered with Google/GitHub.
app.use((req, _res, next) => {
  const forwardedHost = req.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.length > 0) {
    req.headers.host = forwardedHost;
  }
  next();
});

// Auth.js: /api/auth/* (signin, callback, session, signout).
// Plain prefix mount — a wildcard pattern here would strip the action
// segment from req.url before Auth.js routes on it.
app.use("/api/auth", authHandler);

// Session-aware REST routes.
app.use("/api", attachSession);
app.use("/api/documents", documentsRouter);
app.use("/api/documents/:docId/members", membersRouter);
app.use("/api/documents/:docId/versions", versionsRouter);
app.use("/api/documents/:docId/changes", changesRouter);
// AI add-ons (plan/08): doc-scoped generation/summarize + global status.
app.use("/api/documents/:docId/ai", aiRouter);
app.use("/api/ai", aiStatusRouter);
// restore lives under versionsRouter as POST /restore — expose the
// contract path too (plan/13): /api/documents/:docId/restore
app.use("/api/documents/:docId/restore", (req, _res, next) => {
  req.url = "/restore";
  versionsRouter(req, _res, next);
});

// Error envelope (plan/13 §Errors).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      error: {
        code: "INVALID_PAYLOAD",
        message: env.isProd ? "Invalid request payload" : err.message,
      },
    });
    return;
  }
  // body-parser limit errors (e.g. an oversized audio clip) are
  // http-errors with a status, not ApiErrors — map the envelope code.
  if (err && typeof err === "object" && (err as { status?: unknown }).status === 413) {
    res.status(413).json({
      ok: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  console.error("[internal]", err);
  res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Internal error" } });
});

const server = createServer(app);
attachRealtime(server);
// Retention pruning (plan/11): folded doc_updates past retention +
// stale idempotency ledger rows.
startPruneScheduler();

server.listen(env.port, () => {
  console.log(`inkwell-backend listening on :${env.port} (${env.nodeEnv})`);
});
