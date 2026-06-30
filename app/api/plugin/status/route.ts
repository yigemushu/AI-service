import { NextResponse } from "next/server";
import { isPluginOnline, readPluginHeartbeat } from "@/lib/serverPluginHeartbeat";

export const runtime = "nodejs";

export async function GET() {
  const status = await readPluginHeartbeat();
  return NextResponse.json({
    ok: true,
    status,
    online: isPluginOnline(status),
    offlineAfterMs: 120_000,
  });
}
