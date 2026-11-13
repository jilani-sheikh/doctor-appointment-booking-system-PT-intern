import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import { getCurrentUser, isProfileComplete } from "@/lib/auth";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";
import { executeConfirmedAction } from "@/lib/ai/confirmation";
import { confirmRequestSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Please sign in before confirming this action.",
          error: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (
      !isProfileComplete(user) ||
      (user.role !== Role.PATIENT && user.role !== Role.DOCTOR)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not authorized to perform this action.",
          error: "Forbidden",
        },
        { status: 403 }
      );
    }

    const limit = checkAiRateLimit("confirm", user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Too many confirmation attempts. Please wait a moment.",
          error: "Rate limited",
        },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON payload.", error: "Bad request" },
        { status: 400 }
      );
    }

    const parsed = confirmRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing or malformed confirmation token.",
          error: "Bad request",
        },
        { status: 400 }
      );
    }

    const result = await executeConfirmedAction({
      token: parsed.data.token,
      user: {
        id: user.id,
        role: user.role === Role.PATIENT ? "PATIENT" : "DOCTOR",
      },
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[AI Assistant Confirm Error]", err);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to process confirmation. Please try again.",
        error: "Internal error",
      },
      { status: 500 }
    );
  }
}

