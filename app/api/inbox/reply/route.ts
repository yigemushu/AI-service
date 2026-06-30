import { NextRequest, NextResponse } from "next/server";
import { appendInboxConversationMessage } from "@/lib/serverInboxConversations";
import { readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";
import type { InboxMessage } from "@/lib/types";

export const runtime = "nodejs";

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): InboxMessage["role"] {
  const text = safeString(value);
  if (text === "seller_note") return "seller_note";
  if (text === "customer") return "customer";
  return "assistant";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) return auth.response;
    const conversationId = safeString(body.conversationId);
    if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    const result = await appendInboxConversationMessage({
      conversationId,
      role: normalizeRole(body.role),
      content: safeString(body.content) || safeString(body.reply),
      sourceUrl: safeString(body.sourceUrl),
      externalMessageId: safeString(body.externalMessageId),
      createdAt: safeString(body.createdAt),
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicated ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid inbox reply payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
