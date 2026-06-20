import { NextRequest, NextResponse } from "next/server";
import { requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, service: "ai-service-inbox", token: "valid", tokenSource: auth.tokenSource });
}
