import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getEnvToken() {
  return (process.env.INBOX_WEBHOOK_TOKEN || "").trim();
}

function readToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-inbox-token") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : headerToken;
}

export async function GET(request: NextRequest) {
  const configuredToken = getEnvToken();
  if (!configuredToken) {
    return NextResponse.json({ ok: false, error: "Inbox webhook token is not configured" }, { status: 503 });
  }

  if (readToken(request) !== configuredToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, service: "ai-service-inbox", token: "valid" });
}
