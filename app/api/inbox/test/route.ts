import { NextRequest, NextResponse } from "next/server";
import { readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bodyToken = readBodyWebhookToken(body);
  const auth = await requireWebhookAuth(request, bodyToken);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    ok: true,
    message: "Webhook token valid",
    tokenSource: auth.tokenSource,
  });
}
