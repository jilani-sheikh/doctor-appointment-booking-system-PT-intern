import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import { getCurrentUser, isProfileComplete } from "@/lib/auth";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import {
  deleteAllChatHistory,
  deleteChatSession,
  getChatSessionWithMessages,
  listChatSessions,
} from "@/lib/ai/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authenticateHistoryRequest() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: "Please sign in to access your AI Assistant history." },
        { status: 401 }
      ),
    };
  }

  if (
    !isProfileComplete(user) ||
    (user.role !== Role.PATIENT && user.role !== Role.DOCTOR)
  ) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            "AI Assistant history is available for completed Patient and Doctor accounts only.",
        },
        { status: 403 }
      ),
    };
  }

  const verifiedRole: Role =
    user.role === Role.PATIENT ? Role.PATIENT : Role.DOCTOR;

  const limit = checkAiRateLimit("history", user.id);
  if (!limit.allowed) {
    return {
      errorResponse: NextResponse.json(
        { error: "Too many history requests. Please wait a moment and try again." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      ),
    };
  }

  return { user, role: verifiedRole };
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateHistoryRequest();
    if ("errorResponse" in auth) {
      return auth.errorResponse;
    }
    const { user, role } = auth;

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId")?.trim();

    if (sessionId) {
      if (sessionId.length > 120) {
        return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
      }
      const detail = await getChatSessionWithMessages(
        user.id,
        role,
        sessionId
      );
      if (!detail) {
        return NextResponse.json(
          { error: "Conversation not found." },
          { status: 404 }
        );
      }
      return NextResponse.json(detail);
    }

    const sessions = await listChatSessions(user.id, role);
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error("[AI Assistant History GET Error]", err);
    return NextResponse.json(
      { error: "Unable to load chat history right now." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await authenticateHistoryRequest();
    if ("errorResponse" in auth) {
      return auth.errorResponse;
    }
    const { user, role } = auth;

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId")?.trim();

    if (sessionId) {
      if (sessionId.length > 120) {
        return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
      }
      const deleted = await deleteChatSession(user.id, role, sessionId);
      if (!deleted) {
        return NextResponse.json(
          { error: "Conversation not found." },
          { status: 404 }
        );
      }
      return NextResponse.json({ deleted: true, sessionId });
    }

    const deletedCount = await deleteAllChatHistory(user.id, role);
    return NextResponse.json({ deletedAll: true, deletedCount });
  } catch (err) {
    console.error("[AI Assistant History DELETE Error]", err);
    return NextResponse.json(
      { error: "Unable to delete chat history right now." },
      { status: 500 }
    );
  }
}
