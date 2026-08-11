import { describe, expect, it } from "vitest";
import { applyVoiceCommands, formatSegment } from "../components/editor/dictation-commands";

describe("applyVoiceCommands", () => {
  it("converts spoken punctuation and attaches it to the previous word", () => {
    expect(applyVoiceCommands("hello world period")).toBe("hello world.");
    expect(applyVoiceCommands("wait comma what question mark")).toBe("wait, what?");
    expect(applyVoiceCommands("stop exclamation mark")).toBe("stop!");
    expect(applyVoiceCommands("stop exclamation point")).toBe("stop!");
    expect(applyVoiceCommands("note colon this")).toBe("note: this");
    expect(applyVoiceCommands("first semicolon second")).toBe("first; second");
    expect(applyVoiceCommands("one full stop two")).toBe("one. two");
  });

  it("handles new line and new paragraph, swallowing surrounding spaces", () => {
    expect(applyVoiceCommands("first new line second")).toBe("first\nsecond");
    expect(applyVoiceCommands("first new paragraph second")).toBe("first\n\nsecond");
  });

  it("handles quotes", () => {
    expect(applyVoiceCommands("she said open quote hi close quote")).toBe("she said “hi”");
  });

  it("is case-insensitive and matches whole words only", () => {
    expect(applyVoiceCommands("Hello PERIOD")).toBe("Hello.");
    expect(applyVoiceCommands("the periodic table")).toBe("the periodic table");
    expect(applyVoiceCommands("a colonial house")).toBe("a colonial house");
  });

  it("leaves plain text untouched", () => {
    expect(applyVoiceCommands("just some words")).toBe("just some words");
  });
});

describe("formatSegment", () => {
  it("capitalizes at a block start", () => {
    expect(formatSegment("hello there", "")).toBe("Hello there");
  });

  it("capitalizes after sentence-ending punctuation", () => {
    expect(formatSegment("next sentence", "Something before. ")).toBe("Next sentence");
    expect(formatSegment("next", "Really?")).toBe(" Next");
  });

  it("does not capitalize mid-sentence and adds a joining space", () => {
    expect(formatSegment("world", "hello")).toBe(" world");
    expect(formatSegment("world", "hello, ")).toBe("world");
  });

  it("never doubles spaces after existing whitespace", () => {
    expect(formatSegment("more words", "some text ")).toBe("more words");
  });

  it("lets leading punctuation glue onto the previous word", () => {
    expect(formatSegment("period", "the end")).toBe(".");
    expect(formatSegment("comma then more", "first part")).toBe(", then more");
  });

  it("capitalizes sentences inside the segment", () => {
    expect(formatSegment("one period two period three", "")).toBe("One. Two. Three");
  });

  it("capitalizes after new paragraph", () => {
    expect(formatSegment("first new paragraph second", "")).toBe("First\n\nSecond");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(formatSegment("   ", "abc")).toBe("");
  });

  it("does not add a space after an opening bracket or quote", () => {
    expect(formatSegment("inside", "before (")).toBe("inside");
    expect(formatSegment("inside", "said “")).toBe("inside");
  });
});
