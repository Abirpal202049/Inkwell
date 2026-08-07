import { Router } from "express";
import { withUserContext } from "../db.js";
import { ok, errors } from "../http.js";
import { requireAuth } from "../auth.js";
import { docIdParam, resolveMembership, assertRole } from "./helpers.js";
import { createVersionSchema, restoreSchema, uuidSchema } from "@shared/schemas/api";
import { loadDocState } from "../persistence/doc-store.js";
import { getLiveDocState, applyRestore } from "../realtime/rooms.js";

export const versionsRouter = Router({ mergeParams: true });
versionsRouter.use(requireAuth);

/** Current authoritative state: the live room's doc if one is open
 *  (has the freshest edits), else materialized from the DB log. */
async function currentState(documentId: string): Promise<Uint8Array | null> {
  return getLiveDocState(documentId) ?? (await loadDocState(documentId));
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
        author: { select: { name: true, image: true } },
      },
    }),
  );

  ok(res, {
    versions: versions.map((v) => ({
      id: v.id,
      label: v.label,
      isAuto: v.isAuto,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.author,
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

  // AI-generated labels for unlabeled snapshots land in Stage F; until
  // then the dated fallback from plan/13 applies.
  const fallbackLabel = `Version of ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

  const version = await withUserContext(user.id, (tx) =>
    tx.documentVersion.create({
      data: {
        documentId,
        label: label ?? fallbackLabel,
        stateBytes: Buffer.from(state),
        createdBy: user.id,
        isAuto: false,
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

  // The restore itself is versioned (plan/05 step 6).
  const state = await currentState(documentId);
  const newVersion = await withUserContext(user.id, (tx) =>
    tx.documentVersion.create({
      data: {
        documentId,
        label: `Restored to version from ${version.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
        stateBytes: Buffer.from(state ?? version.stateBytes),
        createdBy: user.id,
        isAuto: true,
      },
      select: { id: true },
    }),
  );

  ok(res, { newVersionId: newVersion.id });
});
