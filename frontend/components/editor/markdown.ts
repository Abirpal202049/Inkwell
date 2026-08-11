/**
 * Markdown → editor HTML for AI output (plan/08 §1).
 *
 * The writer system prompt constrains the model to the exact Markdown
 * subset the toolbar exposes (bold, italic, underline, strike, code,
 * H1–H3, bullet/numbered/task lists, quotes, code fences, rules,
 * links). This module converts that subset into HTML that Tiptap's
 * schema parses into REAL marks and nodes — so AI output behaves like
 * human formatting: the toolbar reflects it, and no literal `**`/`#`
 * ever remains in the document.
 *
 * Deliberately NOT a general Markdown parser: only the promised subset,
 * flat lists, no HTML passthrough (everything is escaped; `<u>` is the
 * single re-allowed tag). Kept pure for unit testing.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cheap pre-check: does this text contain anything the parser would
 *  transform? Lets callers skip a doc-mutating replace for plain prose. */
export function hasMarkdownSyntax(text: string): boolean {
  return (
    /[*_~`]|<u>|\[.+\]\(.+\)/.test(text) ||
    /^\s*(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|```|(?:-{3,}|_{3,})\s*$)/m.test(text)
  );
}

/** Inline marks: code spans are carved out first so no other rule can
 *  rewrite their contents, then bold → italic → strike → link → <u>. */
function renderInline(raw: string): string {
  const codes: string[] = [];
  let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  text = text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Emphasis needs non-space adjacency ("2 * 3 * 4" is not italic).
    .replace(/(^|[^*])\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>");

  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^>\s?(.*)$/;
const TASK_ITEM = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_ITEM = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^(\d+)[.)]\s+(.*)$/;

/**
 * Convert the AI Markdown subset to HTML for `insertContentAt`.
 * Line-oriented: consecutive list-item lines merge into one list (so
 * numbering continues), quote lines into one blockquote, and every
 * other non-blank line becomes its own paragraph — mirroring how the
 * raw stream was displayed while it was arriving.
 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    if (FENCE.test(line.trim())) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) body.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3); // toolbar exposes H1–H3
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (RULE.test(line.trim())) {
      out.push("<hr>");
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(`<p>${renderInline(QUOTE.exec(lines[i++])![1])}</p>`);
      }
      i--;
      out.push(`<blockquote>${body.join("")}</blockquote>`);
      continue;
    }

    // Task items must be tried before plain bullets ("- [ ]" matches both).
    if (TASK_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && TASK_ITEM.test(lines[i])) {
        const m = TASK_ITEM.exec(lines[i++])!;
        const checked = m[1] !== " ";
        items.push(
          `<li data-type="taskItem" data-checked="${checked}"><p>${renderInline(m[2])}</p></li>`,
        );
      }
      i--;
      out.push(`<ul data-type="taskList">${items.join("")}</ul>`);
      continue;
    }

    if (BULLET_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_ITEM.test(lines[i]) && !TASK_ITEM.test(lines[i])) {
        items.push(`<li><p>${renderInline(BULLET_ITEM.exec(lines[i++])![1])}</p></li>`);
      }
      i--;
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = ORDERED_ITEM.exec(line);
    if (ordered) {
      const start = Number(ordered[1]);
      const items: string[] = [];
      while (i < lines.length && ORDERED_ITEM.test(lines[i])) {
        items.push(`<li><p>${renderInline(ORDERED_ITEM.exec(lines[i++])![2])}</p></li>`);
      }
      i--;
      out.push(`<ol${start !== 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>`);
      continue;
    }

    out.push(`<p>${renderInline(line)}</p>`);
  }

  return out.join("");
}
