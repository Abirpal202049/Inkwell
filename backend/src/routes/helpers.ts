import type { Request } from "express";
import type { DocumentRole } from "@prisma/client";
import { prisma } from "../db.js";
import { errors } from "../http.js";
import { uuidSchema } from "@shared/schemas/api";

export function docIdParam(req: Request): string {
  const parsed = uuidSchema.safeParse(req.params.docId);
  if (!parsed.success) throw errors.notFound();
  return parsed.data;
}

export interface Membership {
  role: DocumentRole;
  documentId: string;
}

/**
 * Resolve the caller's role on a document. Implements link-sharing
 * auto-join (plan/14 §5): a signed-in non-member opening a link-shared
 * doc is inserted as a member with the link's role, so RLS remains the
 * single enforcement model. Soft-deleted docs 404.
 */
export async function resolveMembership(
  userId: string,
  documentId: string,
  opts: { autoJoinViaLink?: boolean } = {},
): Promise<Membership> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { shareMode: true },
  });
  if (!doc) throw errors.notFound();

  const member = await prisma.documentMember.findUnique({
    where: { documentId_userId: { documentId, userId } },
  });
  if (member) return { role: member.role, documentId };

  if (opts.autoJoinViaLink && doc.shareMode !== "private") {
    const role: DocumentRole = doc.shareMode === "link_edit" ? "editor" : "viewer";
    const created = await prisma.documentMember.create({
      data: { documentId, userId, role, grantedVia: "link" },
    });
    return { role: created.role, documentId };
  }

  // Non-member: 404, not 403 — never leak existence (plan/13 §Errors).
  throw errors.notFound();
}

export function assertRole(m: Membership, allowed: DocumentRole[]): void {
  if (!allowed.includes(m.role)) throw errors.forbidden();
}
