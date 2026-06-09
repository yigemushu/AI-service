import { NextRequest, NextResponse } from "next/server";
import { addServerInboxMessage, getServerInboxMessages } from "@/lib/serverInbox";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const token = process.env.INBOX_WEBHOOK_TOKEN;
  if (!token) return true;
  const authHeader = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-inbox-token") || "";
  return authHeader === `Bearer ${token}` || headerToken === token;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const messages = await getServerInboxMessages();
  return NextResponse.json({ messages });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const message = await addServerInboxMessage(body);
    return NextResponse.json({ ok: true, message }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid inbox payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
