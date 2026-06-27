import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();
const dataFiles = [
  path.join(process.cwd(), "data", "inbox-messages.json"),
  path.join(process.cwd(), "data", "orders.json"),
];

function normalizeBaseUrl(value) {
  const url = new URL(value);
  return url.origin;
}

async function snapshotFiles(files) {
  const snapshots = new Map();
  for (const file of files) {
    try {
      snapshots.set(file, { exists: true, content: await fs.readFile(file, "utf8") });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      snapshots.set(file, { exists: false, content: "" });
    }
  }
  return snapshots;
}

async function restoreFiles(snapshots) {
  for (const [file, snapshot] of snapshots.entries()) {
    if (snapshot.exists) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, snapshot.content, "utf8");
    } else {
      await fs.rm(file, { force: true });
    }
  }
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

function require(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log(`[workbench-loop-smoke] site=${baseUrl}`);
  const snapshots = await snapshotFiles(dataFiles);
  try {
    await request("/api/health");
    const token = await ensureToken();
    const headers = {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    };

    const stamp = Date.now();
    const customerFolder = `闭环烟测客户-${stamp}`;
    const customerName = "闭环烟测买家";
    const sourceUrl = `https://www.goofish.com/im/chat?smoke=${stamp}`;
    const firstText = "耳机还在吗？可以包邮吗？";
    const secondText = "如果今天拍，什么时候能发？";

    const firstInbox = await request("/api/inbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        customerFolder,
        customerName,
        platform: "闲鱼",
        sourceChannel: "浏览器插件",
        businessType: "xianyu",
        rawMessage: firstText,
        sourceUrl,
      }),
    });
    require(firstInbox.message?.id, "First inbox message missing id");
    require(firstInbox.message.customerFolder === customerFolder, "First inbox message should keep customer folder");
    require(firstInbox.message.sourceUrl === sourceUrl, "First inbox message should keep sourceUrl");
    console.log("[workbench-loop-smoke] first inbox message ok");

    const secondInbox = await request("/api/inbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        customerFolder,
        customerName,
        platform: "闲鱼",
        sourceChannel: "浏览器插件",
        businessType: "xianyu",
        rawMessage: secondText,
        sourceUrl,
      }),
    });
    require(secondInbox.message?.id === firstInbox.message.id, "Same customer should merge into one folder record");
    require(String(secondInbox.message.rawMessage || "").includes(firstText), "Merged inbox should retain first message");
    require(String(secondInbox.message.rawMessage || "").includes(secondText), "Merged inbox should include second message");
    require(Array.isArray(secondInbox.message.conversation) && secondInbox.message.conversation.length >= 2, "Merged inbox should keep customer conversation turns");
    console.log("[workbench-loop-smoke] inbox merge ok");

    const inboxList = await request("/api/inbox", { headers });
    const storedMessage = Array.isArray(inboxList.messages)
      ? inboxList.messages.find((message) => message.id === firstInbox.message.id)
      : null;
    require(storedMessage, "Merged inbox message should be visible from GET /api/inbox");
    require(storedMessage.status === "未处理", "Merged inbox should remain actionable as 未处理");
    console.log("[workbench-loop-smoke] inbox list ok");

    const reply = "您好，耳机还在。可以帮您确认包邮和发货时间，您这边收货城市是哪里？";
    const orderResult = await request("/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "browser-extension",
        platform: "闲鱼",
        businessType: "xianyu",
        customerNickname: customerName,
        customerFolder,
        originalMessage: storedMessage.rawMessage,
        sourceUrl,
        analysisResult: {
          summary: "买家咨询耳机是否在售、包邮和发货时间",
          customer_intent: "确认商品可售、运费和发货时效",
          order_status: "待确认",
          urgency: "high",
          items: [{ name: "耳机", quantity: "1", unit: "个", note: "需确认包邮和发货时间", confidence: "high" }],
          customer_info: { name: customerName, platform: "闲鱼", address: "", phone: "", preferred_time: "" },
          missing_info: ["收货城市"],
          risk_flags: ["不要在未确认物流成本前承诺包邮"],
          next_action: ["确认收货城市", "确认是否包邮", "确认发货时间"],
          reply,
        },
      }),
    });
    const order = orderResult.order;
    require(order?.id, "Order should be created");
    require(order.customerFolder === customerFolder, "Order should keep customer folder");
    require(order.customerName === customerName, "Order should keep customer name");
    require(order.platform === "闲鱼", "Order should keep platform");
    require(order.sourceUrl === sourceUrl, "Order should keep sourceUrl for outbound reply");
    require(order.analysis?.reply === reply, "Order should keep AI reply draft");
    require(String(order.itemSummary || "").includes("耳机"), "Order should summarize product");
    require(Array.isArray(order.conversation) && order.conversation.some((turn) => turn.role === "assistant" && turn.content === reply), "Order conversation should include assistant reply");
    require(Array.isArray(order.history) && order.history.length >= 1, "Order should include history");
    console.log("[workbench-loop-smoke] order save ok");

    const ordersList = await request("/api/orders", { headers });
    const storedOrder = Array.isArray(ordersList.orders)
      ? ordersList.orders.find((item) => item.id === order.id)
      : null;
    require(storedOrder, "Created order should be visible from GET /api/orders");
    require(storedOrder.sourceUrl === sourceUrl, "Stored order should retain sourceUrl");
    console.log("[workbench-loop-smoke] order list ok");

    console.log("[workbench-loop-smoke] PASS");
  } finally {
    await restoreFiles(snapshots);
  }
}

main().catch((error) => {
  console.error(`[workbench-loop-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
