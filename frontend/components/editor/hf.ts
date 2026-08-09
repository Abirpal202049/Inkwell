"use client";

import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import { getSchema, type Extensions } from "@tiptap/react";
import { DOMSerializer, type Schema } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { localOrigin } from "@/lib/crdt/origins";
import {
  DEFAULT_HF_MARGIN,
  HF_FRAGMENTS,
  HF_KINDS,
  HF_ROLES,
  type HfKind,
  type HfRole,
} from "@/lib/constants";
import { PageNumber, PageCount } from "./hf-nodes";
import { Spacing } from "./spacing";

/**
 * Header/footer document model (plan/16 §2): content lives in six
 * role-named Y.XmlFragments (HF_FRAGMENTS), configuration in Y.Map('meta')
 * next to the margins — everything syncs, persists offline, and is
 * captured by version snapshots exactly like the body.
 */

export interface HfSettings {
  headerEnabled: boolean;
  footerEnabled: boolean;
  /** Docs "Different first page". */
  diffFirstPage: boolean;
  /** Docs "Different odd & even". */
  diffOddEven: boolean;
  /** Page edge → header text distance (px). */
  headerMargin: number;
  /** Page edge → footer text distance (px). */
  footerMargin: number;
}

const HF_MARGIN_MIN = 12; // 0.125in
const HF_MARGIN_MAX = 240; // 2.5in

function clampHfMargin(v: number): number {
  return Math.min(Math.max(v, HF_MARGIN_MIN), HF_MARGIN_MAX);
}

export function readHfSettings(meta: Y.Map<unknown>): HfSettings {
  const num = (key: string) => {
    const v = meta.get(key);
    return typeof v === "number" && Number.isFinite(v) ? clampHfMargin(v) : DEFAULT_HF_MARGIN;
  };
  return {
    headerEnabled: meta.get("headerEnabled") === true,
    footerEnabled: meta.get("footerEnabled") === true,
    diffFirstPage: meta.get("hfDiffFirstPage") === true,
    diffOddEven: meta.get("hfDiffOddEven") === true,
    headerMargin: num("headerMargin"),
    footerMargin: num("footerMargin"),
  };
}

export function enabledFor(settings: HfSettings, kind: HfKind): boolean {
  return kind === "header" ? settings.headerEnabled : settings.footerEnabled;
}

/** Options the format dialog / chip can change. */
export type HfOptions = Partial<
  Pick<HfSettings, "diffFirstPage" | "diffOddEven" | "headerMargin" | "footerMargin">
>;

/**
 * Enabling a variant seeds it with a COPY of the default segment (Word
 * behavior — no work lost; unchecking later just leaves the fragment
 * unresolved, so re-checking brings it back).
 */
function seedRole(ydoc: Y.Doc, role: Exclude<HfRole, "default">): void {
  for (const kind of HF_KINDS) {
    const src = ydoc.getXmlFragment(HF_FRAGMENTS[kind].default);
    const dst = ydoc.getXmlFragment(HF_FRAGMENTS[kind][role]);
    if (dst.length > 0 || src.length === 0) continue;
    dst.insert(0, src.toArray().map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[]);
  }
}

/** Header/footer state bridged to the shared meta map (same pattern as
 *  useDocMargins in Ruler.tsx). All writes are single transactions under
 *  localOrigin so they sync/undo like any other document property. */
export function useHfSettings(meta: Y.Map<unknown>, ydoc: Y.Doc) {
  const [settings, setSettings] = useState<HfSettings>(() => readHfSettings(meta));

  useEffect(() => {
    const observer = () => setSettings(readHfSettings(meta));
    observer();
    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [meta]);

  const enable = useCallback(
    (kind: HfKind) => {
      ydoc.transact(() => meta.set(`${kind}Enabled`, true), localOrigin);
    },
    [meta, ydoc],
  );

  /** Docs "Remove header": disable AND delete the content of all roles. */
  const remove = useCallback(
    (kind: HfKind) => {
      ydoc.transact(() => {
        meta.set(`${kind}Enabled`, false);
        for (const role of HF_ROLES) {
          const frag = ydoc.getXmlFragment(HF_FRAGMENTS[kind][role]);
          if (frag.length > 0) frag.delete(0, frag.length);
        }
      }, localOrigin);
    },
    [meta, ydoc],
  );

  const setOptions = useCallback(
    (next: HfOptions) => {
      ydoc.transact(() => {
        if (next.diffFirstPage !== undefined) {
          meta.set("hfDiffFirstPage", next.diffFirstPage);
          if (next.diffFirstPage) seedRole(ydoc, "first");
        }
        if (next.diffOddEven !== undefined) {
          meta.set("hfDiffOddEven", next.diffOddEven);
          if (next.diffOddEven) seedRole(ydoc, "even");
        }
        if (typeof next.headerMargin === "number") {
          meta.set("headerMargin", clampHfMargin(next.headerMargin));
        }
        if (typeof next.footerMargin === "number") {
          meta.set("footerMargin", clampHfMargin(next.footerMargin));
        }
      }, localOrigin);
    },
    [meta, ydoc],
  );

  return { settings, enable, remove, setOptions };
}

/**
 * Extension set for header/footer segments — the body set minus
 * pagination, plus the page-number atoms. Also defines the mirror schema,
 * so live editors and static projections always agree.
 */
export function hfBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false, // Collaboration provides Yjs-aware undo per segment
      link: { openOnClick: false, autolink: true },
    }),
    Highlight,
    TextStyle,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Spacing,
    TaskList,
    TaskItem.configure({ nested: true }),
    PageNumber,
    PageCount,
  ];
}

let schema: Schema | null = null;
function hfSchema(): Schema {
  return (schema ??= getSchema(hfBaseExtensions()));
}

/**
 * Static HTML projection of one segment fragment, for the repeated
 * non-editable bands: the segment exists once in the CRDT; every page
 * clones this HTML and stamps its own page number (plan/16 §4.1).
 */
export function renderHfFragment(ydoc: Y.Doc, fragmentName: string): string {
  const frag = ydoc.getXmlFragment(fragmentName);
  if (frag.length === 0) return "";
  const node = yXmlFragmentToProseMirrorRootNode(frag, hfSchema());
  const div = document.createElement("div");
  div.appendChild(DOMSerializer.fromSchema(hfSchema()).serializeFragment(node.content));
  return div.innerHTML;
}

export type HfHeights = Record<HfKind, Record<HfRole, number>>;

export const ZERO_HF_HEIGHTS: HfHeights = {
  header: { default: 0, first: 0, even: 0 },
  footer: { default: 0, first: 0, even: 0 },
};

export function hfHeightsEqual(a: HfHeights, b: HfHeights): boolean {
  for (const kind of HF_KINDS) {
    for (const role of HF_ROLES) {
      if (Math.abs(a[kind][role] - b[kind][role]) > 0.5) return false;
    }
  }
  return true;
}
