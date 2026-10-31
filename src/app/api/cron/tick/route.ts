import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getCronSecret } from "@/lib/env";
import { runMaintenance } from "@/lib/maintenance";

export const runtime = "nodejs";

function verifyCronAuth(req: NextRequest): boolean {
  try {
    const configuredSecret = getCronSecret();
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const providedToken = authHeader.substring(7).trim();
    const tokenBuffer = Buffer.from(providedToken, "utf8");
    const secretBuffer = Buffer.from(configuredSecret, "utf8");

    if (tokenBuffer.length !== secretBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(tokenBuffer, secretBuffer);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized cron tick" }, { status: 401 });
  }

  const result = await runMaintenance();
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized cron tick" }, { status: 401 });
  }

  const result = await runMaintenance();
  return NextResponse.json(result, { status: 200 });
}
