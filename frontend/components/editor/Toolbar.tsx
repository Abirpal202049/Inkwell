"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignVerticalSpaceAround,
  Bold,
  Check,
  ChevronDown,
  Plus,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Minus,
  Link as LinkIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Highlighter,
  Undo2,
  Redo2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DictationControl } from "./DictationControl";

/**
 * Formatting toolbar — pinned feature set from plan/14 §7, shortcuts match
 * Google Docs where they exist. Hidden entirely for Viewer role.
 */

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, active, disabled, label, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "rounded p-1.5 text-zinc-600 hover:bg-[#d3e3fd]/60 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700",
        active && "bg-[#d3e3fd] text-[#041e49] dark:bg-zinc-700 dark:text-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden />;
}

/** Web-safe families, Docs-style. "Default" clears the mark (Geist). */
const FONT_FAMILIES: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Comic Sans MS", value: "'Comic Sans MS', cursive" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

function FontFamilyPicker({ editor, current }: { editor: Editor; current: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = FONT_FAMILIES.find((f) => f.value === current) ?? FONT_FAMILIES[0];

  const apply = (value: string | null) => {
    const chain = editor.chain().focus();
    (value === null ? chain.unsetFontFamily() : chain.setFontFamily(value)).run();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
        onClick={() => setOpen((o) => !o)}
        aria-label="Font family"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Font family"
        className="flex items-center gap-1 rounded px-2 py-1 text-sm text-zinc-700 hover:bg-[#d3e3fd]/60 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        <span className="w-20 truncate text-left">{active.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Font family"
          className="doc-scrollbar absolute left-0 top-full z-50 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.label}
              type="button"
              role="option"
              aria-selected={f === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(f.value)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-[#d3e3fd]/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", f !== active && "invisible")} />
              <span style={{ fontFamily: f.value ?? undefined }} className="truncate">
                {f.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Docs' line-spacing presets; "Default" clears back to the CSS 1.7. */
const LINE_HEIGHTS: { label: string; value: string | null }[] = [
  { label: "Default (1.7)", value: null },
  { label: "Single", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
];

function SpacingMenu({
  editor,
  lineHeight,
  spaceBefore,
  spaceAfter,
}: {
  editor: Editor;
  lineHeight: string | null;
  spaceBefore: boolean;
  spaceAfter: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-[#d3e3fd]/60 dark:text-zinc-200 dark:hover:bg-zinc-700";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
        onClick={() => setOpen((o) => !o)}
        aria-label="Line & paragraph spacing"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Line & paragraph spacing"
        className={cn(
          "flex items-center rounded p-1.5 text-zinc-600 hover:bg-[#d3e3fd]/60 dark:text-zinc-300 dark:hover:bg-zinc-700",
          open && "bg-[#d3e3fd] text-[#041e49] dark:bg-zinc-700 dark:text-zinc-50",
        )}
      >
        <AlignVerticalSpaceAround className="h-4 w-4" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Line & paragraph spacing"
          className="absolute left-0 top-full z-50 mt-1 w-60 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {LINE_HEIGHTS.map((lh) => (
            <button
              key={lh.label}
              type="button"
              role="menuitemradio"
              aria-checked={lh.value === lineHeight}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().setLineHeight(lh.value).run();
                setOpen(false);
              }}
              className={itemClass}
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", lh.value !== lineHeight && "invisible")} />
              {lh.label}
            </button>
          ))}
          <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().setSpaceBefore(!spaceBefore).run();
              setOpen(false);
            }}
            className={itemClass}
          >
            <span className="w-3.5 shrink-0" aria-hidden />
            {spaceBefore ? "Remove space before paragraph" : "Add space before paragraph"}
          </button>
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().setSpaceAfter(!spaceAfter).run();
              setOpen(false);
            }}
            className={itemClass}
          >
            <span className="w-3.5 shrink-0" aria-hidden />
            {spaceAfter ? "Remove space after paragraph" : "Add space after paragraph"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Default body text is 1rem = 16px = 12pt; sizes are stored as pt marks. */
const DEFAULT_FONT_SIZE_PT = 12;
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 400;

function FontSizeControl({ editor, current }: { editor: Editor; current: string | null }) {
  // Draft holds the input text only while the user is typing in it.
  const [draft, setDraft] = useState<string | null>(null);
  const skipBlurCommit = useRef(false);

  const size = current ? (Number.parseFloat(current) || DEFAULT_FONT_SIZE_PT) : DEFAULT_FONT_SIZE_PT;

  const apply = (n: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)));
    editor.chain().focus().setFontSize(`${clamped}pt`).run();
  };

  const commit = (raw: string) => {
    setDraft(null);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) {
      editor.chain().focus().run();
      return;
    }
    apply(n);
  };

  return (
    <div className="flex items-center gap-0.5">
      <ToolbarButton label="Decrease font size" onClick={() => apply(size - 1)} disabled={size <= MIN_FONT_SIZE}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(size)}
        onFocus={(e) => {
          setDraft(String(size));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur(); // blur commits and refocuses the editor
          } else if (e.key === "Escape") {
            skipBlurCommit.current = true;
            e.currentTarget.blur();
            editor.commands.focus();
          }
        }}
        onBlur={(e) => {
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            setDraft(null);
            return;
          }
          commit(e.target.value);
        }}
        aria-label="Font size"
        title="Font size"
        className="h-6 w-9 rounded border border-zinc-400 bg-transparent text-center text-sm text-zinc-700 focus:border-[#1a73e8] focus:outline-none dark:border-zinc-600 dark:text-zinc-200 dark:focus:border-blue-400"
      />
      <ToolbarButton label="Increase font size" onClick={() => apply(size + 1)} disabled={size >= MAX_FONT_SIZE}>
        <Plus className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

export function Toolbar({
  editor,
  onAiClick,
  docId,
  aiReady = false,
}: {
  editor: Editor;
  /** When set, shows the AI entry point (plan/08 discoverability). */
  onAiClick?: () => void;
  /** Enables voice typing (needed for the transcribe/tidy AI calls). */
  docId?: string;
  /** Signed in + AI configured: unlocks transcribe fallback and tidy. */
  aiReady?: boolean;
}) {
  // Subscribe to only the flags the toolbar renders — avoids re-rendering
  // on every transaction (plan/07 §Performance).
  // The snapshot editor is null during SSR/hydration and destroyed for one
  // render when the editor instance is recreated (e.g. Strict Mode remount) —
  // a destroyed editor keeps isActive() but nulls out can().
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed) return null;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        taskList: e.isActive("taskList"),
        blockquote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        link: e.isActive("link"),
        alignLeft: e.isActive({ textAlign: "left" }),
        alignCenter: e.isActive({ textAlign: "center" }),
        alignRight: e.isActive({ textAlign: "right" }),
        highlight: e.isActive("highlight"),
        fontFamily: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? null,
        fontSize: (e.getAttributes("textStyle").fontSize as string | undefined) ?? null,
        ...(() => {
          const block = e.getAttributes(e.isActive("heading") ? "heading" : "paragraph");
          return {
            lineHeight: (block.lineHeight as string | undefined) ?? null,
            spaceBefore: Boolean(block.spaceBefore),
            spaceAfter: Boolean(block.spaceAfter),
          };
        })(),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  if (!s) return null;

  const chain = () => editor.chain().focus();

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      chain().unsetLink().run();
      return;
    }
    chain().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="bg-[#f9fbfd] px-4 pb-2 pt-0.5 dark:border-b dark:border-zinc-800 dark:bg-zinc-900 dark:px-2 dark:py-1">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 rounded-full bg-[#edf2fa] px-3 py-1 dark:rounded-none dark:bg-transparent dark:p-0"
      >
      <ToolbarButton label="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!s.canUndo}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo (Ctrl+Y)" onClick={() => chain().redo().run()} disabled={!s.canRedo}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
      <Divider />
      <FontFamilyPicker editor={editor} current={s.fontFamily} />
      <Divider />
      <FontSizeControl editor={editor} current={s.fontSize} />
      <Divider />
      <ToolbarButton label="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Underline (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={s.code} onClick={() => chain().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Highlight" active={s.highlight} onClick={() => chain().toggleHighlight().run()}>
        <Highlighter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Link (Ctrl+K)" active={s.link} onClick={setLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Heading 1" active={s.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={s.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Heading 3" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Bulleted list" active={s.bulletList} onClick={() => chain().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={s.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Task list" active={s.taskList} onClick={() => chain().toggleTaskList().run()}>
        <ListTodo className="h-4 w-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Blockquote" active={s.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Code block" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <SquareCode className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Align left" active={s.alignLeft} onClick={() => chain().setTextAlign("left").run()}>
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Align center" active={s.alignCenter} onClick={() => chain().setTextAlign("center").run()}>
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Align right" active={s.alignRight} onClick={() => chain().setTextAlign("right").run()}>
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
      <SpacingMenu
        editor={editor}
        lineHeight={s.lineHeight}
        spaceBefore={s.spaceBefore}
        spaceAfter={s.spaceAfter}
      />
      {docId && (
        <>
          <Divider />
          <DictationControl editor={editor} docId={docId} aiReady={aiReady} />
        </>
      )}
      {onAiClick && (
        <>
          <Divider />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep editor selection
            onClick={onAiClick}
            aria-label="AI writing help"
            title="AI writing help (Ctrl+J, or type /ai)"
            className="rounded p-1.5 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </>
      )}
      </div>
    </div>
  );
}
