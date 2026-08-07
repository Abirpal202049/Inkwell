import { Router } from "express";
import { prisma, withUserContext } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { mintCollabToken } from "../realtime/token.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import {
  createDocumentSchema,
  patchDocumentSchema,
  listQuerySchema,
} from "@shared/schemas/api";
import { DEFAULT_DOC_TITLE } from "@shared/constants";
import { env } from "../env.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

/** GET /api/documents — the caller's documents, updatedAt desc. */
documentsRouter.get("/", async (req, res) => {
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
documentsRouter.post("/", async (req, res) => {
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

/** GET /api/documents/:docId — metadata; auto-joins via share link. */
documentsRouter.get("/:docId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
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
documentsRouter.patch("/:docId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);
  const body = patchDocumentSchema.parse(req.body);

  const updated = await withUserContext(user.id, async (tx) => {
    // Downgrading to private revokes link-granted access (plan/14 §5),
    // but keeps directly-invited members.
    if (body.shareMode === "private") {
      await tx.documentMember.deleteMany({
        where: { documentId, grantedVia: "link" },
      });
    }
    return tx.document.update({
      where: { id: documentId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.shareMode !== undefined && {
          shareMode: body.shareMode.replace("-", "_") as "private" | "link_view" | "link_edit",
        }),
      },
      select: { id: true, title: true, shareMode: true },
    });
  });

  ok(res, {
    id: updated.id,
    title: updated.title,
    shareMode: updated.shareMode.replace("_", "-"),
  });
});

/** DELETE /api/documents/:docId — soft delete (owner only). */
documentsRouter.delete("/:docId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner"]);

  await withUserContext(user.id, (tx) =>
    tx.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } }),
  );
  ok(res, { deleted: true });
});

/** POST /api/documents/:docId/token — mint the 60s single-use WS ticket. */
documentsRouter.post("/:docId/token", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);

  const { token, expiresIn } = await mintCollabToken({
    sub: user.id,
    doc: documentId,
    role: membership.role,
    name: user.name ?? user.email,
    image: user.image,
  });

  const wsProto = env.isProd ? "wss" : "ws";
  ok(res, {
    token,
    wsUrl: `${wsProto}://${req.get("host")}/doc`,
    expiresIn,
  });
});
