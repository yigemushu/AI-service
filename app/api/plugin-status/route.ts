import { NextRequest, NextResponse } from "next/server";
import { addBrowserPluginStatus, getBrowserPluginStatuses } from "@/lib/serverPluginStatus";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";
import type { BrowserPluginStatusKind } from "@/lib/types";

export const runtime = "nodejs";

function normalizeKind(value: string | null): BrowserPluginStatusKind | undefined {
  if (value === "config" || value === "autoSync" || value === "outbound") return value;
  return undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) {
    const debug = await getWebhookAuthDebug(request);
    console.info("[plugin-status:get] rejected", { reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch", ...debug });
    return auth.response;
  }
  const url = new URL(request.url);
  const statuses = await getBrowserPluginStatuses({
    kind: normalizeKind(url.searchParams.get("kind")),
    platform: url.searchParams.get("platform") || undefined,
  });
  return NextResponse.json({ statuses });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) return auth.response;
    const status = await addBrowserPluginStatus(body);
    return NextResponse.json({ ok: true, status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid plugin status payload";
    console.info("[plugin-status:post] failed", { message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
