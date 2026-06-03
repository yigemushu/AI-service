import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "ai-service-workbench",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
