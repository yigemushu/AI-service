import fs from "node:fs/promises";
import path from "node:path";

const verificationFilePath = path.join(process.cwd(), "data", "xianyu-verification-records.json");
const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();

function normalizeBaseUrl(value) {
  const url = new URL(value);
  return url.origin;
}

function parseDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
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

async function readApiToken() {
  if (explicitToken) return explicitToken;
  const settings = await request("/api/settings");
  return typeof settings.inboxWebhookToken === "string" ? settings.inboxWebhookToken.trim() : "";
}

async function readApiRecords() {
  const token = await readApiToken();
  if (!token) throw new Error("Webhook token is not configured");
  const data = await request("/api/xianyu-verification", {
    headers: {
      "x-webhook-token": token,
      Authorization: `Bearer ${token}`,
    },
  });
  return { records: Array.isArray(data.records) ? data.records : [], source: `${baseUrl}/api/xianyu-verification` };
}

async function readFileRecords() {
  try {
    const raw = await fs.readFile(verificationFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return { records: Array.isArray(parsed) ? parsed : [], source: verificationFilePath };
  } catch {
    return { records: [], source: verificationFilePath };
  }
}

function isAcceptedRecord(record) {
  return Boolean(
    record
      && record.accepted === true
      && record.pendingCount === 0
      && record.testSessionAccepted === true
      && Number(record.testSessionPendingCount || 0) === 0
      && Array.isArray(record.acceptanceItems)
      && record.acceptanceItems.length > 0
      && record.acceptanceItems.every((item) => item?.ok === true)
      && Array.isArray(record.testEvidenceItems)
      && record.testEvidenceItems.length > 0
      && record.testEvidenceItems.every((item) => item?.ok === true)
  );
}

async function main() {
  let result;
  try {
    result = await readApiRecords();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[xianyu-mvp-accepted] API check unavailable, falling back to local file: ${message}`);
    result = await readFileRecords();
  }
  const records = result.records;
  const acceptedRecords = records
    .filter(isAcceptedRecord)
    .sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
  const latest = acceptedRecords[0];

  if (!latest) {
    console.error("[xianyu-mvp-accepted] FAIL: no accepted Xianyu MVP verification record found");
    console.error(`[xianyu-mvp-accepted] checked source: ${result.source}`);
    console.error(`[xianyu-mvp-accepted] total records: ${records.length}`);
    process.exitCode = 1;
    return;
  }

  console.log("[xianyu-mvp-accepted] PASS");
  console.log(`source=${result.source}`);
  console.log(`record=${latest.id}`);
  console.log(`createdAt=${latest.createdAt}`);
  console.log(`testSession=${latest.testSessionSummary || ""}`);
  console.log(`latestMessage=${latest.latestMessageSummary || ""}`);
  console.log(`latestCommand=${latest.latestCommandSummary || ""}`);
}

main().catch((error) => {
  console.error(`[xianyu-mvp-accepted] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
