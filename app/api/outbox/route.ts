import { NextRequest, NextResponse } from "next/server";
import { getServerInboxMessages, updateServerInboxForOutboundReply } from "@/lib/serverInbox";
import { ensureServerOrderForOutboundReply } from "@/lib/serverOrders";
import { addOutboxCommand, getOutboxCommands, updateOutboxCommand } from "@/lib/serverOutbox";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";
import type { OutboundReplyStatus } from "@/lib/types";

export const runtime = "nodejs";

function normalizeStatus(value: string | null): OutboundReplyStatus | undefined {
  if (value === "pending" || value === "processing" || value === "filled" || value === "sent" || value === "failed" || value === "cancelled") return value;
  return undefined;
}

function logOutbox(event: "success" | "fail", detail: Record<string, unknown>) {
  console.info(`[outbox:${event}]`, detail);
}

export async function GET(request: NextRequest) {
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) {
    const debug = await getWebhookAuthDebug(request);
    logOutbox("fail", { method: "GET", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...debug });
    return auth.response;
  }
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "all" ? undefined : normalizeStatus(statusParam) || "pending";
  const platform = url.searchParams.get("platform") || undefined;
  const commands = await getOutboxCommands({ status, platform });
  logOutbox("success", { method: "GET", status: status || "all", platform: platform || "", count: commands.length });
  return NextResponse.json({ commands });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) {
      const debug = await getWebhookAuthDebug(request, bodyToken);
      logOutbox("fail", { method: "POST", reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...debug });
      return auth.response;
    }
    const sourceMessage = await findSourceMessageForOutbox(body);
    const orderResult = await ensureServerOrderForOutboundReply(body, sourceMessage);
    const command = await addOutboxCommand({ ...body, orderId: body.orderId || orderResult.order?.id || "" });
    const message = await updateServerInboxForOutboundReply({ ...body, orderId: command.orderId, reply: command.reply, status: command.status });
    logOutbox("success", { method: "POST", commandId: command.id, platform: command.platform, orderId: command.orderId || "", orderCreated: Boolean(orderResult.created) });
    return NextResponse.json({ ok: true, command, order: orderResult.order, message, orderCreated: Boolean(orderResult.created) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid outbox payload";
    logOutbox("fail", { method: "POST", reason: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function normalizeComparableUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || "").split("#")[0];
  }
}

async function findSourceMessageForOutbox(body: { messageId?: unknown; sourceUrl?: unknown; customerFolder?: unknown }) {
  const messages = await getServerInboxMessages();
  const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
  if (messageId) {
    const match = messages.find((message) => message.id === messageId);
    if (match) return match;
  }
  const sourceUrl = normalizeComparableUrl(body.sourceUrl);
  if (sourceUrl) {
    const match = messages.find((message) => normalizeComparableUrl(message.sourceUrl) === sourceUrl);
    if (match) return match;
  }
  const customerFolder = typeof body.customerFolder === "string" ? body.customerFolder.trim().toLowerCase() : "";
  if (customerFolder) {
    return messages.find((message) => String(message.customerFolder || "").trim().toLowerCase() === customerFolder);
  }
  return undefined;
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) return auth.response;
    const command = await updateOutboxCommand(body);
    const message = await updateServerInboxForOutboundReply({ ...command, status: command.status });
    return NextResponse.json({ ok: true, command, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid outbox update payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
