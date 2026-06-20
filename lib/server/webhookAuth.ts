import { NextRequest, NextResponse } from "next/server";
import { getEffectiveInboxWebhookToken, type TokenSource } from "./appSettings";

export type WebhookAuthResult =
  | { ok: true; tokenSource: TokenSource; hasEnvToken: boolean; hasSettingsToken: boolean; receivedToken: boolean }
  | { ok: false; response: NextResponse; tokenSource: TokenSource; hasEnvToken: boolean; hasSettingsToken: boolean; receivedToken: boolean };

function cleanToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readBodyWebhookToken(body: unknown) {
  if (!body || typeof body !== "object") return "";
  return cleanToken((body as { webhookToken?: unknown }).webhookToken);
}

export function readRequestWebhookToken(request: NextRequest, bodyToken = "") {
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
  return cleanToken(bodyToken) || cleanToken(request.headers.get("x-webhook-token")) || cleanToken(request.headers.get("x-inbox-token")) || cleanToken(bearerToken);
}

export async function getWebhookAuthDebug(request: NextRequest, bodyToken = "") {
  const config = await getEffectiveInboxWebhookToken();
  return {
    hasEnvToken: config.tokenSource === "env",
    hasSettingsToken: config.hasSettingsToken,
    receivedToken: Boolean(readRequestWebhookToken(request, bodyToken)),
    tokenSource: config.tokenSource,
  };
}

export async function requireWebhookAuth(request: NextRequest, bodyToken = "", notConfiguredMessage = "Inbox webhook token is not configured"): Promise<WebhookAuthResult> {
  const config = await getEffectiveInboxWebhookToken();
  const receivedToken = readRequestWebhookToken(request, bodyToken);
  const base = {
    tokenSource: config.tokenSource,
    hasEnvToken: config.tokenSource === "env",
    hasSettingsToken: config.hasSettingsToken,
    receivedToken: Boolean(receivedToken),
  };

  if (!config.token) {
    return {
      ok: false,
      ...base,
      response: NextResponse.json({ ok: false, error: notConfiguredMessage, tokenSource: config.tokenSource }, { status: 503 }),
    };
  }

  if (receivedToken !== config.token) {
    return {
      ok: false,
      ...base,
      response: NextResponse.json({ ok: false, error: "Webhook token mismatch", tokenSource: config.tokenSource }, { status: 401 }),
    };
  }

  return { ok: true, ...base };
}
