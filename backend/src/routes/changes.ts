import { Router } from "express";
import { prisma } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { docIdParam, resolveMembership } from "./helpers.js";
import { changesQuerySchema } from "@shared/schemas/api";
import { computeDocumentChanges } from "../persistence/attributed-diff.js";

export const changesRouter = Router({ mergeParams: true });
changesRouter.use(requireAuth);

/**
 * GET /api/documents/:docId/changes — the audit trail: an attributed diff
 * of the document over a durable-log range. Two calling styles:
 *  - ?fromSeq&toSeq  — a version window ("what changed in this version")
 *  - ?since=<ISO>    — activity over a duration ("what changed today")
 * Any member may read (same visibility as version history).
 */
changesRouter.get("/", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  await resolveMembership(user.id, documentId);
  const q = changesQuerySchema.parse(req.query);

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { latestSeq: true },
  });
  if (!doc) throw errors.notFound();

  const toSeq =
    q.toSeq !== undefined && BigInt(q.toSeq) < doc.latestSeq ? BigInt(q.toSeq) : doc.latestSeq;

  let fromSeq = 0n;
  if (q.since !== undefined) {
    const first = await prisma.docUpdate.findFirst({
      where: { documentId, createdAt: { gte: new Date(q.since) } },
      orderBy: { seq: "asc" },
      select: { seq: true },
    });
    // Nothing since that moment → empty range at the head.
    fromSeq = first ? first.seq - 1n : toSeq;
  } else if (q.fromSeq !== undefined) {
    fromSeq = BigInt(q.fromSeq);
  }
  if (fromSeq > toSeq) fromSeq = toSeq;

  const result = await computeDocumentChanges(documentId, fromSeq, toSeq);
  if (!result.ok) {
    throw errors.conflict(
      result.reason === "pruned"
        ? "This range predates the audit-trail retention window"
        : "Change range spans too many edits to compute",
    );
  }

  const contributors =
    result.contributorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: result.contributorIds } },
          select: { id: true, name: true, image: true },
        })
      : [];

  ok(res, {
    fromSeq: Number(fromSeq),
    toSeq: Number(toSeq),
    contributors,
    blocks: result.blocks,
  });
});
