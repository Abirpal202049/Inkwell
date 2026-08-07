import { describe, it, expect } from "vitest";
import {
  createDocumentSchema,
  patchDocumentSchema,
  inviteMemberSchema,
  wsClientControlSchema,
  restoreSchema,
} from "@shared/schemas/api";
import { TITLE_MAX_LENGTH } from "@shared/constants";

/** Payload validation (plan/06 §3): malformed input dies at the schema. */
describe("API payload schemas", () => {
  it("accepts a valid document creation", () => {
    expect(createDocumentSchema.safeParse({ title: "My doc" }).success).toBe(true);
    expect(
      createDocumentSchema.safeParse({ id: "7d9a1a52-59d2-4f4b-9a70-1c9d3a3b1a2b" }).success,
    ).toBe(true);
    expect(createDocumentSchema.safeParse({}).success).toBe(true);
  });

  it("rejects malformed document payloads", () => {
    expect(createDocumentSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ title: "" }).success).toBe(false);
    expect(
      createDocumentSchema.safeParse({ title: "x".repeat(TITLE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("patch requires at least one field and valid share modes", () => {
    expect(patchDocumentSchema.safeParse({}).success).toBe(false);
    expect(patchDocumentSchema.safeParse({ shareMode: "link-view" }).success).toBe(true);
    expect(patchDocumentSchema.safeParse({ shareMode: "public" }).success).toBe(false);
  });

  it("invites require a real email and a non-owner role", () => {
    expect(inviteMemberSchema.safeParse({ email: "a@b.co", role: "editor" }).success).toBe(true);
    expect(inviteMemberSchema.safeParse({ email: "nope", role: "editor" }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
  });

  it("restore requires a version uuid", () => {
    expect(restoreSchema.safeParse({ versionId: "7d9a1a52-59d2-4f4b-9a70-1c9d3a3b1a2b" }).success).toBe(true);
    expect(restoreSchema.safeParse({ versionId: 5 }).success).toBe(false);
  });

  it("WS control frames: only well-formed push announcements pass", () => {
    const good = { t: "push", batchId: "7d9a1a52-59d2-4f4b-9a70-1c9d3a3b1a2b", count: 3 };
    expect(wsClientControlSchema.safeParse(good).success).toBe(true);
    expect(wsClientControlSchema.safeParse({ t: "push", batchId: "x", count: 3 }).success).toBe(false);
    expect(wsClientControlSchema.safeParse({ t: "push", batchId: good.batchId, count: 0 }).success).toBe(false);
    expect(wsClientControlSchema.safeParse({ t: "push", batchId: good.batchId, count: 100_000 }).success).toBe(false);
    expect(wsClientControlSchema.safeParse({ t: "evil" }).success).toBe(false);
  });
});
