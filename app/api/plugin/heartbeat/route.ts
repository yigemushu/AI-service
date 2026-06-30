import { NextRequest, NextResponse } from "next/server";
import { getWebhookAuthDebug, readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";
import { writePluginHeartbeat } from "@/lib/serverPluginHeartbeat";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) {
      const debug = await getWebhookAuthDebug(request, bodyToken);
      console.info("[plugin-heartbeat:post] rejected", {
        reason: auth.response.status === 503 ? "token_not_configured" : "token_mismatch",
        ...debug,
      });
      return auth.response;
    }
    const status = await writePluginHeartbeat(body);
    console.info("[plugin-heartbeat:post] saved", {
      platform: status.platform,
      shopAlias: status.shopAlias,
      pageStatus: status.pageStatus,
      autoSyncEnabled: status.autoSyncEnabled,
    });
    return NextResponse.json({ ok: true, status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid plugin heartbeat payload";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
