import { NextRequest, NextResponse } from "next/server";
import { readInboxLogs } from "@/lib/serverInboxLogs";
import { requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) return auth.response;
  const logs = await readInboxLogs().catch(() => []);
  return NextResponse.json({ logs });
}
