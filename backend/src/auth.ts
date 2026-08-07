import { ExpressAuth, getSession, type ExpressAuthConfig } from "@auth/express";
import Google from "@auth/express/providers/google";
import GitHub from "@auth/express/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { errors } from "./http.js";

/**
 * Auth.js mounted on Express (plan/06). Google + GitHub only — no
 * password provider. JWT sessions so the realtime layer can verify
 * identity statelessly. Auto-linking by verified email is safe for these
 * two specific providers (both return verified primary emails).
 */
export const authConfig: ExpressAuthConfig = {
  basePath: "/api/auth",
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    GitHub({ allowDangerousEmailAccountLinking: true }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    /**
     * Invited-before-signup flow (plan/13 §Membership): claim any pending
     * invites matching this verified email on every sign-in (idempotent).
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      const userId = user.id;
      if (!email || !userId) return;
      const invites = await prisma.pendingInvite.findMany({ where: { email } });
      for (const invite of invites) {
        await prisma.$transaction([
          prisma.documentMember.upsert({
            where: { documentId_userId: { documentId: invite.documentId, userId } },
            create: {
              documentId: invite.documentId,
              userId,
              role: invite.role,
              grantedVia: "invite",
            },
            update: {},
          }),
          prisma.pendingInvite.delete({
            where: { documentId_email: { documentId: invite.documentId, email } },
          }),
        ]);
      }
    },
  },
};

export const authHandler = ExpressAuth(authConfig);

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

declare global {
  namespace Express {
    interface Locals {
      user?: SessionUser;
    }
  }
}

/** Resolves the Auth.js session (if any) and attaches it to res.locals.
 *  Failures (e.g. AUTH_SECRET not configured yet) degrade to "no
 *  session" so guarded routes 401 instead of 500. */
export async function attachSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await getSession(req, authConfig).catch(() => null);
  const u = session?.user;
  if (u?.id && u.email) {
    res.locals.user = {
      id: u.id,
      email: u.email.toLowerCase(),
      name: u.name ?? null,
      image: u.image ?? null,
    };
  }
  next();
}

export function requireAuth(_req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.user) return next(errors.unauthenticated());
  next();
}
