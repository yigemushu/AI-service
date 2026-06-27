import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();
const verificationFilePath = path.join(process.cwd(), "data", "xianyu-verification-records.json");

function normalizeBaseUrl(value) {
  const url = new URL(value);
  return url.origin;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(route, init = {}) {
  const response = await fetch(`${baseUrl}${route}`, init);
  const data = await readJson(response);
  if (!response.ok) {
    const detail = typeof data.error === "string" ? data.error : JSON.stringify(data);
    throw new Error(`${init.method || "GET"} ${route} failed: HTTP ${response.status} ${detail}`);
  }
  return data;
}

async function ensureToken() {
  if (explicitToken) return explicitToken;

  const settings = await request("/api/settings");
  const existing = typeof settings.inboxWebhookToken === "string" ? settings.inboxWebhookToken.trim() : "";
  if (existing) return existing;

  const generated = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const saved = await request("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxWebhookToken: generated }),
  });
  const token = typeof saved.inboxWebhookToken === "string" ? saved.inboxWebhookToken.trim() : "";
  if (!token) throw new Error("Failed to create smoke webhook token");
  return token;
}

async function readExistingFile() {
  try {
    return await fs.readFile(verificationFilePath, "utf8");
  } catch {
    return "";
  }
}

async function restoreExistingFile(raw) {
  if (raw) {
    await fs.mkdir(path.dirname(verificationFilePath), { recursive: true });
    await fs.writeFile(verificationFilePath, raw, "utf8");
    return;
  }
  await fs.rm(verificationFilePath, { force: true });
}

async function main() {
  console.log(`[xianyu-verification-smoke] site=${baseUrl}`);
  const original = await readExistingFile();
  try {
    await request("/api/health");
    const token = await ensureToken();
    const headers = {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    };
    const stamp = Date.now();
    const record = {
      id: `verify_smoke_${stamp}`,
      createdAt: new Date().toISOString(),
      accepted: true,
      pendingCount: 0,
      testSessionSummary: `XY-SMOKE-${stamp} / smoke buyer message`,
      testSessionAccepted: true,
      testSessionPendingCount: 0,
      testEvidenceItems: [{ label: "测试码消息进入工作台", ok: true, detail: "smoke" }],
      latestMessageSummary: "smoke message",
      latestCommandSummary: "smoke command",
      latestConfigSummary: "smoke config",
      latestAutoSyncSummary: "smoke auto sync",
      latestOutboundPluginSummary: "smoke outbound",
      acceptanceItems: [{ label: "同一闲鱼链接完成闭环", ok: true, detail: "smoke" }],
      diagnosticItems: [{ label: "闲鱼页面", ok: true, detail: "smoke" }],
    };

    const created = await request("/api/xianyu-verification", {
      method: "POST",
      headers,
      body: JSON.stringify({ record }),
    });
    if (created.record?.id !== record.id || created.record?.accepted !== true) throw new Error("verification record was not saved");
    console.log("[xianyu-verification-smoke] save record ok");

    const listed = await request("/api/xianyu-verification", { headers });
    const records = Array.isArray(listed.records) ? listed.records : [];
    if (!records.some((item) => item.id === record.id && item.accepted === true)) throw new Error("verification record was not visible in list");
    console.log("[xianyu-verification-smoke] list record ok");

    const deleted = await request("/api/xianyu-verification", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ id: record.id }),
    });
    if (deleted.deleted !== true) throw new Error("verification record cleanup failed");
    console.log("[xianyu-verification-smoke] cleanup ok");
    console.log("[xianyu-verification-smoke] PASS");
  } finally {
    await restoreExistingFile(original);
  }
}

main().catch((error) => {
  console.error(`[xianyu-verification-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
