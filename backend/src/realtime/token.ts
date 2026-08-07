import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { requireEnv } from "../env.js";
import { TOKEN_TTL_S } from "@shared/constants";
import type { DocumentRole } from "@shared/schemas/api";

/**
 * Short-lived, single-use WS connect tickets (plan/13 §Realtime Token):
 * 60s TTL, jti recorded in an in-memory LRU so a leaked token is
 * near-useless. Role is resolved fresh at mint time.
 */

export interface CollabTokenClaims {
  sub: string; // userId
  doc: string; // documentId
  role: DocumentRole;
  name: string;
  image: string | null;
  jti: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("collabJwtSecret"));
}

export async function mintCollabToken(
  claims: Omit<CollabTokenClaims, "jti">,
): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({
    doc: claims.doc,
    role: claims.role,
    name: claims.name,
    image: claims.image,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_S}s`)
    .sign(secretKey());
  return { token, expiresIn: TOKEN_TTL_S };
}

/** jti anti-replay: remember seen ids for 10 minutes (>> token TTL). */
const seenJtis = new Map<string, number>();
const JTI_RETENTION_MS = 10 * 60 * 1000;

function pruneJtis(): void {
  const cutoff = Date.now() - JTI_RETENTION_MS;
  for (const [jti, at] of seenJtis) if (at < cutoff) seenJtis.delete(jti);
}

export async function verifyCollabToken(token: string): Promise<CollabTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const { sub, jti } = payload;
    const doc = payload.doc as string | undefined;
    const role = payload.role as DocumentRole | undefined;
    if (!sub || !jti || !doc || !role) return null;
    if (seenJtis.has(jti)) return null; // single-use
    seenJtis.set(jti, Date.now());
    if (seenJtis.size > 10_000) pruneJtis();
    return {
      sub,
      doc,
      role,
      jti,
      name: (payload.name as string) ?? "Anonymous",
      image: (payload.image as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
