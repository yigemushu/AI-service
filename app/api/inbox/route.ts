import { NextRequest, NextResponse } from "next/server";
import { addServerInboxMessage, deleteServerInboxCustomer, getServerInboxMessages } from "@/lib/serverInbox";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

function logInbox(event: "start" | "success" | "fail", detail: Record<string, unknown>) {
  console.info(`[inbox:${event}]`, detail);
}

function safeBodySummary(body: unknown) {
  if (!body || typeof body !== "object") return {};
  const payload = body as { platform?: unknown; businessType?: unknown; text?: unknown; rawMessage?: unknown; sourceUrl?: unknown };
  const text = typeof payload.text === "string" ? payload.text : typeof payload.rawMessage === "string" ? payload.rawMessage : "";
  return {
    platform: typeof payload.platform === "string" ? payload.platform : "",
    businessType: typeof payload.businessType === "string" ? payload.businessType : "",
    textLength: text.length,
    hasSourceUrl: typeof payload.sourceUrl === "string" && payload.sourceUrl.length > 0,
  };
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) {
    logInbox("fail", { requestId, method: "GET", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", hasEnvToken: auth.hasEnvToken, hasSettingsToken: auth.hasSettingsToken, receivedToken: auth.receivedToken, tokenSource: auth.tokenSource });
    return auth.response;
  }
  const messages = await getServerInboxMessages();
  logInbox("success", { requestId, method: "GET", count: messages.length });
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const authDebug = await getWebhookAuthDebug(request, bodyToken);
    logInbox("start", { requestId, method: "POST", ...safeBodySummary(body), ...authDebug });
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) {
      logInbox("fail", { requestId, method: "POST", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...authDebug });
      return auth.response;
    }
    const message = await addServerInboxMessage(body);
    logInbox("success", { requestId, method: "POST", messageId: message.id });
    return NextResponse.json({ ok: true, message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid inbox payload";
    logInbox("fail", { requestId, method: "POST", reason: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const authDebug = await getWebhookAuthDebug(request);
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) {
    logInbox("fail", { method: "DELETE", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...authDebug });
    return auth.response;
  }
  try {
    const body = await request.json();
    const result = await deleteServerInboxCustomer(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid inbox delete payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
