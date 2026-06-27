import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const extensionManifestPath = path.join(process.cwd(), "integrations", "browser-extension", "manifest.json");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();

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
  return { data, response };
}

async function requestPage(route) {
  const response = await fetch(`${baseUrl}${route}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${route} failed: HTTP ${response.status}`);
  if (!text || text.length < 1000) throw new Error(`GET ${route} returned an unexpectedly small page`);
  return response;
}

function ok(label, detail = "") {
  console.log(`[xianyu-real-ready] OK ${label}${detail ? ` - ${detail}` : ""}`);
}

function info(label, detail = "") {
  console.log(`[xianyu-real-ready] INFO ${label}${detail ? ` - ${detail}` : ""}`);
}

async function getToken() {
  if (explicitToken) return { token: explicitToken, source: "env" };
  const { data } = await request("/api/settings");
  const token = typeof data.inboxWebhookToken === "string" ? data.inboxWebhookToken.trim() : "";
  return { token, source: data.tokenSource || "settings" };
}

function isAcceptedRecord(record) {
  return Boolean(
    record
      && record.accepted === true
      && record.pendingCount === 0
      && record.testSessionAccepted === true
      && Number(record.testSessionPendingCount || 0) === 0
  );
}

async function main() {
  console.log(`[xianyu-real-ready] site=${baseUrl}`);

  const { data: health } = await request("/api/health");
  ok("工作台接口在线", JSON.stringify(health));

  const { token, source } = await getToken();
  if (!token) throw new Error("Webhook Token missing. Open settings and create/import the browser extension connection code first.");
  ok("插件连接码 Token 可用", `source=${source}`);

  await requestPage("/xianyu-mvp");
  ok("闲鱼闭环验证页可打开", `${baseUrl}/xianyu-mvp`);

  await requestPage("/messages?messageId=real_test_probe");
  ok("消息中心直达路由可打开", `${baseUrl}/messages?messageId=...`);

  const manifestRaw = await fs.readFile(extensionManifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  if (!manifest?.name || !manifest?.version) throw new Error("browser extension manifest is incomplete");
  ok("浏览器插件目录存在", `${manifest.name} ${manifest.version}`);

  const { data: verificationData } = await request("/api/xianyu-verification", {
    headers: {
      "x-webhook-token": token,
      Authorization: `Bearer ${token}`,
    },
  });
  const records = Array.isArray(verificationData.records) ? verificationData.records : [];
  const acceptedRecords = records.filter(isAcceptedRecord);
  if (acceptedRecords.length > 0) {
    ok("已有服务端通过验收记录", acceptedRecords[0].id || "record saved");
  } else {
    info("还没有服务端通过验收记录", "真实闲鱼页跑通后，在验证页点击“保存验收记录”。");
  }

  console.log("[xianyu-real-ready] PASS: ready to run the real Xianyu chat test");
  console.log(`[xianyu-real-ready] next: open ${baseUrl}/xianyu-mvp and follow “现场跑测步骤”`);
}

main().catch((error) => {
  console.error(`[xianyu-real-ready] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
