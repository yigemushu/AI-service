import { NextRequest, NextResponse } from "next/server";
import { getEffectiveInboxWebhookToken, readStoredAppSettings, saveStoredAppSettings } from "@/lib/server/appSettings";

export const runtime = "nodejs";

function readToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getSiteOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const host = request.headers.get("host") || "";
  if (!host) return "";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  try {
    const config = await getEffectiveInboxWebhookToken();
    return NextResponse.json({
      siteOrigin: getSiteOrigin(request),
      inboxWebhookToken: config.token,
      tokenSource: config.tokenSource,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read settings";
    return NextResponse.json({ siteOrigin: getSiteOrigin(request), inboxWebhookToken: "", tokenSource: "none", error: message }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { inboxWebhookToken?: unknown };
    const inboxWebhookToken = readToken(body.inboxWebhookToken);
    if (inboxWebhookToken && inboxWebhookToken.length < 8) {
      return NextResponse.json({ error: "Webhook Token must be at least 8 characters" }, { status: 400 });
    }
    const envToken = readToken(process.env.INBOX_WEBHOOK_TOKEN);
    if (envToken) {
      return NextResponse.json({
        ok: true,
        inboxWebhookToken: envToken,
        savedSettingsToken: "",
        tokenSource: "env",
        warning: "Token is controlled by INBOX_WEBHOOK_TOKEN. Settings page cannot override env.",
      });
    }

    const stored = await saveStoredAppSettings({ inboxWebhookToken });
    return NextResponse.json({
      ok: true,
      inboxWebhookToken: readToken(stored.inboxWebhookToken),
      savedSettingsToken: readToken(stored.inboxWebhookToken),
      tokenSource: stored.inboxWebhookToken ? "settings" : "none",
      warning: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid settings payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const current = await readStoredAppSettings();
  await saveStoredAppSettings({ ...current, inboxWebhookToken: "" });
  const config = await getEffectiveInboxWebhookToken();
  return NextResponse.json({ ok: true, inboxWebhookToken: config.token, tokenSource: config.tokenSource });
}
