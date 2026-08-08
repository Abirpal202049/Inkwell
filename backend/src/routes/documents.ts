import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma, withUserContext } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { mintCollabToken } from "../realtime/token.js";
import { notifyRoleChange, kickAnonymous, closeRoomForDelete } from "../realtime/rooms.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import {
  createDocumentSchema,
  patchDocumentSchema,
  listQuerySchema,
} from "@shared/schemas/api";
import { DEFAULT_DOC_TITLE } from "@shared/constants";
import { env } from "../env.js";

export const documentsRouter = Router();
// No blanket requireAuth: GET /:docId and POST /:docId/token additionally
// serve anonymous visitors of link-shared documents (read-only), matching
// Docs' "Anyone with the link" behavior. Every other route requires auth.

/** GET /api/documents — the caller's documents, updatedAt desc. */
documentsRouter.get("/", requireAuth, async (req, res) => {
  const user = res.locals.user!;
  const { cursor, limit } = listQuerySchema.parse(req.query);

  const docs = await withUserContext(user.id, (tx) =>
    tx.document.findMany({
      where: { deletedAt: null, members: { some: { userId: user.id } } },
      select: {
        id: true,
        title: true,
        shareMode: true,
        updatedAt: true,
        owner: { select: { id: true, name: true } },
        members: { where: { userId: user.id }, select: { role: true } },
        _count: { select: { members: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  );

  const page = docs.slice(0, limit);
  ok(res, {
    documents: page.map((d) => ({
      id: d.id,
      title: d.title,
      role: d.members[0]?.role ?? "viewer",
      shareMode: d.shareMode.replace("_", "-"),
      updatedAt: d.updatedAt.toISOString(),
      ownerId: d.owner.id,
      ownerName: d.owner.name,
      memberCount: d._count.members,
    })),
    nextCursor: docs.length > limit ? page[page.length - 1]?.id : null,
  });
});

/** POST /api/documents — create; accepts a client-generated id so docs
 *  created offline keep their identity when they first sync. */
documentsRouter.post("/", requireAuth, async (req, res) => {
  const user = res.locals.user!;
  const body = createDocumentSchema.parse(req.body);

  if (body.id) {
    const existing = await prisma.document.findUnique({ where: { id: body.id } });
    if (existing) throw errors.conflict("Document id already exists");
  }

  const doc = await withUserContext(user.id, (tx) =>
    tx.document.create({
      data: {
        ...(body.id && { id: body.id }),
        title: body.title ?? DEFAULT_DOC_TITLE,
        ownerId: user.id,
        members: { create: { userId: user.id, role: "owner" } },
      },
      select: { id: true },
    }),
  );
  ok(res, { id: doc.id }, 201);
});

/** Link-shared doc lookup for anonymous callers; 404s private docs
 *  without leaking their existence. */
async function findLinkSharedDoc(documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: {
      id: true,
      title: true,
      shareMode: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      _count: { select: { members: true } },
    },
  });
  if (!doc || doc.shareMode === "private") throw errors.notFound();
  return doc;
}

/** GET /api/documents/:docId — metadata; auto-joins signed-in visitors
 *  via share link; anonymous visitors get read-only metadata when the
 *  doc is link-shared. */
documentsRouter.get("/:docId", async (req, res) => {
  const documentId = docIdParam(req);

  if (!res.locals.user) {
    const doc = await findLinkSharedDoc(documentId);
    ok(res, {
      id: doc.id,
      title: doc.title,
      role: "viewer",
      shareMode: doc.shareMode.replace("_", "-"),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      owner: doc.owner,
      memberCount: doc._count.members,
    });
    return;
  }

  const user = res.locals.user;
  const membership = await resolveMembership(user.id, documentId, { autoJoinViaLink: true });

  const doc = await withUserContext(user.id, (tx) =>
    tx.document.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        shareMode: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, image: true } },
        members: {
          select: {
            userId: true,
            role: true,
            grantedVia: true,
            user: { select: { name: true, image: true, email: true } },
          },
        },
      },
    }),
  );

  ok(res, {
    id: doc.id,
    title: doc.title,
    role: membership.role,
    shareMode: doc.shareMode.replace("_", "-"),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    owner: doc.owner,
    // Roster only for the owner (plan/13) — others see the count.
    members:
      membership.role === "owner"
        ? doc.members.map((m) => ({
            userId: m.userId,
            role: m.role,
            grantedVia: m.grantedVia,
            name: m.user.name,
            image: m.user.image,
            email: m.user.email,
          }))
        : undefined,
    memberCount: doc.members.length,
  });
});

/** PATCH /api/documents/:docId — title/shareMode (owner only). */
documentsRouter.patch("/:docId", requireAuth, async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);
  const body = patchDocumentSchema.parse(req.body);

  const { updated, revokedUserIds } = await withUserContext(user.id, async (tx) => {
    // Downgrading to private revokes link-granted access (plan/14 §5),
    // but keeps directly-invited members.
    let revoked: string[] = [];
    if (body.shareMode === "private") {
      revoked = (
        await tx.documentMember.findMany({
          where: { documentId, grantedVia: "link" },
          select: { userId: true },
        })
      ).map((m) => m.userId);
      await tx.documentMember.deleteMany({
        where: { documentId, grantedVia: "link" },
      });
    }
    const doc = await tx.document.update({
      where: { id: documentId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.shareMode !== undefined && {
          shareMode: body.shareMode.replace("-", "_") as "private" | "link_view" | "link_edit",
        }),
      },
      select: { id: true, title: true, shareMode: true },
    });
    return { updated: doc, revokedUserIds: revoked };
  });

  // Restricted takes effect immediately: cut live link-granted and
  // anonymous connections instead of waiting for their next connect.
  if (body.shareMode === "private") {
    for (const uid of revokedUserIds) notifyRoleChange(documentId, uid, null);
    kickAnonymous(documentId);
  }

  ok(res, {
    id: updated.id,
    title: updated.title,
    shareMode: updated.shareMode.replace("_", "-"),
  });
});

/** DELETE /api/documents/:docId — HARD delete (owner only). The row and,
 *  via ON DELETE CASCADE, its members, pending invites, update log,
 *  compaction state, version history, processed batches, and comments are
 *  all permanently removed. Live collaborators are disconnected first
 *  (close code 4410) so nothing re-persists mid-wipe. Irreversible. */
documentsRouter.delete("/:docId", requireAuth, async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);

  closeRoomForDelete(documentId);
  await withUserContext(user.id, (tx) =>
    tx.document.delete({ where: { id: documentId } }),
  );
  ok(res, { deleted: true });
});

/** POST /api/documents/:docId/token — mint the 60s single-use WS ticket.
 *  Anonymous callers get a viewer ticket for link-shared docs; the WS
 *  layer independently drops write frames from viewers. */
documentsRouter.post("/:docId/token", async (req, res) => {
  const documentId = docIdParam(req);
  const user = res.locals.user;

  let claims;
  if (user) {
    const membership = await resolveMembership(user.id, documentId);
    claims = {
      sub: user.id,
      doc: documentId,
      role: membership.role,
      name: user.name ?? user.email,
      image: user.image,
    };
  } else {
    await findLinkSharedDoc(documentId);
    claims = {
      sub: `anon:${randomUUID()}`,
      doc: documentId,
      role: "viewer" as const,
      name: "Anonymous",
      image: null,
    };
  }

  const { token, expiresIn } = await mintCollabToken(claims);

  const wsProto = env.isProd ? "wss" : "ws";
  ok(res, {
    token,
    wsUrl: `${wsProto}://${req.get("host")}/doc`,
    expiresIn,
  });
});
