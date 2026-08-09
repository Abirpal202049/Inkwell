import { Router } from "express";
import { prisma, withUserContext } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import { createVersionSchema, restoreSchema, uuidSchema } from "@shared/schemas/api";
import { loadDocState, latestVersion, contributorsSince } from "../persistence/doc-store.js";
import { getLiveDocState, applyRestore } from "../realtime/rooms.js";
import { suggestVersionLabel } from "../ai/label.js";
import { extractDocText } from "../ai/text.js";
import { AI_LABEL_CONTEXT_MAX_CHARS } from "@shared/constants";

export const versionsRouter = Router({ mergeParams: true });
versionsRouter.use(requireAuth);

/** Current authoritative state: the live room's doc if one is open
 *  (has the freshest edits), else materialized from the DB log. */
async function currentState(documentId: string): Promise<Uint8Array | null> {
  return getLiveDocState(documentId) ?? (await loadDocState(documentId));
}

/**
 * Audit-trail fields for a version being cut right now: the log head it
 * covers up to, and the distinct authors since the previous version
 * (whoever they are — this is what makes the trail per-editor, plan/05).
 */
async function versionAuditFields(documentId: string) {
  const [doc, last] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { latestSeq: true } }),
    latestVersion(documentId),
  ]);
  const upToSeq = doc?.latestSeq ?? 0n;
  const authors = await contributorsSince(documentId, last?.upToSeq ?? 0n);
  return {
    upToSeq,
    contributors: { create: authors.map((userId) => ({ userId })) },
  };
}

/** GET /api/documents/:docId/versions — timeline metadata (no blobs). */
versionsRouter.get("/", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  await resolveMembership(user.id, documentId);

  const versions = await withUserContext(user.id, (tx) =>
    tx.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        label: true,
        isAuto: true,
        createdAt: true,
        upToSeq: true,
        author: { select: { name: true, image: true } },
        contributors: {
          select: { user: { select: { id: true, name: true, image: true } } },
        },
      },
    }),
  );

  ok(res, {
    versions: versions.map((v) => ({
      id: v.id,
      label: v.label,
      isAuto: v.isAuto,
      createdAt: v.createdAt.toISOString(),
      upToSeq: Number(v.upToSeq),
      createdBy: v.author,
      contributors: v.contributors.map((c) => c.user),
    })),
  });
});

/** POST /api/documents/:docId/versions — manual snapshot (owner|editor). */
versionsRouter.post("/", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner", "editor"]);
  const { label } = createVersionSchema.parse(req.body);

  const state = await currentState(documentId);
  if (!state) throw errors.conflict("Document has no content to snapshot");

  // Unlabeled snapshot: propose an AI label from a diff against the
  // previous version (plan/08 §3) — best-effort within AI_LABEL_TIMEOUT_MS,
  // falling back to the dated label from plan/13. Never blocks or fails
  // the snapshot itself.
  let aiLabel: string | null = null;
  if (!label) {
    const prev = await latestVersion(documentId);
    const prevBytes = prev
      ? await prisma.documentVersion.findUnique({
          where: { id: prev.id },
          select: { stateBytes: true },
        })
      : null;
    aiLabel = await suggestVersionLabel(
      prevBytes ? extractDocText(new Uint8Array(prevBytes.stateBytes), AI_LABEL_CONTEXT_MAX_CHARS) : null,
      extractDocText(state, AI_LABEL_CONTEXT_MAX_CHARS),
    );
  }
  const fallbackLabel = `Version of ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

  const audit = await versionAuditFields(documentId);
  const version = await withUserContext(user.id, (tx) =>
    tx.documentVersion.create({
      data: {
        documentId,
        label: label ?? aiLabel ?? fallbackLabel,
        stateBytes: Buffer.from(state),
        createdBy: user.id,
        isAuto: false,
        ...audit,
      },
      select: { id: true, label: true, createdAt: true },
    }),
  );

  ok(res, { id: version.id, label: version.label, createdAt: version.createdAt.toISOString() }, 201);
});

/** GET /api/documents/:docId/versions/:versionId — binary state blob. */
versionsRouter.get("/:versionId", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const versionId = uuidSchema.parse(req.params.versionId);
  await resolveMembership(user.id, documentId);

  const version = await withUserContext(user.id, (tx) =>
    tx.documentVersion.findFirst({
      where: { id: versionId, documentId },
      select: { stateBytes: true },
    }),
  );
  if (!version) throw errors.notFound();

  // Immutable: a version's bytes never change (plan/13).
  res
    .status(200)
    .set({
      "Content-Type": "application/octet-stream",
      ETag: `"${versionId}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    })
    .send(Buffer.from(version.stateBytes));
});

/** POST /api/documents/:docId/restore — restore-as-forward-edit (plan/05). */
versionsRouter.post("/restore", async (req, res) => {
  const user = res.locals.user!;
  const documentId = docIdParam(req);
  const membership = await resolveMembership(user.id, documentId);
  assertRole(membership, ["owner", "editor"]);
  const { versionId } = restoreSchema.parse(req.body);

  const version = await withUserContext(user.id, (tx) =>
    tx.documentVersion.findFirst({
      where: { id: versionId, documentId },
      select: { stateBytes: true, createdAt: true },
    }),
  );
  if (!version) throw errors.notFound();

  // Applies the target content as normal CRDT operations ON TOP of the
  // live doc — never a state replacement — so concurrent editors merge
  // safely (plan/05 §Restore).
  await applyRestore(documentId, user.id, new Uint8Array(version.stateBytes));

  // The restore itself is versioned (plan/05 step 6). Audit fields are
  // computed AFTER applyRestore so the restore edit (authored by this
  // user) lands inside the new version's contributor window.
  const state = await currentState(documentId);
  const audit = await versionAuditFields(documentId);
  const newVersion = await withUserContext(user.id, (tx) =>
    tx.documentVersion.create({
      data: {
        documentId,
        label: `Restored to version from ${version.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
        stateBytes: Buffer.from(state ?? version.stateBytes),
        createdBy: user.id,
        isAuto: true,
        ...audit,
      },
      select: { id: true },
    }),
  );

  ok(res, { newVersionId: newVersion.id });
});
