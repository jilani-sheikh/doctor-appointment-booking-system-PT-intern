"use client";

import { FormattedAssistantText } from "./FormattedAssistantText";

import { AlertTriangle, Bot, CheckCircle2, CreditCard, ShieldAlert, User } from "lucide-react";
import { AppointmentCardList } from "@/components/ai-assistant/AppointmentCard";
import { DoctorCardList } from "@/components/ai-assistant/DoctorCard";
import { SlotSelector } from "@/components/ai-assistant/SlotSelector";
import { ActionConfirmation } from "@/components/ai-assistant/ActionConfirmation";
import type {
  AssistantCard,
  DoctorCardData,
  PendingConfirmation,
  SlotOptionData,
} from "@/lib/ai/schemas";

export interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards?: AssistantCard[];
  confirmations?: PendingConfirmation[];
  isError?: boolean;
}

interface ChatMessageProps {
  message: UiChatMessage;
  busy?: boolean;
  onQuickPrompt: (prompt: string) => void;
  onSelectDoctor: (doctor: DoctorCardData) => void;
  onSelectSlot: (
    slot: SlotOptionData,
    mode: "BOOK" | "PATIENT_RESCHEDULE" | "DOCTOR_RESCHEDULE",
    appointmentId?: string
  ) => void;
  onConfirmationSettled?: (outcome: {
    confirmationId: string;
    status: "confirmed" | "cancelled" | "failed";
    message: string;
  }) => void;
}

function getToneClass(tone?: "default" | "success" | "warning" | "danger") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "warning":
      return "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
    case "danger":
      return "border-rose-200 bg-rose-50/70 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300";
    default:
      return "border-border/80 bg-background/60 text-foreground";
  }
}

export function ChatMessage({
  message,
  busy,
  onQuickPrompt,
  onSelectDoctor,
  onSelectSlot,
  onConfirmationSettled,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="size-4" />
        </div>
      )}

      <div className={`max-w-[88%] space-y-2 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-xs whitespace-pre-wrap"
              : message.isError
                ? "border border-destructive/40 bg-destructive/10 text-destructive rounded-tl-xs"
                : "border border-border bg-card text-card-foreground rounded-tl-xs shadow-xs"
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <FormattedAssistantText
              content={message.content}
              isError={message.isError}
            />
          )}
        </div>

        {!isUser &&
          message.cards?.map((card, idx) => {
            if (card.type === "appointment_list") {
              return (
                <div key={`card-${idx}`} className="w-full">
                  <AppointmentCardList
                    title={card.title}
                    viewerRole={card.viewerRole}
                    items={card.items}
                    disabled={busy}
                    onQuickPrompt={onQuickPrompt}
                  />
                </div>
              );
            }
            if (card.type === "doctor_list") {
              return (
                <div key={`card-${idx}`} className="w-full">
                  <DoctorCardList
                    title={card.title}
                    items={card.items}
                    disabled={busy}
                    onSelectDoctor={onSelectDoctor}
                  />
                </div>
              );
            }
            if (card.type === "slot_selector") {
              return (
                <div key={`card-${idx}`} className="w-full">
                  <SlotSelector
                    title={card.title}
                    mode={card.mode}
                    appointmentId={card.appointmentId}
                    slots={card.slots}
                    disabled={busy}
                    onSelectSlot={onSelectSlot}
                  />
                </div>
              );
            }
            if (card.type === "stats_summary") {
              return (
                <div
                  key={`card-${idx}`}
                  className="w-full rounded-xl border border-border bg-card p-3 shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {card.title}
                    </h4>
                    <span className="text-[11px] text-muted-foreground">
                      {card.dateRangeLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {card.metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className={`rounded-lg border px-2.5 py-1.5 ${getToneClass(metric.tone)}`}
                      >
                        <p className="text-[10px] opacity-80">{metric.label}</p>
                        <p className="text-sm font-bold">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            if (card.type === "conflict_list") {
              return (
                <div
                  key={`card-${idx}`}
                  className="w-full rounded-xl border border-border bg-card p-3 shadow-xs space-y-2"
                >
                  <div className="flex items-center gap-1.5">
                    {card.hasConflicts ? (
                      <ShieldAlert className="size-4 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    )}
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {card.title}
                    </h4>
                  </div>
                  {!card.hasConflicts ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      No scheduling conflicts detected.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {card.items.map((item, cIdx) => (
                        <div
                          key={`conflict-${cIdx}`}
                          className="rounded-lg border border-amber-300 bg-amber-50/70 p-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 space-y-0.5"
                        >
                          <p className="font-semibold flex items-center gap-1">
                            <AlertTriangle className="size-3 shrink-0" />
                            {item.kind.replaceAll("_", " ")} • {item.dateIST}
                          </p>
                          <p className="opacity-90">{item.timeRangeIST}</p>
                          <p>{item.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            if (card.type === "payment_list") {
              return (
                <div
                  key={`card-${idx}`}
                  className="w-full rounded-xl border border-border bg-card p-3 shadow-xs space-y-2"
                >
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {card.title}
                  </h4>
                  {card.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No payment transactions found.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {card.items.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-lg border border-border/80 bg-background/60 p-2 text-[11px] space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <CreditCard className="size-3 text-primary" />
                              Dr. {p.doctorName}
                            </span>
                            <span className="font-semibold">{p.amountDisplay}</span>
                          </div>
                          <p className="text-muted-foreground">
                            {p.dateIST} • Status: <strong className="text-foreground">{p.status}</strong>
                          </p>
                          {p.refunds.map((r) => (
                            <p
                              key={r.id}
                              className="rounded bg-muted px-2 py-1 text-[10px] text-foreground"
                            >
                              Refund {r.amountDisplay} • Status: {r.status} ({r.reason.replaceAll("_", " ")})
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            if (card.type === "confirmation") {
              return (
                <div key={`card-${idx}`} className="w-full">
                  <ActionConfirmation
                    confirmation={card.confirmation}
                    onSettled={onConfirmationSettled}
                  />
                </div>
              );
            }
            return null;
          })}

        {!isUser &&
          message.confirmations?.map((conf) => (
            <div key={conf.confirmationId} className="w-full">
              <ActionConfirmation
                confirmation={conf}
                onSettled={onConfirmationSettled}
              />
            </div>
          ))}
      </div>

      {isUser && (
        <div className="size-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}

