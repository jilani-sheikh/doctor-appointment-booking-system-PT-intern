import { z } from "zod";

export const assistantLanguageSchema = z.enum(["en-IN", "hi-IN", "hinglish"]);
export type AssistantLanguage = z.infer<typeof assistantLanguageSchema>;

export const ASSISTANT_LANGUAGE_OPTIONS: Array<{
  value: AssistantLanguage;
  label: string;
  speechLang: string;
  shortLabel: string;
}> = [
  { value: "en-IN", label: "English", speechLang: "en-IN", shortLabel: "EN" },
  { value: "hi-IN", label: "Hindi (हिन्दी)", speechLang: "hi-IN", shortLabel: "HI" },
  { value: "hinglish", label: "Hinglish", speechLang: "en-IN", shortLabel: "HI-EN" },
];

export const confirmActionTypeSchema = z.enum([
  "PATIENT_BOOK_APPOINTMENT",
  "PATIENT_RESCHEDULE_APPOINTMENT",
  "PATIENT_CANCEL_APPOINTMENT",
  "PATIENT_CANCEL_HOLD",
  "PATIENT_RESUME_PAYMENT",
  "PATIENT_CHECK_IN",
  "DOCTOR_SHRINK_AVAILABILITY",
  "DOCTOR_EXPAND_AVAILABILITY",
  "DOCTOR_BLOCK_SCHEDULE_DATE",
  "DOCTOR_UNBLOCK_SCHEDULE_DATE",
  "DOCTOR_TOGGLE_BLOCK_SLOT",
  "DOCTOR_CREATE_SCHEDULE",
  "DOCTOR_CREATE_TIME_OFF",
  "DOCTOR_DELETE_TIME_OFF",
  "DOCTOR_CANCEL_APPOINTMENT",
  "DOCTOR_COMPLETE_APPOINTMENT",
  "DOCTOR_MARK_NO_SHOW",
  "DOCTOR_RESCHEDULE_APPOINTMENT",
  "DOCTOR_RESOLVE_DISRUPTED_MANUALLY",
]);

export type ConfirmActionType = z.infer<typeof confirmActionTypeSchema>;

export interface AppointmentCardData {
  id: string;
  status: string;
  rescheduleStatus?: string | null;
  disruptedAt?: string | null;
  disruptionReason?: string | null;
  doctorId: string;
  doctorName: string;
  doctorSpecialization: string;
  patientName: string;
  dateIST: string;
  timeRangeIST: string;
  slotKind: string;
  tokenNumber?: number | null;
  waveLabel?: string | null;
  paymentStatus?: string | null;
  amountDisplay?: string | null;
  requiresPaymentResume?: boolean;
  canCheckIn?: boolean;
  canCancel?: boolean;
  canReschedule?: boolean;
  canDoctorCancel?: boolean;
  canDoctorComplete?: boolean;
  canDoctorNoShow?: boolean;
  availabilityId?: string;
  notes?: string | null;
}

export interface DoctorCardData {
  id: string;
  name: string;
  specialization: string;
  qualification?: string | null;
  experienceYears?: number | null;
  consultationFeeRupees: number;
  bio?: string | null;
  nextAvailableDateIST?: string | null;
  nextAvailableTimeIST?: string | null;
}

export interface SlotOptionData {
  availabilityId: string;
  doctorId: string;
  doctorName: string;
  doctorSpecialization?: string;
  dateIST: string;
  timeRangeIST: string;
  kind: string;
  capacity: number;
  activeCount: number;
  remainingSeats: number;
  consultationFeeRupees: number;
  categoryLabel?: string;
}

export interface PendingConfirmation {
  confirmationId: string;
  token: string;
  action: ConfirmActionType;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  warning?: string;
  expiresAt: string;
  confirmLabel: string;
  cancelLabel: string;
  settledStatus?: "confirmed" | "failed" | "expired";
  settledMessage?: string;
}

export interface StatsSummaryCard {
  type: "stats_summary";
  title: string;
  dateRangeLabel: string;
  metrics: Array<{
    label: string;
    value: string | number;
    tone?: "default" | "success" | "warning" | "danger";
  }>;
}

export interface ConflictListCard {
  type: "conflict_list";
  title: string;
  hasConflicts: boolean;
  items: Array<{
    severity: "high" | "medium";
    kind: string;
    dateIST: string;
    timeRangeIST: string;
    summary: string;
  }>;
}

export interface PaymentListCard {
  type: "payment_list";
  title: string;
  items: Array<{
    id: string;
    appointmentId: string;
    doctorName: string;
    dateIST: string;
    amountDisplay: string;
    status: string;
    providerOrderId?: string | null;
    refunds: Array<{
      id: string;
      amountDisplay: string;
      status: string;
      reason: string;
    }>;
  }>;
}

export type AssistantCard =
  | {
      type: "appointment_list";
      title: string;
      viewerRole: "PATIENT" | "DOCTOR";
      items: AppointmentCardData[];
    }
  | {
      type: "doctor_list";
      title: string;
      items: DoctorCardData[];
    }
  | {
      type: "slot_selector";
      title: string;
      mode: "BOOK" | "PATIENT_RESCHEDULE" | "DOCTOR_RESCHEDULE";
      doctorId: string;
      doctorName: string;
      appointmentId?: string;
      slots: SlotOptionData[];
    }
  | {
      type: "confirmation";
      confirmation: PendingConfirmation;
    }
  | StatsSummaryCard
  | ConflictListCard
  | PaymentListCard;

export const chatMessageInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

export const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120).optional(),
  messages: z.array(chatMessageInputSchema).min(1).max(30),
  language: assistantLanguageSchema.default("en-IN"),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResponsePayload {
  sessionId?: string;
  reply: string;
  cards: AssistantCard[];
  confirmations: PendingConfirmation[];
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface PersistedChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: AssistantCard[];
  confirmations: PendingConfirmation[];
  isError: boolean;
  createdAt: string;
}

export const confirmRequestSchema = z.object({
  token: z.string().trim().min(20).max(8000),
});

export interface ConfirmResponsePayload {
  success: boolean;
  message: string;
  appointmentId?: string;
  requiresPayment?: boolean;
  orderId?: string;
  paymentSessionId?: string;
  error?: string;
}

export const confirmPayloadSchemas = {
  PATIENT_BOOK_APPOINTMENT: z.object({
    availabilityId: z.string().min(1),
    stream: z.enum(["NEW_CONSULTATION", "FOLLOW_UP"]).default("NEW_CONSULTATION"),
    reason: z.string().max(1000).optional(),
  }),
  PATIENT_RESCHEDULE_APPOINTMENT: z.object({
    appointmentId: z.string().min(1),
    newAvailabilityId: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  PATIENT_CANCEL_APPOINTMENT: z.object({
    appointmentId: z.string().min(1),
  }),
  PATIENT_CANCEL_HOLD: z.object({
    appointmentId: z.string().min(1),
  }),
  PATIENT_RESUME_PAYMENT: z.object({
    appointmentId: z.string().min(1),
  }),
  PATIENT_CHECK_IN: z.object({
    appointmentId: z.string().min(1),
  }),
  DOCTOR_SHRINK_AVAILABILITY: z.object({
    scheduleId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    edge: z.enum(["START", "END"]),
    steps: z.number().int().min(1).max(100),
    applyToFuture: z.boolean(),
  }),
  DOCTOR_EXPAND_AVAILABILITY: z.object({
    scheduleId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    edge: z.enum(["START", "END"]),
    steps: z.number().int().min(1).max(100),
    applyToFuture: z.boolean(),
  }),
  DOCTOR_BLOCK_SCHEDULE_DATE: z.object({
    scheduleId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    confirmCancellation: z.boolean(),
  }),
  DOCTOR_UNBLOCK_SCHEDULE_DATE: z.object({
    scheduleId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  DOCTOR_TOGGLE_BLOCK_SLOT: z.object({
    slotId: z.string().min(1),
  }),
  DOCTOR_CREATE_SCHEDULE: z.object({
    type: z.enum(["WAVE", "STREAM"]),
    recurrence: z.enum(["ONCE", "RECURRING"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daysOfWeek: z.array(z.number().int().min(0).max(6)),
    startMinute: z.number().int().min(0).max(1435),
    endMinute: z.number().int().min(5).max(1440),
    durationMinutes: z.number().int().min(5).max(240),
    capacity: z.number().int().min(1).max(500),
    confirmOverrideCancellation: z.boolean().optional(),
  }),
  DOCTOR_CREATE_TIME_OFF: z.object({
    startAt: z.string().min(10),
    endAt: z.string().min(10),
    reason: z.string().max(500).optional(),
  }),
  DOCTOR_DELETE_TIME_OFF: z.object({
    id: z.string().min(1),
  }),
  DOCTOR_CANCEL_APPOINTMENT: z.object({
    appointmentId: z.string().min(1),
  }),
  DOCTOR_COMPLETE_APPOINTMENT: z.object({
    appointmentId: z.string().min(1),
  }),
  DOCTOR_MARK_NO_SHOW: z.object({
    appointmentId: z.string().min(1),
  }),
  DOCTOR_RESCHEDULE_APPOINTMENT: z.object({
    appointmentId: z.string().min(1),
    newAvailabilityId: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  DOCTOR_RESOLVE_DISRUPTED_MANUALLY: z.object({
    appointmentId: z.string().min(1),
    resolutionNote: z.string().max(500).optional(),
  }),
} as const;
