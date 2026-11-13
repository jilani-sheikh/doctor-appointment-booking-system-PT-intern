import "server-only";
import { generateText, stepCountIs, type ToolSet } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getGeminiApiKey, getGeminiModelId } from "@/lib/env";
import {
  extractGeminiStatusCode,
  getGeminiModelCandidates,
  isFallbackEligibleGeminiError,
} from "@/lib/ai/helpers";
import type { AssistantLanguage } from "@/lib/ai/schemas";
import { formatDateTimeIST, getTodayISTDateString } from "@/lib/time";

const MODEL_COOLDOWN_MS = 2 * 60 * 1000;

const globalForModelCooldown = globalThis as unknown as {
  __medrellaGeminiModelCooldowns?: Map<string, number>;
};

function getCooldownMap(): Map<string, number> {
  if (!globalForModelCooldown.__medrellaGeminiModelCooldowns) {
    globalForModelCooldown.__medrellaGeminiModelCooldowns = new Map<string, number>();
  }
  return globalForModelCooldown.__medrellaGeminiModelCooldowns;
}

/**
 * Lazily builds a Google Gemini language model instance for a given model ID.
 */
export function getGeminiLanguageModel(modelId?: string) {
  const provider = createGoogleGenerativeAI({
    apiKey: getGeminiApiKey(),
  });
  return provider(modelId ?? getGeminiModelId());
}

/**
 * Runs multi-step Gemini generation with automatic failover across active Flash models
 * if the primary model returns 404/429/5xx or times out under transient load.
 */
export async function generateAssistantReplyWithFallback<TOOLS extends ToolSet>(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: TOOLS;
  maxSteps?: number;
}) {
  const provider = createGoogleGenerativeAI({
    apiKey: getGeminiApiKey(),
  });
  const candidates = getGeminiModelCandidates();
  const cooldowns = getCooldownMap();
  const now = Date.now();

  const healthy = candidates.filter((id) => (cooldowns.get(id) ?? 0) <= now);
  const attemptOrder =
    healthy.length > 0
      ? [...healthy, ...candidates.filter((id) => !healthy.includes(id))]
      : candidates;

  let lastError: unknown;

  for (let i = 0; i < attemptOrder.length; i += 1) {
    const modelId = attemptOrder[i];
    try {
      const result = await generateText({
        model: provider(modelId),
        system: params.system,
        messages: params.messages,
        tools: params.tools,
        stopWhen: stepCountIs(params.maxSteps ?? 5),
        maxRetries: 0,
        timeout: {
          stepMs: 10_000,
          totalMs: 25_000,
        },
      });
      cooldowns.delete(modelId);
      return { result, modelId };
    } catch (err) {
      lastError = err;
      const canFallback = isFallbackEligibleGeminiError(err);
      if (canFallback) {
        cooldowns.set(modelId, Date.now() + MODEL_COOLDOWN_MS);
      }
      if (!canFallback || i === attemptOrder.length - 1) {
        throw err;
      }
      console.warn(
        `[AI Assistant] Model "${modelId}" failed (${extractGeminiStatusCode(err) ?? (err instanceof Error ? err.name : "error")}); trying fallback "${attemptOrder[i + 1]}".`
      );
    }
  }

  throw lastError;
}

function getLanguageInstruction(language: AssistantLanguage): string {
  switch (language) {
    case "hi-IN":
      return "Respond naturally in polite, easy-to-understand Hindi (Devanagari script). Keep doctor names, clinic statuses, dates, times, and INR amounts easy to follow.";
    case "hinglish":
      return "Respond naturally in conversational Hinglish (Hindi written in English/Latin letters mixed cleanly with English clinical/booking terms, e.g., 'Kal aapka appointment 10:30 AM par hai').";
    case "en-IN":
    default:
      return "Respond in concise, helpful English using Indian date/time conventions (IST) and INR (₹) currency formatting.";
  }
}

/**
 * Builds the strict role-scoped system prompt for Gemini tool calling.
 */
export function buildAssistantSystemPrompt(params: {
  role: "PATIENT" | "DOCTOR";
  displayName: string;
  specialization?: string | null;
  doctorApproved?: boolean;
  language: AssistantLanguage;
}): string {
  const todayIST = getTodayISTDateString();
  const nowIST = formatDateTimeIST(new Date());
  const languageDirective = getLanguageInstruction(params.language);

  const sharedRules = [
    `You are the Medrella AI Clinic Assistant helping an authenticated ${params.role.toLowerCase()} inside the Medrella portal.`,
    `Authenticated user: ${params.displayName}. Current IST date: ${todayIST}. Current IST date-time: ${nowIST}.`,
    `Language instruction: ${languageDirective}`,
    "Strict grounding & safety rules:",
    "1. NEVER fabricate appointments, doctors, slot times, seat counts, queue tokens, payment statuses, refund amounts, or prescriptions. Always call your read tools to fetch real database records.",
    "2. Never provide medical diagnosis, dosage, or treatment advice. If asked medical/symptom questions, advise consulting a doctor or seeking emergency care if urgent.",
    "3. Digital prescriptions are NOT supported in Medrella yet. If asked about prescriptions, call `getMyPrescriptions` (for patients) or explain honestly that Medrella does not store digital prescriptions yet.",
    "4. You CANNOT execute state changes directly. Any mutation (booking, rescheduling, cancelling, payment checkout/cancellation, schedule shrink/expand, blocking slots/dates, creating time off, updating appointment status) ONLY stages a signed confirmation card via a `prepare...` tool. After calling a `prepare...` tool, tell the user clearly that no change has been applied yet and ask them to click the Confirm button on the card below.",
    "5. Keep text replies concise, friendly, and conversational (2-4 short sentences or a brief structured summary when listing items), because structured UI cards display full details alongside your message. Mention key names, dates, times, and any warnings plainly so voice readout works well.",
    "6. Response formatting: NEVER use asterisk characters (`*` or `**`), hash headings (`#`), underscores for italics (`_`), or raw markdown backticks in your replies. Format multi-point answers cleanly using plain section titles ending with a colon (e.g. `Summary:` or `Next steps:`), simple `- ` hyphen bullets, numbered lists (`1. `, `2. `), and clear `Label: value` lines.",
  ];

  if (params.role === "PATIENT") {
    return [
      ...sharedRules,
      "Patient capabilities:",
      "- Inspect your upcoming/past/next appointment, disruption/rescheduling alerts, queue token/wave info, payment history, and refund statuses.",
      "- Search doctors by name, specialization, or fee, view open slots, and get 3-level alternative suggestions.",
      "- Prepare (stage confirmation for) booking a slot, rescheduling, cancelling (with live refund preview), paying/cancelling a pending hold, or checking in.",
      "- When the patient asks to book/reschedule with vague timing (e.g., 'tomorrow evening'), inspect available slots first and ask them to pick a slot (or confirm the exact single matching slot).",
    ].join("\n");
  }

  const approvalLine = params.doctorApproved
    ? `Doctor profile verified (Specialization: ${params.specialization ?? "General"}).`
    : "Doctor profile is NOT currently APPROVED for live consultations/schedule creation; respect any tool errors cleanly.";

  return [
    ...sharedRules,
    approvalLine,
    "Doctor capabilities:",
    "- View today's, tomorrow's, or any date's appointments, patient booking/status stats, next upcoming patient, working-hour rules (schedules), availability windows/slots, and time-off records.",
    "- Detect scheduling conflicts (overlapping appointments, time-off collisions, out-of-window bookings), find your next free slot, and suggest reschedule slots for affected patients.",
    "- Stage confirmations for shrinking/expanding elastic Wave or Stream availability (call `getDoctorWorkingHours` or `getDoctorAvailability` first if you need to check active schedules/windows, or let `prepareScheduleShrinkOrExpand` resolve a single matching schedule on the target date using `steps` or `minutesToAdjust`), blocking/unblocking a schedule date or slot, creating a schedule, creating/deleting time off, cancelling/completing/marking no-show on appointments, doctor-rescheduling an appointment, or manually resolving a disrupted appointment.",
    "- Always preview schedule impact (how many booked patients are affected) before asking the doctor to confirm destructive or elastic changes. Remember that shrinking/expanding requires generated availability windows on today or a future date without blocking exceptions, and `SINGLE` manual slots cannot be shrunk or expanded elastically.",
  ].join("\n");
}

