import { PAGE_SIZES, type PageMargins, type PageSizeId } from "@/components/editor/Ruler";

/**
 * File > Download: client-side document export, no server round-trip so
 * it works offline and for signed-out local docs alike.
 *
 * - PDF rides the browser's print pipeline: EditorSurface already
 *   injects an @page rule mirroring the paper size and margins, and the
 *   print CSS strips the screen chrome, so "Save as PDF" in the print
 *   dialog yields a properly paginated document.
 * - Word uses the Word-HTML envelope (the format Word itself calls
 *   "Web Page, Filtered"): plain HTML plus an mso @page section, saved
 *   as .doc. Opens in Word, LibreOffice, and Google Docs.
 */

const PX_PER_INCH = 96;

/** Strip characters Windows forbids in filenames. */
function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Document";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function downloadAsPdf(title: string) {
  // Browsers suggest document.title as the PDF filename.
  const prev = document.title;
  document.title = safeFilename(title);
  try {
    window.print();
  } finally {
    // print() blocks while the dialog is open; restoring here also
    // covers engines that never fire afterprint.
    document.title = prev;
  }
}

/**
 * Word's HTML engine predates attribute selectors and form controls, so
 * rewrite task lists into plain checked/unchecked glyph prefixes, and
 * turn the page-number atoms into live Word fields (PAGE / NUMPAGES).
 */
function prepareWordBody(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll('ul[data-type="taskList"]').forEach((ul) => {
    ul.setAttribute("style", "list-style:none; margin-left:0; padding-left:0");
    ul.querySelectorAll(":scope > li").forEach((li) => {
      const checked = li.getAttribute("data-checked") === "true";
      li.querySelector(":scope > label")?.remove();
      const p = li.querySelector("p");
      (p ?? li).prepend(doc.createTextNode(checked ? "☑ " : "☐ "));
    });
  });
  const field = (el: Element, code: string) => {
    const span = doc.createElement("span");
    span.setAttribute("style", `mso-field-code:" ${code} "`);
    span.textContent = "1";
    el.replaceWith(span);
  };
  doc.querySelectorAll("[data-hf-pagenum]").forEach((el) => field(el, "PAGE"));
  doc.querySelectorAll("[data-hf-pagecount]").forEach((el) => field(el, "NUMPAGES"));
  return doc.body.innerHTML;
}

export interface WordHf {
  /** Rendered HTML of the default header/footer segment; absent = none. */
  header?: string;
  footer?: string;
  /** Page edge → band text distance (px). */
  headerMargin: number;
  footerMargin: number;
}

export function downloadAsWord(
  html: string,
  {
    title,
    pageSize,
    margins,
    hf,
  }: { title: string; pageSize: PageSizeId; margins: PageMargins; hf?: WordHf },
) {
  const size = PAGE_SIZES[pageSize];
  const inch = (px: number) => `${(px / PX_PER_INCH).toFixed(2)}in`;

  // Word headers/footers: mso-element divs referenced from the section's
  // @page rule — the single-file variant of Word's own "filtered HTML".
  const hfStyles = hf
    ? `
    mso-header-margin: ${inch(hf.headerMargin)};
    mso-footer-margin: ${inch(hf.footerMargin)};
    ${hf.header ? "mso-header: h1;" : ""}
    ${hf.footer ? "mso-footer: f1;" : ""}`
    : "";
  const hfParts = hf
    ? `${hf.header ? `<div style="mso-element:header" id="h1">${prepareWordBody(hf.header)}</div>` : ""}${
        hf.footer ? `<div style="mso-element:footer" id="f1">${prepareWordBody(hf.footer)}</div>` : ""
      }`
    : "";

  const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  @page WordSection1 {
    size: ${inch(size.width)} ${inch(size.height)};
    margin: ${inch(margins.top)} ${inch(margins.right)} ${inch(margins.bottom)} ${inch(margins.left)};${hfStyles}
  }
  div.WordSection1 { page: WordSection1; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  blockquote { border-left: 3pt solid #d4d4d8; margin-left: 0; padding-left: 12pt; color: #52525b; }
  pre { font-family: Consolas, monospace; font-size: 10pt; background: #f4f4f5; padding: 8pt; }
  code { font-family: Consolas, monospace; font-size: 10pt; }
  mark { background: #fef08a; }
  a { color: #2563eb; }
</style>
</head>
<body><div class="WordSection1">${prepareWordBody(html)}${hfParts}</div></body>
</html>`;

  // BOM so Word decodes the file as UTF-8.
  const blob = new Blob(["\u{feff}", wordHtml], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(title)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred so the click's navigation grabs the blob before it's freed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
