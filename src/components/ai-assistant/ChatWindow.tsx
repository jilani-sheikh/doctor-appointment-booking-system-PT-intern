"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  History,
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChatMessage, type UiChatMessage } from "@/components/ai-assistant/ChatMessage";
import { ChatInput } from "@/components/ai-assistant/ChatInput";
import {
  VoiceControlsBar,
  useVoiceAssistant,
} from "@/components/ai-assistant/VoiceControls";
import type {
  AssistantLanguage,
  ChatResponsePayload,
  ChatSessionSummary,
  DoctorCardData,
  PersistedChatMessageItem,
  SlotOptionData,
} from "@/lib/ai/schemas";

interface ChatWindowProps {
  role: "PATIENT" | "DOCTOR";
  displayName: string;
  isOpen: boolean;
  onClose: () => void;
}

const PATIENT_STARTER_PROMPTS = [
  "Show my upcoming appointments",
  "Show my next appointment",
  "Find available doctors",
  "Check my payments & refund status",
];

const DOCTOR_STARTER_PROMPTS = [
  "Show today's appointments",
  "Show my booking stats for today",
  "Check for scheduling conflicts",
  "Find my next available slot",
];

function createWelcomeMessage(role: "PATIENT" | "DOCTOR", displayName: string): UiChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content:
      role === "PATIENT"
        ? `Hi ${displayName}! I can help you view appointments, find doctors, check open slots, book or reschedule consultations, inspect payment/refund statuses, or cancel with a refund preview. Speak or type in English, Hindi, or Hinglish.`
        : `Hello Dr. ${displayName}! I can summarize today's schedule and stats, detect scheduling conflicts, find your next open slot, suggest patient alternatives, or stage confirmed schedule/appointment updates. Speak or type in English, Hindi, or Hinglish.`,
  };
}

function formatHistoryTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function mapPersistedMessagesToUi(
  items: PersistedChatMessageItem[]
): UiChatMessage[] {
  return items.map((item) => ({
    id: item.id,
    role: item.role,
    content: item.content,
    cards: item.cards ?? [],
    confirmations: item.confirmations ?? [],
    isError: item.isError,
  }));
}

export function ChatWindow({
  role,
  displayName,
  isOpen,
  onClose,
}: ChatWindowProps) {
  const activeSessionStorageKey = `medrella-ai-active-session:${role}`;

  const [messages, setMessages] = useState<UiChatMessage[]>(() => [
    createWelcomeMessage(role, displayName),
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [language, setLanguage] = useState<AssistantLanguage>("en-IN");
  const [isBusy, setIsBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const hasRestoredSessionRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const persistActiveSessionId = useCallback(
    (nextId: string | null) => {
      activeSessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      if (typeof window === "undefined") return;
      try {
        if (nextId) {
          window.sessionStorage.setItem(activeSessionStorageKey, nextId);
        } else {
          window.sessionStorage.removeItem(activeSessionStorageKey);
        }
      } catch {
        // Ignore sessionStorage restrictions.
      }
    },
    [activeSessionStorageKey]
  );

  // Best-effort restore of the active thread across soft navigation within the tab.
  useEffect(() => {
    if (!isOpen || hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;

    if (typeof window === "undefined") return;
    let storedId: string | null = null;
    try {
      storedId = window.sessionStorage.getItem(activeSessionStorageKey);
    } catch {
      return;
    }
    if (!storedId) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/ai-assistant/history?sessionId=${encodeURIComponent(storedId)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            persistActiveSessionId(null);
          }
          return;
        }
        const data = (await res.json()) as {
          session?: ChatSessionSummary;
          messages?: PersistedChatMessageItem[];
        };
        if (
          cancelled ||
          !data.session ||
          !Array.isArray(data.messages) ||
          data.messages.length === 0
        ) {
          return;
        }
        if (messagesRef.current.length <= 1) {
          persistActiveSessionId(data.session.id);
          setMessages(mapPersistedMessagesToUi(data.messages));
        }
      } catch {
        // Ignore silent restore errors.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionStorageKey, isOpen, persistActiveSessionId]);

  const focusInput = useCallback(() => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
  }, []);

  useEffect(() => {
    if (viewMode === "chat") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isBusy, viewMode]);

  const sendPromptRef = useRef<(text: string) => void>(() => {});

  const voice = useVoiceAssistant({
    language,
    isBusy,
    isOpen,
    onTranscriptReady: (transcript) => {
      sendPromptRef.current(transcript);
    },
    onFocusTextInput: focusInput,
  });

  const loadHistorySessions = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/ai-assistant/history");
      const data = (await res.json()) as {
        sessions?: ChatSessionSummary[];
        error?: string;
      };
      if (!res.ok) {
        setHistoryError(data.error || "Unable to load chat history.");
        return;
      }
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setHistoryError("Network error while loading chat history.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || isBusy) return;

      voice.stopSpeaking();
      voice.clearVoiceError();
      setViewMode("chat");
      setConfirmDeleteAll(false);
      setInputValue("");

      const userMessage: UiChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content: trimmed,
      };

      const historyForApi = messagesRef.current
        .filter((m) => m.id !== "welcome" && !m.isError)
        .concat(userMessage)
        .slice(-20)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      setMessages((prev) => [...prev, userMessage]);
      setIsBusy(true);

      try {
        const res = await fetch("/api/ai-assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: activeSessionIdRef.current ?? undefined,
            messages: historyForApi,
            language,
          }),
        });

        const data = (await res.json()) as Partial<ChatResponsePayload> & {
          error?: string;
        };

        if (!res.ok || !data.reply) {
          const errText =
            data.error ||
            "Sorry, I could not complete that request. Please try again.";
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: errText,
              isError: true,
            },
          ]);
          return;
        }

        if (data.sessionId) {
          persistActiveSessionId(data.sessionId);
        }

        const assistantMsg: UiChatMessage = {
          id: `asst-${Date.now()}`,
          role: "assistant",
          content: data.reply,
          cards: data.cards ?? [],
          confirmations: data.confirmations ?? [],
        };
        setMessages((prev) => [...prev, assistantMsg]);
        voice.speakText(data.reply);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content:
              "Network error while contacting the Medrella AI Assistant. Please try again.",
            isError: true,
          },
        ]);
      } finally {
        setIsBusy(false);
        focusInput();
      }
    },
    [focusInput, isBusy, language, persistActiveSessionId, voice]
  );

  useEffect(() => {
    sendPromptRef.current = sendMessage;
  }, [sendMessage]);

  function handleReset() {
    if (isBusy || isDeletingAll) return;
    voice.stopSpeaking();
    voice.clearVoiceError();
    persistActiveSessionId(null);
    setViewMode("chat");
    setConfirmDeleteAll(false);
    setMessages([createWelcomeMessage(role, displayName)]);
    setInputValue("");
    focusInput();
  }

  function handleToggleHistoryView() {
    voice.stopSpeaking();
    setConfirmDeleteAll(false);
    if (viewMode === "history") {
      setViewMode("chat");
      focusInput();
      return;
    }
    setViewMode("history");
    void loadHistorySessions();
  }

  async function handleSelectHistorySession(sessionId: string) {
    if (isBusy || isLoadingThread || isDeletingAll) return;
    voice.stopSpeaking();
    setIsLoadingThread(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/ai-assistant/history?sessionId=${encodeURIComponent(sessionId)}`
      );
      const data = (await res.json()) as {
        session?: ChatSessionSummary;
        messages?: PersistedChatMessageItem[];
        error?: string;
      };
      if (!res.ok || !data.session || !Array.isArray(data.messages)) {
        setHistoryError(data.error || "Unable to open this conversation.");
        return;
      }
      persistActiveSessionId(data.session.id);
      setMessages(
        data.messages.length > 0
          ? mapPersistedMessagesToUi(data.messages)
          : [createWelcomeMessage(role, displayName)]
      );
      setViewMode("chat");
      focusInput();
    } catch {
      setHistoryError("Network error while opening this conversation.");
    } finally {
      setIsLoadingThread(false);
    }
  }

  async function handleDeleteSingleSession(sessionId: string) {
    if (deletingSessionId || isDeletingAll) return;
    setDeletingSessionId(sessionId);
    try {
      const res = await fetch(
        `/api/ai-assistant/history?sessionId=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { deleted?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error || "Could not delete conversation.");
        return;
      }
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      if (activeSessionIdRef.current === sessionId) {
        persistActiveSessionId(null);
        setMessages([createWelcomeMessage(role, displayName)]);
      }
      toast.success("Conversation deleted.");
    } catch {
      toast.error("Network error while deleting conversation.");
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleConfirmDeleteAllHistory() {
    if (isDeletingAll || isBusy) return;
    voice.stopSpeaking();
    setIsDeletingAll(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/ai-assistant/history", {
        method: "DELETE",
      });
      const data = (await res.json()) as {
        deletedAll?: boolean;
        deletedCount?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error || "Failed to delete chat history.");
        return;
      }
      setSessions([]);
      persistActiveSessionId(null);
      setMessages([createWelcomeMessage(role, displayName)]);
      setConfirmDeleteAll(false);
      toast.success(
        data.deletedCount && data.deletedCount > 0
          ? "All chat history deleted."
          : "Chat history cleared."
      );
      focusInput();
    } catch {
      toast.error("Network error while deleting chat history.");
    } finally {
      setIsDeletingAll(false);
    }
  }

  function handleSelectDoctor(doctor: DoctorCardData) {
    void sendMessage(
      `Show available slots for Dr. ${doctor.name} (doctorId: ${doctor.id}).`
    );
  }

  function handleSelectSlot(
    slot: SlotOptionData,
    mode: "BOOK" | "PATIENT_RESCHEDULE" | "DOCTOR_RESCHEDULE",
    appointmentId?: string
  ) {
    if (mode === "BOOK") {
      void sendMessage(
        `Prepare appointment booking for availabilityId ${slot.availabilityId} (${slot.dateIST}, ${slot.timeRangeIST} with Dr. ${slot.doctorName}).`
      );
      return;
    }
    if (mode === "PATIENT_RESCHEDULE" && appointmentId) {
      void sendMessage(
        `Prepare rescheduling appointmentId ${appointmentId} to newAvailabilityId ${slot.availabilityId} (${slot.dateIST}, ${slot.timeRangeIST}).`
      );
      return;
    }
    if (mode === "DOCTOR_RESCHEDULE" && appointmentId) {
      void sendMessage(
        `Prepare doctor reschedule for appointmentId ${appointmentId} to newAvailabilityId ${slot.availabilityId} (${slot.dateIST}, ${slot.timeRangeIST}).`
      );
    }
  }

  function handleConfirmationSettled(outcome: {
    confirmationId: string;
    status: "confirmed" | "cancelled" | "failed";
    message: string;
  }) {
    setMessages((prev) => [
      ...prev,
      {
        id: `settled-${Date.now()}`,
        role: "assistant",
        content: outcome.message,
        isError: outcome.status === "failed",
      },
    ]);
  }

  const starterPrompts =
    role === "PATIENT" ? PATIENT_STARTER_PROMPTS : DOCTOR_STARTER_PROMPTS;

  return (
    <div
      role="dialog"
      aria-label="Medrella AI Assistant"
      className="flex flex-col h-full w-full rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-primary px-3.5 py-2.5 text-primary-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-full bg-primary-foreground/15 flex items-center justify-center shrink-0">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold truncate">Medrella AI</h3>
              <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px] font-medium">
                {role === "DOCTOR" ? "Doctor" : "Patient"}
              </span>
            </div>
            <p className="text-[11px] opacity-85 truncate">
              Verified clinic assistant
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className={`text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground ${
              viewMode === "history" ? "bg-primary-foreground/20" : ""
            }`}
            onClick={handleToggleHistoryView}
            disabled={isDeletingAll}
            title="Chat history"
            aria-label="Chat history"
          >
            <History className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className={`text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground ${
              confirmDeleteAll ? "bg-primary-foreground/20" : ""
            }`}
            onClick={() => setConfirmDeleteAll((prev) => !prev)}
            disabled={isBusy || isDeletingAll}
            title="Delete all chat history"
            aria-label="Delete all chat history"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={handleReset}
            disabled={isBusy || isDeletingAll}
            title="Start new conversation"
            aria-label="Start new conversation"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
            onClick={onClose}
            title="Close assistant"
            aria-label="Close assistant"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {confirmDeleteAll && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
          <span className="font-medium leading-tight">
            Delete all saved chat history? This cannot be undone.
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-6 px-2 text-[11px] border-border bg-background text-foreground"
              disabled={isDeletingAll}
              onClick={() => setConfirmDeleteAll(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              className="h-6 px-2 text-[11px]"
              disabled={isDeletingAll}
              onClick={() => void handleConfirmDeleteAllHistory()}
            >
              {isDeletingAll && <Loader2 className="size-3 animate-spin mr-1" />}
              Delete All
            </Button>
          </div>
        </div>
      )}

      {viewMode === "history" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-muted/15">
          <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/70">
            <div className="flex items-center gap-1.5 min-w-0">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  setViewMode("chat");
                  focusInput();
                }}
                title="Back to chat"
                aria-label="Back to chat"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs font-semibold text-foreground truncate">
                Chat History
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={handleReset}
              disabled={isBusy || isDeletingAll}
            >
              <SquarePen className="size-3" />
              New Chat
            </Button>
          </div>

          {historyError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
              <span>{historyError}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-6 px-2 text-[11px] bg-background text-foreground"
                onClick={() => void loadHistorySessions()}
              >
                Retry
              </Button>
            </div>
          )}

          {isLoadingHistory ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Loading saved conversations...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-8 text-center space-y-1.5">
              <MessageSquare className="size-5 mx-auto text-muted-foreground/70" />
              <p className="text-xs font-medium text-foreground">
                No saved chat history
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Your conversations with Medrella AI will appear here so you can revisit them anytime.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const isActive = activeSessionId === session.id;
                const isDeletingThis = deletingSessionId === session.id;
                return (
                  <div
                    key={session.id}
                    className={`group flex items-start justify-between gap-2 rounded-xl border p-2.5 transition-colors ${
                      isActive
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card hover:border-primary/35 hover:bg-muted/30"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isLoadingThread || isDeletingThis || isDeletingAll}
                      onClick={() => void handleSelectHistorySession(session.id)}
                      className="min-w-0 flex-1 text-left space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {session.title}
                        </p>
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            Active
                          </span>
                        )}
                      </div>
                      {session.lastMessagePreview && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                          {session.lastMessagePreview}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/80">
                        {formatHistoryTimestamp(session.updatedAt)} • {session.messageCount}{" "}
                        {session.messageCount === 1 ? "msg" : "msgs"}
                      </p>
                    </button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      disabled={isDeletingThis || isDeletingAll || isLoadingThread}
                      onClick={() => void handleDeleteSingleSession(session.id)}
                      title="Delete this conversation"
                      aria-label={`Delete conversation ${session.title}`}
                    >
                      {isDeletingThis ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-muted/15">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                busy={isBusy}
                onQuickPrompt={(prompt) => void sendMessage(prompt)}
                onSelectDoctor={handleSelectDoctor}
                onSelectSlot={handleSelectSlot}
                onConfirmationSettled={handleConfirmationSettled}
              />
            ))}

            {messages.length === 1 && !isBusy && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Sparkles className="size-3 text-primary" />
                  Try asking:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isBusy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                <span>Checking your Medrella records...</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Voice Controls */}
          <VoiceControlsBar
            language={language}
            onLanguageChange={setLanguage}
            recognitionSupported={voice.recognitionSupported}
            synthesisSupported={voice.synthesisSupported}
            isListening={voice.isListening}
            isSpeaking={voice.isSpeaking}
            isMuted={voice.isMuted}
            continuousMode={voice.continuousMode}
            interimTranscript={voice.interimTranscript}
            voiceError={voice.voiceError}
            onToggleMute={voice.toggleMute}
            onToggleContinuous={voice.toggleContinuousMode}
            onStopSpeaking={voice.stopSpeaking}
          />

          {/* Input */}
          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={() => void sendMessage(inputValue)}
            isBusy={isBusy}
            isListening={voice.isListening}
            recognitionSupported={voice.recognitionSupported}
            onToggleListening={voice.toggleListening}
            inputRef={inputRef}
          />
        </>
      )}
    </div>
  );
}
