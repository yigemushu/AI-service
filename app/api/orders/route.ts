import { NextRequest, NextResponse } from "next/server";
import { addServerOrder, getServerOrders } from "@/lib/serverOrders";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireWebhookAuth(request, "", "Inbox webhook token is not configured");
  if (!auth.ok) {
    console.info("[orders:get] rejected", { requestId, reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", hasEnvToken: auth.hasEnvToken, hasSettingsToken: auth.hasSettingsToken, receivedToken: auth.receivedToken, tokenSource: auth.tokenSource });
    return auth.response;
  }
  const orders = await getServerOrders();
  return NextResponse.json({ orders });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const authDebug = await getWebhookAuthDebug(request, bodyToken);
    const auth = await requireWebhookAuth(request, bodyToken, "Inbox webhook token is not configured");
    if (!auth.ok) {
      console.info("[orders:post] rejected", { requestId, reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...authDebug });
      return auth.response;
    }
    const result = await addServerOrder(body);
    console.info("[orders:post] saved", { requestId, orderId: result.order.id, duplicate: result.duplicate });
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid order payload";
    console.info("[orders:post] failed", { requestId, message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
