"use client";

import type { FormEvent, RefObject } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isBusy: boolean;
  isListening: boolean;
  recognitionSupported: boolean;
  onToggleListening: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isBusy,
  isListening,
  recognitionSupported,
  onToggleListening,
  inputRef,
}: ChatInputProps) {
  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || isBusy) return;
    onSubmit();
  }

  return (
    <form
      onSubmit={handleFormSubmit}
      className="flex items-center gap-1.5 border-t border-border bg-background p-2.5"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isListening ? "Listening..." : "Ask anything about your appointments..."}
        disabled={isBusy}
        maxLength={4000}
        aria-label="Message the Medrella AI Assistant"
        className="flex-1 h-9 rounded-lg border border-border bg-muted/30 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
      />

      {recognitionSupported && (
        <Button
          type="button"
          size="icon-sm"
          variant={isListening ? "destructive" : "outline"}
          disabled={isBusy}
          onClick={onToggleListening}
          aria-label={isListening ? "Stop voice input" : "Start voice input"}
          title={isListening ? "Stop listening" : "Speak your query"}
        >
          {isListening ? (
            <MicOff className="size-4 animate-pulse" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
      )}

      <Button
        type="submit"
        size="icon-sm"
        disabled={isBusy || !value.trim()}
        aria-label="Send message"
      >
        {isBusy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </Button>
    </form>
  );
}

