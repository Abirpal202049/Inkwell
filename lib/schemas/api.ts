import { z } from "zod";
import { TITLE_MAX_LENGTH } from "../constants";

/**
 * Wire-format schemas shared by frontend and backend (plan/13).
 * Validation happens server-side BEFORE any DB or Yjs work; the frontend
 * uses the same schemas for request typing via z.infer.
 */

export const roleSchema = z.enum(["owner", "editor", "viewer"]);
export const invitableRoleSchema = z.enum(["editor", "viewer"]);
export const shareModeSchema = z.enum(["private", "link-view", "link-edit"]);

export const uuidSchema = z.uuid();

export const titleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);

export const createDocumentSchema = z.object({
  title: titleSchema.optional(),
  /** Client-generated id so offline-created docs keep their id on sync. */
  id: uuidSchema.optional(),
});

export const patchDocumentSchema = z
  .object({
    title: titleSchema.optional(),
    shareMode: shareModeSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.shareMode !== undefined, {
    message: "Nothing to update",
  });

export const inviteMemberSchema = z.object({
  email: z.email().max(320),
  role: invitableRoleSchema,
});

export const patchMemberSchema = z.object({
  role: invitableRoleSchema,
});

export const createVersionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});

export const restoreSchema = z.object({
  versionId: uuidSchema,
});

export const listQuerySchema = z.object({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** JSON control frames on the WebSocket (plan/13 §JSON control messages). */
export const wsClientControlSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("push"),
    batchId: uuidSchema,
    count: z.number().int().min(1).max(1024),
  }),
]);

export type WsServerControl =
  | { t: "ack"; batchId: string; seq: number }
  | { t: "nack"; batchId: string; code: string; retryable: boolean }
  | { t: "role"; role: z.infer<typeof roleSchema> }
  | { t: "error"; code: string };

export type CreateDocument = z.infer<typeof createDocumentSchema>;
export type PatchDocument = z.infer<typeof patchDocumentSchema>;
export type InviteMember = z.infer<typeof inviteMemberSchema>;
export type DocumentRole = z.infer<typeof roleSchema>;
export type ShareMode = z.infer<typeof shareModeSchema>;
