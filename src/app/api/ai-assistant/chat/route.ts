import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import { getCurrentUser, isProfileComplete } from "@/lib/auth";
import { isGeminiConfigured } from "@/lib/env";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { extractGeminiStatusCode } from "@/lib/ai/helpers";
import { saveChatExchange } from "@/lib/ai/history";
import {
  buildAssistantSystemPrompt,
  generateAssistantReplyWithFallback,
} from "@/lib/ai/model";
import { createPatientTools } from "@/lib/ai/tools/patient-tools";
import { createDoctorTools } from "@/lib/ai/tools/doctor-tools";
import {
  chatRequestSchema,
  type AssistantCard,
  type ChatResponsePayload,
  type PendingConfirmation,
} from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractArtifactsFromSteps(
  steps: Array<{ toolResults: Array<{ output?: unknown }> }>
): { cards: AssistantCard[]; confirmations: PendingConfirmation[] } {
  const cards: AssistantCard[] = [];
  const confirmations: PendingConfirmation[] = [];
  const seenConfirmationIds = new Set<string>();

  for (const step of steps) {
    for (const toolResult of step.toolResults) {
      const output = toolResult?.output;
      if (!output || typeof output !== "object") {
        continue;
      }
      const record = output as Record<string, unknown>;
      if (record.card && typeof record.card === "object") {
        cards.push(record.card as AssistantCard);
      }
      if (record.confirmation && typeof record.confirmation === "object") {
        const conf = record.confirmation as PendingConfirmation;
        if (conf.confirmationId && !seenConfirmationIds.has(conf.confirmationId)) {
          seenConfirmationIds.add(conf.confirmationId);
          confirmations.push(conf);
        }
      }
    }
  }

  return { cards, confirmations };
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in to use the Medrella AI Assistant." },
        { status: 401 }
      );
    }

    if (
      !isProfileComplete(user) ||
      (user.role !== Role.PATIENT && user.role !== Role.DOCTOR)
    ) {
      return NextResponse.json(
        {
          error:
            "AI Assistant is available for completed Patient and Doctor accounts only.",
        },
        { status: 403 }
      );
    }

    const limit = checkAiRateLimit("chat", user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many assistant requests. Please wait a moment and try again." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      );
    }

    if (!isGeminiConfigured()) {
      return NextResponse.json(
        {
          error:
            "AI Assistant is temporarily unavailable because Gemini API credentials are not configured.",
        },
        { status: 503 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
    }

    const parsed = chatRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid message payload." },
        { status: 400 }
      );
    }

    const { sessionId, messages, language } = parsed.data;
    const lastMessage = messages[messages.length - 1];
    const latestUserContent =
      lastMessage?.role === "user"
        ? lastMessage.content
        : [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    let system: string;
    let tools: ReturnType<typeof createPatientTools> | ReturnType<typeof createDoctorTools>;
    let fallbackConfirmationReply: string;
    let fallbackCardsReply: string;
    let fallbackEmptyReply: string;

    if (user.role === Role.PATIENT) {
      if (!user.patient) {
        return NextResponse.json(
          { error: "Patient profile not found." },
          { status: 403 }
        );
      }
      system = buildAssistantSystemPrompt({
        role: "PATIENT",
        displayName: user.name || "Patient",
        language,
      });
      tools = createPatientTools({
        userId: user.id,
        patientId: user.patient.id,
        patientName: user.name || "Patient",
      });
      fallbackConfirmationReply =
        "Please review the confirmation card below and click Confirm to proceed.";
      fallbackCardsReply = "Here is what I found for your account.";
      fallbackEmptyReply = "How else can I help you today?";
    } else {
      if (!user.doctor) {
        return NextResponse.json(
          { error: "Doctor profile not found." },
          { status: 403 }
        );
      }
      system = buildAssistantSystemPrompt({
        role: "DOCTOR",
        displayName: `Dr. ${user.name || "Doctor"}`,
        specialization: user.doctor.specialization,
        doctorApproved: user.doctor.status === "APPROVED",
        language,
      });
      tools = createDoctorTools({
        userId: user.id,
        doctorId: user.doctor.id,
        doctorName: user.name || "Doctor",
        specialization: user.doctor.specialization,
        consultationFeeRupees: Number(user.doctor.consultationFee),
        doctorStatus: user.doctor.status,
      });
      fallbackConfirmationReply =
        "Please review the confirmation card below before I apply this change.";
      fallbackCardsReply = "Here are the live records from your practice.";
      fallbackEmptyReply = "How can I assist with your schedule or appointments?";
    }

    const { result } = await generateAssistantReplyWithFallback({
      system,
      messages,
      tools,
    });

    const { cards, confirmations } = extractArtifactsFromSteps(result.steps);
    const reply =
      result.text.trim() ||
      (confirmations.length > 0
        ? fallbackConfirmationReply
        : cards.length > 0
          ? fallbackCardsReply
          : fallbackEmptyReply);

    let savedSessionId: string | undefined = sessionId;
    if (latestUserContent) {
      try {
        savedSessionId = await saveChatExchange({
          userId: user.id,
          role: user.role,
          sessionId,
          userContent: latestUserContent,
          assistantContent: reply,
          cards,
          confirmations,
        });
      } catch (historyErr) {
        console.error("[AI Assistant Chat History Save Error]", historyErr);
      }
    }

    const payload: ChatResponsePayload = {
      sessionId: savedSessionId,
      reply,
      cards,
      confirmations,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[AI Assistant Chat Error]", err);
    const upstreamStatus = extractGeminiStatusCode(err);
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return NextResponse.json(
        {
          error:
            "AI Assistant authentication failed. Please verify the configured Gemini API key.",
        },
        { status: 503 }
      );
    }
    if (upstreamStatus === 429) {
      return NextResponse.json(
        {
          error:
            "The AI Assistant is currently busy due to API rate limits. Please wait a moment and try again.",
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      {
        error:
          "Unable to reach the AI Assistant right now. Please try again in a moment.",
      },
      { status: 502 }
    );
  }
}
