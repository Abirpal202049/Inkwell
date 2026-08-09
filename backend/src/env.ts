import "dotenv/config";

/**
 * Typed environment access. Nothing else reads process.env directly.
 * Missing DB/OAuth values don't crash boot — the server starts, /healthz
 * works, and affected endpoints fail with clear errors — so local dev is
 * possible before secrets exist (plan/15 Stage C).
 */
export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",

  databaseUrl: process.env.DATABASE_URL,

  authSecret: process.env.AUTH_SECRET,
  authUrl: process.env.AUTH_URL,

  collabJwtSecret: process.env.COLLAB_JWT_SECRET,

  /** Allowed Origin header for the WS upgrade (browser connections). */
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",

  /** Gemini key (Google AI Studio). Absent → AI features report disabled. */
  googleAiApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  /** Optional model override; default lives in @shared/constants. */
  aiModelId: process.env.AI_MODEL,

  get isProd() {
    return this.nodeEnv === "production";
  },
} as const;

export function requireEnv(name: "collabJwtSecret" | "authSecret"): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var for ${name}`);
  return value;
}
