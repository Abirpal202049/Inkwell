import { Router } from "express";
import { prisma, withUserContext } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import { inviteMemberSchema, patchMemberSchema, uuidSchema } from "@shared/schemas/api";
import { notifyRoleChange } from "../realtime/rooms.js";

export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth);

/** POST /api/documents/:docId/members — invite by email (owner only). */
membersRouter.post("/", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);

  const { email, role } = inviteMemberSchema.parse(req.body);
  const lowered = email.toLowerCase();

  const invitee = await prisma.user.findUnique({ where: { email: lowered } });

  if (!invitee) {
    // Invited-before-signup (plan/13): pending invite claimed on first sign-in.
    await prisma.pendingInvite.upsert({
      where: { documentId_email: { documentId, email: lowered } },
      create: { documentId, email: lowered, role, invitedBy: user.id },
      update: { role },
    });
    ok(res, { pending: true, email: lowered, role }, 201);
    return;
  }

  const existing = await prisma.documentMember.findUnique({
    where: { documentId_userId: { documentId, userId: invitee.id } },
  });
  if (existing) throw errors.conflict("Already a member");

  await withUserContext(user.id, (tx) =>
    tx.documentMember.create({
      data: { documentId, userId: invitee.id, role, grantedVia: "invite" },
    }),
  );
  ok(res, { userId: invitee.id, role }, 201);
});

/** PATCH /api/documents/:docId/members/:userId — change role (owner only). */
membersRouter.patch("/:userId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const targetUserId = uuidSchema.parse(req.params.userId);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);
  const { role } = patchMemberSchema.parse(req.body);

  const target = await prisma.documentMember.findUnique({
    where: { documentId_userId: { documentId, userId: targetUserId } },
  });
  if (!target) throw errors.notFound();
  if (target.role === "owner") throw errors.forbidden(); // no owner demotion

  await withUserContext(user.id, (tx) =>
    tx.documentMember.update({
      where: { documentId_userId: { documentId, userId: targetUserId } },
      data: { role },
    }),
  );

  // Live downgrade: flip open sockets to the new role immediately (plan/13).
  notifyRoleChange(documentId, targetUserId, role);
  ok(res, { userId: targetUserId, role });
});

/** DELETE /api/documents/:docId/members/:userId — owner, or self-removal. */
membersRouter.delete("/:userId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const targetUserId = uuidSchema.parse(req.params.userId);
  const membership = await resolveMembership(user.id, documentId);

  const isSelf = targetUserId === user.id;
  if (!isSelf) assertRole(membership, ["owner"]);

  const target = await prisma.documentMember.findUnique({
    where: { documentId_userId: { documentId, userId: targetUserId } },
  });
  if (!target) throw errors.notFound();
  if (target.role === "owner") throw errors.forbidden(); // owner can't be removed

  await withUserContext(user.id, (tx) =>
    tx.documentMember.delete({
      where: { documentId_userId: { documentId, userId: targetUserId } },
    }),
  );

  notifyRoleChange(documentId, targetUserId, null);
  ok(res, { removed: true });
});
