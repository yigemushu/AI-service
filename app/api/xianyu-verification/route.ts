import { NextRequest, NextResponse } from "next/server";
import { addXianyuVerificationRecord, deleteXianyuVerificationRecord, getXianyuVerificationRecords } from "@/lib/serverXianyuVerification";
import { readBodyWebhookToken, requireWebhookAuth } from "@/lib/server/webhookAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireWebhookAuth(request);
  if (!auth.ok) return auth.response;
  const records = await getXianyuVerificationRecords();
  return NextResponse.json({ records });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) return auth.response;
    const record = await addXianyuVerificationRecord(body);
    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid verification record payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const bodyToken = readBodyWebhookToken(body);
    const auth = await requireWebhookAuth(request, bodyToken);
    if (!auth.ok) return auth.response;
    const result = await deleteXianyuVerificationRecord(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid verification record delete payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
