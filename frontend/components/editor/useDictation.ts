"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { EditorEvents } from "@tiptap/core";
import { formatSegment } from "./dictation-commands";
import { insertDictatedText, setDictationPreview, textBeforeCaret } from "./dictation";

/**
 * SpeechRecognition lifecycle for live dictation (plan: speech-to-text
 * phase 1). Chrome/Edge/Safari expose the (webkit-prefixed) Web Speech
 * API; Firefox has none — callers check `supported` and fall back to the
 * recorder+transcribe path. Requires a secure context and mic permission.
 */

/* Minimal typings — the API isn't in TypeScript's DOM lib. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationStatus = "idle" | "listening";

export interface UseDictationResult {
  /** Web Speech API available in this browser (false on Firefox). */
  supported: boolean;
  status: DictationStatus;
  /** Human-readable failure; cleared on the next start() or clearError(). */
  error: string | null;
  clearError: () => void;
  /** Live in-progress phrase (mirrors the caret ghost) for status UI. */
  interim: string;
  /** Document range covered by the last finished session (for AI tidy). */
  lastSession: { from: number; to: number } | null;
  clearLastSession: () => void;
  start: () => void;
  stop: () => void;
}

export function useDictation(editor: TiptapEditor | null, lang: string): UseDictationResult {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [lastSession, setLastSession] = useState<{ from: number; to: number } | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** User intent: keep listening across the browser's silence timeouts. */
  const activeRef = useRef(false);
  const sessionRef = useRef<{ from: number; to: number } | null>(null);
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const supported = getRecognitionCtor() !== null;

  // Keep the session range valid while collaborators edit elsewhere.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (!transaction.docChanged) return;
      const live = sessionRef.current;
      if (live) {
        live.from = transaction.mapping.map(live.from);
        live.to = transaction.mapping.map(live.to);
      }
      setLastSession((range) =>
        range
          ? { from: transaction.mapping.map(range.from), to: transaction.mapping.map(range.to) }
          : range,
      );
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const stop = useCallback(() => {
    activeRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setStatus("idle");
    setInterim("");
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) setDictationPreview(ed, null);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session && session.to > session.from) setLastSession(session);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    const ed = editorRef.current;
    if (!Ctor || !ed || ed.isDestroyed || activeRef.current) return;

    setError(null);
    setInterim("");
    setLastSession(null);
    sessionRef.current = null;
    // Focus the editor so the caret (where words will land) is visible.
    ed.commands.focus();

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      const editorNow = editorRef.current;
      if (!editorNow || editorNow.isDestroyed) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const transcript = result[0]?.transcript ?? "";
        if (!result.isFinal) {
          interim += transcript;
          continue;
        }
        const formatted = formatSegment(transcript, textBeforeCaret(editorNow));
        if (!formatted) continue;
        setDictationPreview(editorNow, null);
        const inserted = insertDictatedText(editorNow, formatted);
        if (inserted) {
          sessionRef.current = {
            from: Math.min(sessionRef.current?.from ?? inserted.from, inserted.from),
            to: inserted.to,
          };
        }
      }
      setDictationPreview(editorNow, interim.trim() ? interim.replace(/^\s+/, " ") : null);
      setInterim(interim.trim());
    };

    rec.onerror = (e) => {
      // "no-speech"/"aborted" are routine — onend's restart handles them.
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access was blocked. Allow it in your browser's site settings.");
      } else if (e.error === "network") {
        setError("Speech recognition needs a connection — you appear to be offline.");
      } else if (e.error === "audio-capture") {
        setError("No microphone was found.");
      } else {
        setError("Dictation stopped unexpectedly — try again.");
      }
      activeRef.current = false;
    };

    rec.onend = () => {
      // Browsers end recognition after silence or ~60s; restart while the
      // user's toggle is still on so dictation doesn't silently die.
      if (activeRef.current && recRef.current === rec) {
        try {
          rec.start();
          return;
        } catch {
          // fall through to a clean stop
        }
      }
      if (recRef.current === rec) stop();
    };

    try {
      rec.start();
    } catch {
      setError("Could not start dictation — try again.");
      return;
    }
    recRef.current = rec;
    activeRef.current = true;
    setStatus("listening");
  }, [lang, stop]);

  // Unmount / editor swap: never leave the mic running.
  useEffect(
    () => () => {
      activeRef.current = false;
      recRef.current?.abort();
      recRef.current = null;
    },
    [],
  );

  const clearLastSession = useCallback(() => setLastSession(null), []);
  const clearError = useCallback(() => setError(null), []);

  return { supported, status, error, clearError, interim, lastSession, clearLastSession, start, stop };
}
