import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();
const statusFilePath = path.join(process.cwd(), "data", "browser-plugin-status.json");

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
    return await fs.readFile(statusFilePath, "utf8");
  } catch {
    return "";
  }
}

async function restoreExistingFile(raw) {
  if (raw) {
    await fs.mkdir(path.dirname(statusFilePath), { recursive: true });
    await fs.writeFile(statusFilePath, raw, "utf8");
    return;
  }
  await fs.rm(statusFilePath, { force: true });
}

async function main() {
  console.log(`[plugin-status-smoke] site=${baseUrl}`);
  const original = await readExistingFile();
  try {
    await request("/api/health");
    const token = await ensureToken();
    const headers = {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    };
    const stamp = Date.now();
    const sourceUrl = `https://www.goofish.com/im/chat?pluginStatusSmoke=${stamp}`;

    const config = await request("/api/plugin-status", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "config",
        ok: true,
        platform: "闲鱼",
        mode: "fill",
        action: "自动同步已开启 / 回闲鱼已开启 / 只回填输入框",
      }),
    });
    if (config.status?.kind !== "config" || config.status?.ok !== true || config.status?.mode !== "fill") throw new Error("config status was not saved");
    console.log("[plugin-status-smoke] config status ok");

    const autoSync = await request("/api/plugin-status", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "autoSync",
        ok: true,
        platform: "闲鱼",
        messageId: `msg_status_${stamp}`,
        sourceUrl,
        action: "自动监听",
      }),
    });
    if (autoSync.status?.kind !== "autoSync" || autoSync.status?.ok !== true || autoSync.status?.action !== "自动监听") throw new Error("autoSync status was not saved");
    console.log("[plugin-status-smoke] auto sync status ok");

    const outbound = await request("/api/plugin-status", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "outbound",
        ok: false,
        platform: "闲鱼",
        commandId: `out_status_${stamp}`,
        sourceUrl,
        mode: "fill",
        error: "intentional plugin status smoke failure",
      }),
    });
    if (outbound.status?.kind !== "outbound" || outbound.status?.ok !== false || !outbound.status?.error) throw new Error("outbound status was not saved");
    console.log("[plugin-status-smoke] outbound status ok");

    const all = await request(`/api/plugin-status?platform=${encodeURIComponent("闲鱼")}`, { headers });
    const statuses = Array.isArray(all.statuses) ? all.statuses : [];
    if (!statuses.some((status) => status.kind === "config" && status.mode === "fill" && status.action === "自动同步已开启 / 回闲鱼已开启 / 只回填输入框")) throw new Error("config status was not visible in list");
    if (!statuses.some((status) => status.messageId === `msg_status_${stamp}`)) throw new Error("autoSync status was not visible in list");
    if (!statuses.some((status) => status.commandId === `out_status_${stamp}`)) throw new Error("outbound status was not visible in list");
    console.log("[plugin-status-smoke] list status ok");
    console.log("[plugin-status-smoke] PASS");
  } finally {
    await restoreExistingFile(original);
  }
}

main().catch((error) => {
  console.error(`[plugin-status-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
