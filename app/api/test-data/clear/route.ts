import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

const dataFiles = [
  "inbox-messages.json",
  "inbox-conversations.json",
  "inbox-logs.json",
  "orders.json",
  "plugin-status.json",
  "browser-plugin-status.json",
  "outbox-commands.json",
  "xianyu-verification-records.json",
];

export async function POST(request: NextRequest) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const bodyToken = readBodyWebhookToken(body);
  const auth = await requireWebhookAuth(request, bodyToken);
  if (!auth.ok) {
    const debug = await getWebhookAuthDebug(request, bodyToken);
    console.info("[test-data-clear] rejected", {
      reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch",
      ...debug,
    });
    return auth.response;
  }

  const dataDir = path.join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  await Promise.all(dataFiles.map((fileName) => writeFile(path.join(dataDir, fileName), "[]", "utf8")));
  await writeFile(path.join(dataDir, "plugin-status.json"), "null", "utf8");

  return NextResponse.json({
    ok: true,
    cleared: dataFiles,
  });
}
