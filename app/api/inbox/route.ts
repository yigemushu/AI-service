import { NextRequest, NextResponse } from "next/server";
import { addServerInboxMessage, getServerInboxMessages } from "@/lib/serverInbox";

export const runtime = "nodejs";

function readBodyToken(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const token = (body as { webhookToken?: unknown }).webhookToken;
  return typeof token === "string" ? token : "";
}

function isAuthorized(request: NextRequest, bodyToken = "") {
  const token = process.env.INBOX_WEBHOOK_TOKEN;
  if (!token) return false;
  const authHeader = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-inbox-token") || "";
  return authHeader === `Bearer ${token}` || headerToken === token || bodyToken === token;
}

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
  if (!process.env.INBOX_WEBHOOK_TOKEN) {
    logInbox("fail", { requestId, method: "GET", reason: "token_not_configured" });
    return NextResponse.json({ error: "Inbox webhook token is not configured" }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    logInbox("fail", { requestId, method: "GET", reason: "unauthorized" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const messages = await getServerInboxMessages();
  logInbox("success", { requestId, method: "GET", count: messages.length });
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json();
    const bodyToken = readBodyToken(body);
    logInbox("start", { requestId, method: "POST", ...safeBodySummary(body), hasToken: Boolean(bodyToken || request.headers.get("authorization") || request.headers.get("x-inbox-token")) });
    if (!process.env.INBOX_WEBHOOK_TOKEN) {
      logInbox("fail", { requestId, method: "POST", reason: "token_not_configured" });
      return NextResponse.json({ error: "Inbox webhook token is not configured" }, { status: 503 });
    }
    if (!isAuthorized(request, bodyToken)) {
      logInbox("fail", { requestId, method: "POST", reason: "unauthorized" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
