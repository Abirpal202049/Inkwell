import { describe, expect, it } from "vitest";
import { markdownToHtml, hasMarkdownSyntax } from "../components/editor/markdown";

describe("markdownToHtml — inline marks", () => {
  it("converts the full inline subset", () => {
    expect(markdownToHtml("**bold** and *italic* and ~~gone~~ and `x = 1`")).toBe(
      "<p><strong>bold</strong> and <em>italic</em> and <s>gone</s> and <code>x = 1</code></p>",
    );
  });

  it("re-allows <u> while escaping every other tag", () => {
    expect(markdownToHtml("<u>under</u> but <script>no</script>")).toBe(
      "<p><u>under</u> but &lt;script&gt;no&lt;/script&gt;</p>",
    );
  });

  it("renders http(s) links and leaves other schemes as text", () => {
    expect(markdownToHtml("[docs](https://example.com/a)")).toBe(
      '<p><a href="https://example.com/a">docs</a></p>',
    );
    expect(markdownToHtml("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
  });

  it("does not format inside code spans, even next to bare numbers", () => {
    expect(markdownToHtml("I have 3 apples and `**not bold**` here")).toBe(
      "<p>I have 3 apples and <code>**not bold**</code> here</p>",
    );
  });

  it("does not treat spaced asterisks (multiplication) as italic", () => {
    expect(markdownToHtml("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
  });
});

describe("markdownToHtml — blocks", () => {
  it("maps # levels to h1–h3 and clamps deeper headings", () => {
    expect(markdownToHtml("# One\n## Two\n### Three\n#### Four")).toBe(
      "<h1>One</h1><h2>Two</h2><h3>Three</h3><h3>Four</h3>",
    );
  });

  it("merges consecutive bullet lines into ONE list", () => {
    expect(markdownToHtml("- a\n- b\n- c")).toBe(
      "<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>",
    );
  });

  it("keeps ordered-list numbering, including a non-1 start", () => {
    expect(markdownToHtml("3. third\n4. fourth")).toBe(
      '<ol start="3"><li><p>third</p></li><li><p>fourth</p></li></ol>',
    );
    expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li><p>a</p></li><li><p>b</p></li></ol>");
  });

  it("emits Tiptap task-list markup with checked state", () => {
    expect(markdownToHtml("- [ ] open\n- [x] done")).toBe(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>open</p></li>' +
        '<li data-type="taskItem" data-checked="true"><p>done</p></li></ul>',
    );
  });

  it("groups quote lines and preserves inline marks inside them", () => {
    expect(markdownToHtml("> first **loud**\n> second")).toBe(
      "<blockquote><p>first <strong>loud</strong></p><p>second</p></blockquote>",
    );
  });

  it("escapes code fences verbatim, closing an unterminated fence at EOF", () => {
    expect(markdownToHtml("```\nconst a = 1 < 2;\n```")).toBe(
      "<pre><code>const a = 1 &lt; 2;</code></pre>",
    );
    expect(markdownToHtml("```\ndangling")).toBe("<pre><code>dangling</code></pre>");
  });

  it("renders rules and skips blank lines between paragraphs", () => {
    expect(markdownToHtml("one\n\n---\n\ntwo")).toBe("<p>one</p><hr><p>two</p>");
  });
});

describe("hasMarkdownSyntax", () => {
  it("is true for each construct the parser handles", () => {
    for (const s of ["**b**", "# h", "- item", "1. item", "> q", "```", "<u>u</u>", "~~s~~", "`c`", "---"]) {
      expect(hasMarkdownSyntax(s), s).toBe(true);
    }
  });

  it("is false for plain prose, so finish() can skip the replace", () => {
    expect(hasMarkdownSyntax("Just a plain sentence.\n\nAnd another one.")).toBe(false);
  });
});
