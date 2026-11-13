import "server-only";
import { AiConfirmationStatus, type Prisma, Role } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildChatSessionTitle } from "@/lib/ai/helpers";
import { stripMarkdownAsterisks } from "@/lib/ai/format-text";
import type {
  AssistantCard,
  ChatSessionSummary,
  PendingConfirmation,
  PersistedChatMessageItem,
} from "@/lib/ai/schemas";

export interface SaveChatExchangeInput {
  userId: string;
  role: Role;
  sessionId?: string;
  userContent: string;
  assistantContent: string;
  cards: AssistantCard[];
  confirmations: PendingConfirmation[];
}

export async function saveChatExchange(
  input: SaveChatExchangeInput
): Promise<string> {
  const now = new Date();
  const assistantCreatedAt = new Date(now.getTime() + 1);
  const title = stripMarkdownAsterisks(buildChatSessionTitle(input.userContent));

  return db.$transaction(async (tx) => {
    let targetSessionId: string | null = null;

    if (input.sessionId) {
      const existing = await tx.aiChatSession.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          role: input.role,
        },
        select: { id: true },
      });
      if (existing) {
        targetSessionId = existing.id;
      }
    }

    if (!targetSessionId) {
      const created = await tx.aiChatSession.create({
        data: {
          userId: input.userId,
          role: input.role,
          title,
        },
        select: { id: true },
      });
      targetSessionId = created.id;
    }

    await tx.aiChatMessage.createMany({
      data: [
        {
          sessionId: targetSessionId,
          role: "user",
          content: input.userContent,
          createdAt: now,
        },
        {
          sessionId: targetSessionId,
          role: "assistant",
          content: input.assistantContent,
          cards:
            input.cards.length > 0
              ? (input.cards as unknown as Prisma.InputJsonValue)
              : undefined,
          confirmations:
            input.confirmations.length > 0
              ? (input.confirmations as unknown as Prisma.InputJsonValue)
              : undefined,
          createdAt: assistantCreatedAt,
        },
      ],
    });

    await tx.aiChatSession.update({
      where: { id: targetSessionId },
      data: { updatedAt: assistantCreatedAt },
    });

    return targetSessionId;
  });
}

export async function listChatSessions(
  userId: string,
  role: Role,
  limit = 30
): Promise<ChatSessionSummary[]> {
  const sessions = await db.aiChatSession.findMany({
    where: { userId, role },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { messages: true },
      },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          content: true,
        },
      },
    },
  });

  return sessions.map((session) => {
    const rawPreview = session.messages[0]?.content ?? "";
    const cleanedPreview = stripMarkdownAsterisks(rawPreview)
      .replace(/\s+/g, " ")
      .trim();
    const lastMessagePreview =
      cleanedPreview.length > 90
        ? `${cleanedPreview.slice(0, 87).trimEnd()}...`
        : cleanedPreview;

    return {
      id: session.id,
      title: stripMarkdownAsterisks(session.title) || "Conversation",
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: session._count.messages,
      lastMessagePreview,
    };
  });
}

function hydrateConfirmations(
  rawConfirmations: unknown,
  statusMap: Map<
    string,
    { status: AiConfirmationStatus; error: string | null; expiresAt: Date }
  >,
  nowMs: number
): PendingConfirmation[] {
  if (!Array.isArray(rawConfirmations)) {
    return [];
  }

  return rawConfirmations
    .filter((item): item is PendingConfirmation => Boolean(item && typeof item === "object"))
    .map((conf) => {
      const record = statusMap.get(conf.confirmationId);
      if (!record) {
        return {
          ...conf,
          settledStatus: "expired" as const,
          settledMessage: "This confirmation is no longer available.",
        };
      }
      if (record.status === AiConfirmationStatus.EXECUTED) {
        return {
          ...conf,
          settledStatus: "confirmed" as const,
          settledMessage: "Action completed.",
        };
      }
      if (record.status === AiConfirmationStatus.CONSUMING) {
        return {
          ...conf,
          settledStatus: "confirmed" as const,
          settledMessage: "Action processed.",
        };
      }
      if (record.status === AiConfirmationStatus.FAILED) {
        return {
          ...conf,
          settledStatus: "failed" as const,
          settledMessage: record.error || "Cancelled or failed.",
        };
      }
      if (record.expiresAt.getTime() <= nowMs) {
        return {
          ...conf,
          settledStatus: "expired" as const,
          settledMessage:
            "This confirmation expired. Ask the assistant again if you still want to proceed.",
        };
      }
      return conf;
    });
}

export async function getChatSessionWithMessages(
  userId: string,
  role: Role,
  sessionId: string
): Promise<{
  session: ChatSessionSummary;
  messages: PersistedChatMessageItem[];
} | null> {
  const session = await db.aiChatSession.findFirst({
    where: {
      id: sessionId,
      userId,
      role,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          role: true,
          content: true,
          cards: true,
          confirmations: true,
          isError: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const confirmationIds = new Set<string>();
  for (const msg of session.messages) {
    if (Array.isArray(msg.confirmations)) {
      for (const item of msg.confirmations) {
        if (
          item &&
          typeof item === "object" &&
          "confirmationId" in item &&
          typeof (item as { confirmationId?: unknown }).confirmationId === "string"
        ) {
          confirmationIds.add((item as { confirmationId: string }).confirmationId);
        }
      }
    }
  }

  const confirmationRows =
    confirmationIds.size > 0
      ? await db.aiConfirmation.findMany({
          where: {
            id: { in: Array.from(confirmationIds) },
            userId,
            role,
          },
          select: {
            id: true,
            status: true,
            error: true,
            expiresAt: true,
          },
        })
      : [];

  const statusMap = new Map(
    confirmationRows.map((row) => [
      row.id,
      {
        status: row.status,
        error: row.error,
        expiresAt: row.expiresAt,
      },
    ])
  );
  const nowMs = Date.now();

  const messages: PersistedChatMessageItem[] = session.messages.map((msg) => ({
    id: msg.id,
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content,
    cards: Array.isArray(msg.cards) ? (msg.cards as unknown as AssistantCard[]) : [],
    confirmations: hydrateConfirmations(msg.confirmations, statusMap, nowMs),
    isError: msg.isError,
    createdAt: msg.createdAt.toISOString(),
  }));

  const lastMessage = messages[messages.length - 1];
  const rawPreview = lastMessage
    ? stripMarkdownAsterisks(lastMessage.content).replace(/\s+/g, " ").trim()
    : "";
  const lastMessagePreview =
    rawPreview.length > 90
      ? `${rawPreview.slice(0, 87).trimEnd()}...`
      : rawPreview;

  return {
    session: {
      id: session.id,
      title: stripMarkdownAsterisks(session.title) || "Conversation",
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: messages.length,
      lastMessagePreview,
    },
    messages,
  };
}

export async function deleteChatSession(
  userId: string,
  role: Role,
  sessionId: string
): Promise<boolean> {
  const result = await db.aiChatSession.deleteMany({
    where: {
      id: sessionId,
      userId,
      role,
    },
  });
  return result.count > 0;
}

export async function deleteAllChatHistory(
  userId: string,
  role: Role
): Promise<number> {
  const result = await db.aiChatSession.deleteMany({
    where: {
      userId,
      role,
    },
  });
  return result.count;
}

