const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
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

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const data = await readJson(response);
  if (!response.ok) {
    const detail = typeof data.error === "string" ? data.error : JSON.stringify(data);
    throw new Error(`${init.method || "GET"} ${path} failed: HTTP ${response.status} ${detail}`);
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

async function main() {
  console.log(`[outbox-smoke] site=${baseUrl}`);
  await request("/api/health");
  const token = await ensureToken();
  const headers = {
    "Content-Type": "application/json",
    "x-webhook-token": token,
  };

  const stamp = Date.now();
  const created = await request("/api/outbox", {
    method: "POST",
    headers,
    body: JSON.stringify({
      customerFolder: `冒烟测试客户-${stamp}`,
      customerName: "冒烟测试客户",
      platform: "闲鱼",
      sourceUrl: `https://www.goofish.com/im?smoke=${stamp}`,
      reply: `冒烟测试回复 ${stamp}`,
      mode: "fill",
    }),
  });
  const command = created.command;
  if (!command?.id) throw new Error("Created command missing id");
  if (command.status !== "pending") throw new Error(`Expected pending status, got ${command.status}`);
  console.log(`[outbox-smoke] created=${command.id}`);

  const pending = await request(`/api/outbox?status=pending&platform=${encodeURIComponent("闲鱼")}`, { headers });
  const foundPending = Array.isArray(pending.commands) && pending.commands.some((item) => item.id === command.id);
  if (!foundPending) throw new Error("Created command not found in pending queue");
  console.log("[outbox-smoke] pending queue ok");

  const processing = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "processing" }),
  });
  if (processing.command?.status !== "processing") throw new Error("Processing status update failed");
  console.log("[outbox-smoke] processing update ok");

  const filled = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "filled" }),
  });
  if (filled.command?.status !== "filled") throw new Error("Filled status update failed");
  console.log("[outbox-smoke] filled update ok");

  const failed = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "failed", error: "intentional smoke failure" }),
  });
  if (failed.command?.status !== "failed" || !failed.command?.error) throw new Error("Failed status update failed");
  console.log("[outbox-smoke] failed update ok");

  const retried = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "pending" }),
  });
  if (retried.command?.status !== "pending" || retried.command?.error) throw new Error("Retry to pending failed");
  console.log("[outbox-smoke] retry update ok");

  const refilled = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "filled" }),
  });
  if (refilled.command?.status !== "filled") throw new Error("Refilled status update failed");
  console.log("[outbox-smoke] refilled update ok");

  const all = await request(`/api/outbox?status=all&platform=${encodeURIComponent("闲鱼")}`, { headers });
  const final = Array.isArray(all.commands) ? all.commands.find((item) => item.id === command.id) : null;
  if (!final || final.status !== "filled") throw new Error("Final command state not visible in all queue");
  console.log("[outbox-smoke] all queue ok");

  const cancelled = await request("/api/outbox", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: command.id, status: "cancelled", error: "smoke test cleanup" }),
  });
  if (cancelled.command?.status !== "cancelled") throw new Error("Cleanup status update failed");
  console.log("[outbox-smoke] cleanup ok");
  console.log("[outbox-smoke] PASS");
}

main().catch((error) => {
  console.error(`[outbox-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
