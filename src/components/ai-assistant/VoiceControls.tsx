"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Globe, Mic, MicOff, Radio, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cleanTextForSpeech,
  splitSpeechChunks,
} from "@/lib/ai/format-text";
import {
  ASSISTANT_LANGUAGE_OPTIONS,
  type AssistantLanguage,
} from "@/lib/ai/schemas";

export { cleanTextForSpeech };

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};
const getRecognitionSupportedSnapshot = () => getSpeechRecognitionCtor() !== null;
const getSynthesisSupportedSnapshot = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
const getServerUnsupported = () => false;

function scoreVoice(voice: SpeechSynthesisVoice, targetLang: string): number {
  const voiceLang = voice.lang.toLowerCase();
  const desired = targetLang.toLowerCase();
  const baseDesired = desired.split("-")[0];

  if (voiceLang !== desired && !voiceLang.startsWith(baseDesired)) {
    return -1;
  }

  let score = voiceLang === desired ? 40 : 20;
  const name = voice.name.toLowerCase();
  if (
    name.includes("natural") ||
    name.includes("online") ||
    name.includes("neural")
  ) {
    score += 30;
  }
  if (name.includes("google") || name.includes("microsoft")) {
    score += 15;
  }
  if (!voice.localService) {
    score += 8;
  }
  if (voice.default) {
    score += 2;
  }
  return score;
}

function selectPreferredVoice(
  voices: SpeechSynthesisVoice[],
  targetLang: string
): SpeechSynthesisVoice | null {
  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -1;

  for (const voice of voices) {
    const score = scoreVoice(voice, targetLang);
    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice;
}

export interface UseVoiceAssistantOptions {
  language: AssistantLanguage;
  isBusy: boolean;
  isOpen: boolean;
  onTranscriptReady: (transcript: string) => void;
  onFocusTextInput: () => void;
}

export function useVoiceAssistant({
  language,
  isBusy,
  isOpen,
  onTranscriptReady,
  onFocusTextInput,
}: UseVoiceAssistantOptions) {
  const recognitionSupported = useSyncExternalStore(
    noopSubscribe,
    getRecognitionSupportedSnapshot,
    getServerUnsupported
  );
  const synthesisSupported = useSyncExternalStore(
    noopSubscribe,
    getSynthesisSupportedSnapshot,
    getServerUnsupported
  );

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const isSpeakingRef = useRef(false);
  const isBusyRef = useRef(isBusy);
  const isOpenRef = useRef(isOpen);
  const continuousRef = useRef(continuousMode);
  const isMutedRef = useRef(isMuted);
  const onTranscriptRef = useRef(onTranscriptReady);
  const langRef = useRef(language);
  const abortedForTtsRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const speechGenerationRef = useRef(0);
  const speechStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const warmVoices = () => {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // Ignore browser voice enumeration errors.
      }
    };
    warmVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", warmVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", warmVoices);
    };
  }, []);

  useEffect(() => {
    isBusyRef.current = isBusy;
    isOpenRef.current = isOpen;
    continuousRef.current = continuousMode;
    isMutedRef.current = isMuted;
    onTranscriptRef.current = onTranscriptReady;
    langRef.current = language;
  }, [isBusy, isOpen, continuousMode, isMuted, onTranscriptReady, language]);

  const stopListening = useCallback(() => {
    abortedForTtsRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore abort errors when recognition already stopped.
    }
    recognitionRef.current = null;
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceError(
        "Voice input is unavailable in this browser. Type your message below."
      );
      onFocusTextInput();
      return;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore cleanup failure.
      }
      recognitionRef.current = null;
    }

    setVoiceError(null);
    abortedForTtsRef.current = false;

    const langConfig = ASSISTANT_LANGUAGE_OPTIONS.find(
      (opt) => opt.value === langRef.current
    );
    const speechLang = langConfig?.speechLang ?? "en-IN";

    const recognition = new Ctor();
    recognition.lang = speechLang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let emittedFinal = false;

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript("");
    };

    recognition.onresult = (event) => {
      if (abortedForTtsRef.current || isSpeakingRef.current) {
        return;
      }
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const piece = res[0]?.transcript ?? "";
        if (res.isFinal) {
          finalChunk += piece;
        } else {
          interimChunk += piece;
        }
      }
      setInterimTranscript(interimChunk.trim());

      const trimmedFinal = finalChunk.trim();
      if (trimmedFinal && !emittedFinal) {
        emittedFinal = true;
        setInterimTranscript("");
        try {
          recognition.stop();
        } catch {
          // Ignore stop errors.
        }
        onTranscriptRef.current(trimmedFinal);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setInterimTranscript("");
      if (abortedForTtsRef.current || event.error === "aborted") {
        return;
      }
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        setContinuousMode(false);
        setVoiceError(
          "Microphone access was denied. Enable mic permission in browser settings or type below."
        );
        onFocusTextInput();
      } else if (event.error === "no-speech") {
        if (
          continuousRef.current &&
          isOpenRef.current &&
          !isSpeakingRef.current &&
          !isBusyRef.current
        ) {
          setTimeout(() => {
            if (
              continuousRef.current &&
              isOpenRef.current &&
              !isSpeakingRef.current &&
              !isBusyRef.current
            ) {
              startListeningRef.current();
            }
          }, 300);
        }
      } else {
        setVoiceError(
          `Voice input error (${event.error}). You can type your message below.`
        );
        onFocusTextInput();
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceError("Could not start microphone. Please type your message below.");
      onFocusTextInput();
    }
  }, [onFocusTextInput]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopSpeaking = useCallback(() => {
    speechGenerationRef.current += 1;
    if (speechStartTimerRef.current) {
      clearTimeout(speechStartTimerRef.current);
      speechStartTimerRef.current = null;
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speakText = useCallback(
    (rawText: string) => {
      if (
        isMutedRef.current ||
        !isOpenRef.current ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        return;
      }

      const cleaned = cleanTextForSpeech(rawText);
      const chunks = splitSpeechChunks(cleaned, 165);
      if (chunks.length === 0) return;

      // Always suspend mic before TTS starts to prevent self-echo loops.
      if (recognitionRef.current) {
        abortedForTtsRef.current = true;
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore.
        }
        recognitionRef.current = null;
        setIsListening(false);
        setInterimTranscript("");
      }

      const genId = ++speechGenerationRef.current;
      if (speechStartTimerRef.current) {
        clearTimeout(speechStartTimerRef.current);
        speechStartTimerRef.current = null;
      }

      window.speechSynthesis.cancel();

      const langConfig = ASSISTANT_LANGUAGE_OPTIONS.find(
        (opt) => opt.value === langRef.current
      );
      const targetLang = langConfig?.speechLang ?? "en-IN";
      const matchedVoice = selectPreferredVoice(
        window.speechSynthesis.getVoices(),
        targetLang
      );

      const finishSpeech = () => {
        if (genId !== speechGenerationRef.current) return;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        abortedForTtsRef.current = false;
        if (
          continuousRef.current &&
          isOpenRef.current &&
          !isBusyRef.current &&
          getSpeechRecognitionCtor()
        ) {
          setTimeout(() => {
            if (
              genId === speechGenerationRef.current &&
              continuousRef.current &&
              isOpenRef.current &&
              !isSpeakingRef.current &&
              !isBusyRef.current
            ) {
              startListeningRef.current();
            }
          }, 250);
        }
      };

      const speakChunk = (index: number) => {
        if (
          genId !== speechGenerationRef.current ||
          isMutedRef.current ||
          !isOpenRef.current
        ) {
          return;
        }
        if (index >= chunks.length) {
          finishSpeech();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = targetLang;
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }
        utterance.rate = 0.96;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
          if (genId !== speechGenerationRef.current) return;
          isSpeakingRef.current = true;
          setIsSpeaking(true);
        };
        utterance.onend = () => {
          if (genId !== speechGenerationRef.current) return;
          speakChunk(index + 1);
        };
        utterance.onerror = () => {
          if (genId !== speechGenerationRef.current) return;
          finishSpeech();
        };

        window.speechSynthesis.speak(utterance);
      };

      isSpeakingRef.current = true;
      setIsSpeaking(true);

      // Small delay after cancel() avoids Chromium silently dropping the first chunk.
      speechStartTimerRef.current = setTimeout(() => {
        speechStartTimerRef.current = null;
        speakChunk(0);
      }, 25);
    },
    []
  );

  // Stop external browser voice resources on close/unmount without synchronous setState in effect.
  useEffect(() => {
    if (!isOpen) {
      speechGenerationRef.current += 1;
      if (speechStartTimerRef.current) {
        clearTimeout(speechStartTimerRef.current);
        speechStartTimerRef.current = null;
      }
      abortedForTtsRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore.
      }
      recognitionRef.current = null;
      isSpeakingRef.current = false;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    }

    return () => {
      speechGenerationRef.current += 1;
      if (speechStartTimerRef.current) {
        clearTimeout(speechStartTimerRef.current);
        speechStartTimerRef.current = null;
      }
      abortedForTtsRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore.
      }
      recognitionRef.current = null;
      isSpeakingRef.current = false;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isOpen]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        stopSpeaking();
      }
      return next;
    });
  }, [stopSpeaking]);

  const toggleContinuousMode = useCallback(() => {
    setContinuousMode((prev) => {
      const next = !prev;
      if (!next) {
        stopListening();
      } else if (!isListening && !isSpeakingRef.current && !isBusyRef.current) {
        startListening();
      }
      return next;
    });
  }, [isListening, startListening, stopListening]);

  return {
    recognitionSupported,
    synthesisSupported,
    isListening,
    isSpeaking,
    isMuted,
    continuousMode,
    interimTranscript,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
    toggleListening,
    toggleMute,
    toggleContinuousMode,
    stopSpeaking,
    speakText,
  };
}

interface VoiceControlsProps {
  language: AssistantLanguage;
  onLanguageChange: (language: AssistantLanguage) => void;
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  continuousMode: boolean;
  interimTranscript: string;
  voiceError: string | null;
  onToggleMute: () => void;
  onToggleContinuous: () => void;
  onStopSpeaking: () => void;
}

export function VoiceControlsBar({
  language,
  onLanguageChange,
  recognitionSupported,
  synthesisSupported,
  isListening,
  isSpeaking,
  isMuted,
  continuousMode,
  interimTranscript,
  voiceError,
  onToggleMute,
  onToggleContinuous,
  onStopSpeaking,
}: VoiceControlsProps) {
  return (
    <div className="border-t border-border bg-muted/30 px-3 py-1.5 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1">
          <Globe className="size-3.5 text-muted-foreground" />
          <label htmlFor="ai-assistant-lang" className="sr-only">
            Assistant language
          </label>
          <select
            id="ai-assistant-lang"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as AssistantLanguage)}
            className="h-6 rounded-md border border-border bg-background px-1.5 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ASSISTANT_LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          {recognitionSupported && (
            <Button
              type="button"
              size="xs"
              variant={continuousMode ? "default" : "outline"}
              onClick={onToggleContinuous}
              title="Toggle continuous hands-free voice loop"
              aria-pressed={continuousMode}
              className="gap-1 text-[11px]"
            >
              <Radio className={`size-3 ${continuousMode ? "animate-pulse" : ""}`} />
              Continuous
            </Button>
          )}

          {synthesisSupported && (
            <Button
              type="button"
              size="icon-xs"
              variant={isMuted ? "outline" : "secondary"}
              onClick={onToggleMute}
              title={
                isMuted
                  ? "Unmute assistant voice replies"
                  : "Mute assistant voice replies"
              }
              aria-label={
                isMuted ? "Unmute voice replies" : "Mute voice replies"
              }
            >
              {isMuted ? (
                <VolumeX className="size-3.5" />
              ) : (
                <Volume2 className="size-3.5" />
              )}
            </Button>
          )}

          {isSpeaking && (
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={onStopSpeaking}
              className="gap-1 text-[11px]"
            >
              <Square className="size-2.5 fill-current" />
              Stop
            </Button>
          )}

          {!recognitionSupported && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <MicOff className="size-3" />
              Text mode
            </span>
          )}
        </div>
      </div>

      {isListening && (
        <p className="text-[11px] text-primary font-medium flex items-center gap-1.5">
          <Mic className="size-3 animate-pulse shrink-0" />
          <span className="truncate">
            {interimTranscript
              ? `Listening: "${interimTranscript}"`
              : "Listening... speak now"}
          </span>
        </p>
      )}

      {voiceError && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {voiceError}
        </p>
      )}

      {recognitionSupported && !isListening && !voiceError && continuousMode && (
        <p className="text-[10px] text-muted-foreground">
          Hands-free continuous voice active (pauses automatically while speaking).
        </p>
      )}
    </div>
  );
}
