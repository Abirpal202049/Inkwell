import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { buildGeneratePrompt, buildLabelPrompt, sanitizeLabel } from "../src/ai/prompts.js";
import { createRateLimiter } from "../src/ai/rate-limit.js";
import { extractDocText } from "../src/ai/text.js";
import { AI_LABEL_CONTEXT_MAX_CHARS } from "@shared/constants";

/** Build a realistic editor state blob: paragraphs in the "content" fragment. */
function stateWithParagraphs(...paragraphs: string[]): Uint8Array {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("content");
  frag.insert(
    0,
    paragraphs.map((text) => {
      const p = new Y.XmlElement("paragraph");
      p.insert(0, [new Y.XmlText(text)]);
      return p;
    }),
  );
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

describe("extractDocText", () => {
  it("joins block text with newlines", () => {
    const state = stateWithParagraphs("Hello world", "Second paragraph");
    expect(extractDocText(state, 1000)).toBe("Hello world\nSecond paragraph");
  });

  it("truncates at maxChars instead of rejecting", () => {
    const state = stateWithParagraphs("a".repeat(500));
    expect(extractDocText(state, 100)).toHaveLength(100);
  });

  it("returns empty string for an empty document", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("content");
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    expect(extractDocText(state, 100)).toBe("");
  });
});

describe("buildGeneratePrompt", () => {
  it("system prompt teaches the editor's Markdown subset, not free-form output", () => {
    const { system } = buildGeneratePrompt({ action: "continue" });
    for (const construct of ["**bold**", "*italic*", "<u>underline</u>", "# / ## / ###", "- [ ] item"]) {
      expect(system).toContain(construct);
    }
    expect(system).toContain("no tables");
  });

  it("continue: includes preceding context and an empty-doc fallback", () => {
    const withContext = buildGeneratePrompt({ action: "continue", context: "Once upon a time" });
    expect(withContext.prompt).toContain("Once upon a time");
    const empty = buildGeneratePrompt({ action: "continue" });
    expect(empty.prompt).toContain("empty");
  });

  it("transforms carry the selection verbatim", () => {
    for (const action of ["concise", "grammar"] as const) {
      const { prompt } = buildGeneratePrompt({ action, selection: "Teh quick fox" });
      expect(prompt).toContain("Teh quick fox");
    }
  });

  it("custom: instruction plus selection when present, context otherwise", () => {
    const withSel = buildGeneratePrompt({
      action: "custom",
      prompt: "Make this formal",
      selection: "hey folks",
    });
    expect(withSel.prompt).toContain("Make this formal");
    expect(withSel.prompt).toContain("hey folks");
    const noSel = buildGeneratePrompt({ action: "custom", prompt: "Add a closing", context: "Dear team" });
    expect(noSel.prompt).toContain("Dear team");
  });
});

describe("buildLabelPrompt", () => {
  it("caps both versions' text at AI_LABEL_CONTEXT_MAX_CHARS", () => {
    const big = "x".repeat(AI_LABEL_CONTEXT_MAX_CHARS * 2);
    const { prompt } = buildLabelPrompt(big, big);
    expect(prompt.length).toBeLessThan(AI_LABEL_CONTEXT_MAX_CHARS * 2 + 200);
  });

  it("marks a missing previous version as the first snapshot", () => {
    expect(buildLabelPrompt(null, "content").prompt).toContain("first snapshot");
  });
});

describe("sanitizeLabel", () => {
  it("strips quotes, trailing periods and collapses whitespace", () => {
    expect(sanitizeLabel('"Restructured  intro."')).toBe("Restructured intro");
    expect(sanitizeLabel("'Added pricing section'")).toBe("Added pricing section");
  });

  it("caps at the 120-char schema limit", () => {
    expect(sanitizeLabel("y".repeat(300))!.length).toBeLessThanOrEqual(120);
  });

  it("returns null for empty/whitespace output", () => {
    expect(sanitizeLabel("   ")).toBeNull();
    expect(sanitizeLabel('""')).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("allows up to max hits per window, then rejects", () => {
    const limiter = createRateLimiter(3, 1000);
    expect(limiter.allow("u1", 0)).toBe(true);
    expect(limiter.allow("u1", 1)).toBe(true);
    expect(limiter.allow("u1", 2)).toBe(true);
    expect(limiter.allow("u1", 3)).toBe(false);
  });

  it("resets after the window elapses and isolates users", () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.allow("u1", 0)).toBe(true);
    expect(limiter.allow("u1", 500)).toBe(false);
    expect(limiter.allow("u2", 500)).toBe(true); // other user unaffected
    expect(limiter.allow("u1", 1000)).toBe(true); // new window
  });
});

describe("suggestVersionLabel degradation", () => {
  it("returns null (never throws) when no provider is configured", async () => {
    vi.doMock("../src/ai/client.js", () => ({
      aiEnabled: () => false,
      aiModel: () => {
        throw new Error("should not be called");
      },
    }));
    const { suggestVersionLabel } = await import("../src/ai/label.js");
    await expect(suggestVersionLabel("old", "new")).resolves.toBeNull();
    vi.doUnmock("../src/ai/client.js");
  });
});
