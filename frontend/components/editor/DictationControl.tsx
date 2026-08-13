"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { Check, ChevronDown, CircleStop, Loader2, Mic, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamAiGenerate, transcribeAudio, aiErrorMessage } from "@/lib/ai";
import {
  AI_AUDIO_MAX_MS,
  AI_SELECTION_MAX_CHARS,
  DICTATION_LANG_KEY,
} from "@/lib/constants";
import { useDictation } from "./useDictation";
import { insertDictatedText, textBeforeCaret } from "./dictation";
import { formatSegment } from "./dictation-commands";
import { createStreamInserter } from "./ai-command";

/**
 * Voice typing (speech-to-text), Docs-style — lives in the toolbar.
 *
 * Two engines behind one mic button:
 * - Browsers with the Web Speech API (Chrome/Edge/Safari) get LIVE
 *   dictation: interim ghost text at the caret, finals inserted as
 *   ordinary edits (useDictation).
 * - Browsers without it (Firefox) fall back to record-then-transcribe
 *   through the backend's Gemini audio endpoint — needs AI configured
 *   and a connection.
 *
 * After a live session ends, an optional "Tidy with AI" chip cleans the
 * dictated passage (punctuation, fillers) via the existing generate
 * streaming path — same provenance highlight, same undo behavior.
 */

const DICTATION_LANGUAGES: { label: string; value: string }[] = [
  { label: "English (US)", value: "en-US" },
  { label: "English (UK)", value: "en-GB" },
  { label: "English (India)", value: "en-IN" },
  { label: "हिन्दी", value: "hi-IN" },
  { label: "বাংলা", value: "bn-IN" },
  { label: "Español", value: "es-ES" },
  { label: "Français", value: "fr-FR" },
  { label: "Deutsch", value: "de-DE" },
  { label: "Português (BR)", value: "pt-BR" },
  { label: "Italiano", value: "it-IT" },
  { label: "日本語", value: "ja-JP" },
  { label: "한국어", value: "ko-KR" },
  { label: "中文 (简体)", value: "zh-CN" },
  { label: "العربية", value: "ar-SA" },
  { label: "Русский", value: "ru-RU" },
];

type RecorderPhase = "idle" | "recording" | "transcribing";

/** First MediaRecorder container this browser supports. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export function DictationControl({
  editor,
  docId,
  aiReady,
}: {
  editor: TiptapEditor;
  docId: string;
  /** Signed in + AI configured + online-ish: enables fallback & tidy. */
  aiReady: boolean;
}) {
  const [lang, setLang] = useState(() => {
    if (typeof window === "undefined") return "en-US";
    return window.localStorage.getItem(DICTATION_LANG_KEY) ?? navigator.language ?? "en-US";
  });
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const dictation = useDictation(editor, lang);

  // ---- record-then-transcribe fallback (no Web Speech API) ---------------
  const [recPhase, setRecPhase] = useState<RecorderPhase>("idle");
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.recorder.state !== "inactive") rec.recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setRecError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setRecError("Microphone access was blocked. Allow it in your browser's site settings.");
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearTimeout(recorderRef.current?.timer);
      recorderRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      setRecPhase("transcribing");
      void (async () => {
        const result = await transcribeAudio(docId, blob, lang);
        setRecPhase("idle");
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        if (!result.ok) {
          setRecError(aiErrorMessage(result.errorCode));
          return;
        }
        const transcript = (result.text ?? "").trim();
        if (!transcript) {
          setRecError("No speech was detected in the recording.");
          return;
        }
        insertDictatedText(ed, formatSegment(transcript, textBeforeCaret(ed)));
        ed.commands.focus();
      })();
    };
    // Auto-stop at the server's clip budget.
    const timer = setTimeout(() => stopRecording(), AI_AUDIO_MAX_MS);
    recorderRef.current = { recorder, stream, timer };
    recorder.start();
    setRecPhase("recording");
  }, [docId, lang, stopRecording]);

  // Never leave the mic running on unmount.
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec) {
        clearTimeout(rec.timer);
        if (rec.recorder.state !== "inactive") rec.recorder.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
      }
    },
    [],
  );

  // ---- tidy-with-AI pass (phase 2a) --------------------------------------
  const [tidyState, setTidyState] = useState<"idle" | "running">("idle");
  const [tidyError, setTidyError] = useState<string | null>(null);

  const runTidy = useCallback(async () => {
    const range = dictation.lastSession;
    const ed = editorRef.current;
    if (!range || !ed || ed.isDestroyed || tidyState === "running") return;
    const size = ed.state.doc.content.size;
    const from = Math.max(0, Math.min(range.from, size));
    const to = Math.max(from, Math.min(range.to, size));
    const text = ed.state.doc.textBetween(from, to, "\n").slice(0, AI_SELECTION_MAX_CHARS);
    if (!text.trim()) {
      dictation.clearLastSession();
      return;
    }
    setTidyError(null);
    setTidyState("running");
    ed.chain().deleteRange({ from, to }).run();
    const inserter = createStreamInserter(ed, from);
    const result = await streamAiGenerate(docId, { action: "tidy", selection: text }, (chunk) =>
      inserter.insert(chunk),
    );
    setTidyState("idle");
    if (ed.isDestroyed) return;
    if (result.ok || result.aborted) {
      inserter.finish();
      dictation.clearLastSession();
      ed.chain()
        .focus()
        .setTextSelection(Math.min(inserter.end, ed.state.doc.content.size))
        .run();
    } else {
      // Nothing streamed back — restore the original dictated text.
      ed.chain().setTextSelection(from).run();
      insertDictatedText(ed, text);
      setTidyError(aiErrorMessage(result.errorCode));
    }
  }, [dictation, docId, tidyState]);

  // ---- shared control state ----------------------------------------------
  const live = dictation.supported;
  const listening = live ? dictation.status === "listening" : recPhase === "recording";
  const transcribing = recPhase === "transcribing";
  const canDictate = live || aiReady;

  const toggle = useCallback(() => {
    if (live) {
      if (dictation.status === "listening") dictation.stop();
      else dictation.start();
      return;
    }
    if (!aiReady || transcribing) return;
    if (recPhase === "recording") stopRecording();
    else void startRecording();
  }, [live, dictation, aiReady, transcribing, recPhase, startRecording, stopRecording]);

  // Ctrl/Cmd+Shift+S — Docs' voice-typing shortcut.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the language menu on outside click / Escape.
  useEffect(() => {
    if (!langOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!langRef.current?.contains(e.target as Node)) setLangOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLangOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [langOpen]);

  const pickLang = (value: string) => {
    setLang(value);
    setLangOpen(false);
    try {
      window.localStorage.setItem(DICTATION_LANG_KEY, value);
    } catch {
      // storage unavailable — the choice just won't persist
    }
  };

  const error = dictation.error ?? recError ?? tidyError;
  const dismissError = () => {
    dictation.clearError();
    setRecError(null);
    setTidyError(null);
  };

  const title = !canDictate
    ? "Voice typing isn't supported in this browser"
    : listening
      ? "Stop voice typing (Ctrl+Shift+S)"
      : transcribing
        ? "Transcribing…"
        : live
          ? "Voice typing (Ctrl+Shift+S)"
          : "Record & transcribe with AI (Ctrl+Shift+S)";

  const activeLang = DICTATION_LANGUAGES.find((l) => l.value === lang);

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep editor selection/focus
        onClick={toggle}
        disabled={!canDictate || transcribing}
        aria-label={title}
        aria-pressed={listening}
        title={title}
        className={cn(
          "relative rounded p-1.5 text-zinc-600 hover:bg-[#d3e3fd]/60 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700",
          listening && "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",
        )}
      >
        {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
        {listening && (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        )}
      </button>

      <div ref={langRef} className="relative">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLangOpen((o) => !o)}
          disabled={!canDictate || listening || transcribing}
          aria-label="Dictation language"
          aria-haspopup="listbox"
          aria-expanded={langOpen}
          title={`Dictation language: ${activeLang?.label ?? lang}`}
          className="rounded p-0.5 text-zinc-500 hover:bg-[#d3e3fd]/60 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        {langOpen && (
          <div
            role="listbox"
            aria-label="Dictation language"
            className="doc-scrollbar absolute left-0 top-full z-50 mt-1 max-h-72 w-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          >
            {DICTATION_LANGUAGES.map((l) => (
              <button
                key={l.value}
                type="button"
                role="option"
                aria-selected={l.value === lang}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickLang(l.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-[#d3e3fd]/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", l.value !== lang && "invisible")} />
                <span className="truncate">{l.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {aiReady && (dictation.lastSession || tidyState === "running") && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void runTidy()}
          disabled={tidyState === "running"}
          title="Fix punctuation and remove filler words in what you just dictated"
          className="ml-1 flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200 disabled:opacity-60 dark:bg-violet-950 dark:text-violet-300 dark:hover:bg-violet-900"
        >
          {tidyState === "running" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {tidyState === "running" ? "Tidying…" : "Tidy with AI"}
        </button>
      )}

      {/* Docs-style floating status pill: the toolbar icon is easy to
          overlook, so while the mic is live a prominent indicator floats
          over the document — pulsing mic, the phrase being recognized
          (feedback that speech is actually being heard), and Stop. */}
      {(listening || transcribing) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-14 left-1/2 z-40 flex max-w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-200 bg-white py-2 pl-3 pr-2 shadow-xl print:hidden dark:border-zinc-700 dark:bg-zinc-900"
        >
          {transcribing ? (
            <>
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-zinc-700 dark:text-zinc-200">
                Transcribing your recording…
              </span>
            </>
          ) : (
            <>
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-400/40" />
                <Mic className="relative h-4 w-4 text-red-600 dark:text-red-400" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-700 dark:text-zinc-200">
                  {live && dictation.interim ? (
                    <em className="not-italic text-zinc-500 dark:text-zinc-400">
                      {dictation.interim}
                    </em>
                  ) : live ? (
                    "Listening — start speaking"
                  ) : (
                    "Recording — press stop when you're done"
                  )}
                </span>
                <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                  {activeLang?.label ?? lang} · words appear at the cursor
                </span>
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                <CircleStop className="h-3.5 w-3.5" />
                Stop
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute left-0 top-full z-50 mt-1.5 flex w-64 items-start gap-2 rounded-lg border border-red-200 bg-white p-2.5 text-xs text-red-700 shadow-lg dark:border-red-900 dark:bg-zinc-900 dark:text-red-400"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={dismissError}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
