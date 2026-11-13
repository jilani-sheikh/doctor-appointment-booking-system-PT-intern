"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquareHeart, X } from "lucide-react";
import { ChatWindow } from "@/components/ai-assistant/ChatWindow";

interface FloatingAssistantProps {
  role: "PATIENT" | "DOCTOR";
  displayName: string;
}

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/admin",
];

export function FloatingAssistant({
  role,
  displayName,
}: FloatingAssistantProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  if (
    HIDDEN_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {isOpen && (
        <div className="pointer-events-auto w-[calc(100vw-2rem)] sm:w-[420px] h-[min(82vh,640px)]">
          <ChatWindow
            role={role}
            displayName={displayName}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close Medrella AI Assistant" : "Open Medrella AI Assistant"}
        aria-expanded={isOpen}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 transition-transform active:scale-95"
      >
        {isOpen ? (
          <>
            <X className="size-4" />
            <span className="hidden sm:inline">Close AI</span>
          </>
        ) : (
          <>
            <MessageSquareHeart className="size-4" />
            <span>
              {role === "DOCTOR" ? "Doctor AI" : "Clinic AI"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

