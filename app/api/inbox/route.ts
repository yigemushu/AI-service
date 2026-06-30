import { NextRequest, NextResponse } from "next/server";
import { addServerInboxMessage, deleteServerInboxCustomer, getServerInboxMessages } from "@/lib/serverInbox";
import { convertLegacyMessagesToConversations, readInboxConversations, upsertInboxConversationFromPayload } from "@/lib/serverInboxConversations";
import { appendInboxLog } from "@/lib/serverInboxLogs";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

function logInbox(event: "start" | "success" | "fail", detail: Record<string, unknown>) {
  console.info(`[inbox:${event}]`, detail);
}

function safeBodySummary(body: unknown) {
  if (!body || typeof body !== "object") return {};
  const payload = body as { platform?: unknown; businessType?: unknown; text?: unknown; rawMessage?: unknown; messageText?: unknown; sourceUrl?: unknown };
  const text = typeof payload.messageText === "string" ? payload.messageText : typeof payload.text === "string" ? payload.text : typeof payload.rawMessage === "string" ? payload.rawMessage : "";
  return {
    platform: typeof payload.platform === "string" ? payload.platform : "",
    businessType: typeof payload.businessType === "string" ? payload.businessType : "",
    textLength: text.length,
    hasSourceUrl: typeof payload.sourceUrl === "string" && payload.sourceUrl.length > 0,
  };
}

function inboxLogPayload(body: unknown) {
  if (!body || typeof body !== "object") return { platform: "", customerName: "", messageSummary: "" };
  const payload = body as { platform?: unknown; customerName?: unknown; customerFolder?: unknown; text?: unknown; rawMessage?: unknown; messageText?: unknown };
  const text = typeof payload.messageText === "string" ? payload.messageText : typeof payload.text === "string" ? payload.text : typeof payload.rawMessage === "string" ? payload.rawMessage : "";
  return {
    platform: typeof payload.platform === "string" ? payload.platform : "",
    customerName: typeof payload.customerName === "string" && payload.customerName.trim() ? payload.customerName : typeof payload.customerFolder === "string" ? payload.customerFolder : "",
    messageSummary: text.slice(0, 120),
  };
}

function withLegacyMessageFields(body: unknown): Parameters<typeof addServerInboxMessage>[0] {
  if (!body || typeof body !== "object") return {};
  const payload = body as { rawMessage?: unknown; text?: unknown; messageText?: unknown };
  const messageText = typeof payload.messageText === "string" ? payload.messageText : "";
  return {
    ...payload,
    rawMessage: typeof payload.rawMessage === "string" && payload.rawMessage.trim() ? payload.rawMessage : messageText,
    text: typeof payload.text === "string" && payload.text.trim() ? payload.text : messageText,
  };
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) {
    logInbox("fail", { requestId, method: "GET", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", hasEnvToken: auth.hasEnvToken, hasSettingsToken: auth.hasSettingsToken, receivedToken: auth.receivedToken, tokenSource: auth.tokenSource });
    return auth.response;
  }
  try {
    const messages = await getServerInboxMessages();
    const storedConversations = await readInboxConversations();
    const conversations = storedConversations.length ? storedConversations : convertLegacyMessagesToConversations(messages);
    logInbox("success", { requestId, method: "GET", count: messages.length, conversationCount: conversations.length });
    return NextResponse.json({ conversations, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read inbox data";
    logInbox("fail", { requestId, method: "GET", reason: message });
    return NextResponse.json({ conversations: [], messages: [], warning: message });
  }
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
      await appendInboxLog({ ...inboxLogPayload(body), conversationId: "", duplicated: false, status: "failed", httpStatus: auth.response.status, error: auth.response.status === 503 ? "token_not_configured" : "token_mismatch" }).catch(() => undefined);
      return auth.response;
    }
    const result = await upsertInboxConversationFromPayload(body);
    const message = result.duplicated ? null : await addServerInboxMessage(withLegacyMessageFields(body));
    logInbox("success", { requestId, method: "POST", conversationId: result.conversationId, duplicated: result.duplicated, messageId: message?.id || "" });
    await appendInboxLog({ ...inboxLogPayload(body), conversationId: result.conversationId, duplicated: result.duplicated, status: "success", httpStatus: result.duplicated ? 200 : 201 }).catch(() => undefined);
    return NextResponse.json({
      ok: true,
      conversationId: result.conversationId,
      conversation: result.conversation,
      message,
      duplicated: result.duplicated,
    }, { status: result.duplicated ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid inbox payload";
    logInbox("fail", { requestId, method: "POST", reason: message });
    await appendInboxLog({ platform: "", customerName: "", messageSummary: "", conversationId: "", duplicated: false, status: "failed", httpStatus: 400, error: message }).catch(() => undefined);
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
