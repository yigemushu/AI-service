import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");
const explicitToken = String(process.env.INBOX_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "").trim();
const dataFiles = [
  path.join(process.cwd(), "data", "inbox-messages.json"),
  path.join(process.cwd(), "data", "orders.json"),
  path.join(process.cwd(), "data", "outbox-commands.json"),
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

function requireAnalyzeShape(result) {
  require(typeof result.summary === "string" && result.summary.trim(), "analysis summary missing");
  require(typeof result.customer_intent === "string" && result.customer_intent.trim(), "analysis customer_intent missing");
  require(typeof result.order_status === "string" && result.order_status.trim(), "analysis order_status missing");
  require(["low", "medium", "high"].includes(result.urgency), "analysis urgency invalid");
  require(Array.isArray(result.items), "analysis items should be array");
  require(result.customer_info && typeof result.customer_info === "object", "analysis customer_info missing");
  require(Array.isArray(result.missing_info), "analysis missing_info should be array");
  require(Array.isArray(result.risk_flags), "analysis risk_flags should be array");
  require(Array.isArray(result.next_action), "analysis next_action should be array");
  require(typeof result.reply === "string" && result.reply.trim(), "analysis reply missing");
}

async function main() {
  console.log(`[xianyu-loop-smoke] site=${baseUrl}`);
  const snapshots = await snapshotFiles(dataFiles);
  try {
    await request("/api/health");
    const token = await ensureToken();
    const headers = {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    };

    const stamp = Date.now();
    const customerFolder = `闲鱼闭环烟测-${stamp}`;
    const customerName = "闲鱼闭环买家";
    const sourceUrl = `https://www.goofish.com/im/chat?loopSmoke=${stamp}`;
    const rawMessage = "最低多少？耳机还在吗？可以包邮吗，今天拍今天能发吗？";

    const inbox = await request("/api/inbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        customerFolder,
        customerName,
        platform: "闲鱼",
        sourceChannel: "浏览器插件",
        businessType: "xianyu",
        rawMessage,
        sourceUrl,
      }),
    });
    const message = inbox.message;
    require(message?.id, "inbox message should be created");
    require(message.platform === "闲鱼", "inbox message should keep platform");
    require(message.sourceUrl === sourceUrl, "inbox message should keep sourceUrl");
    require(message.status === "未处理", "new inbox message should start as 未处理");
    console.log("[xianyu-loop-smoke] inbox ok");

    const analysis = await request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessType: "xianyu",
        platform: "闲鱼",
        chatText: rawMessage,
        responseMode: "fast",
        sellerRules: "没有确认库存、价格、运费和发货时间前，不要承诺一定有货、一定包邮、一定当天发。",
        systemPrompt: "你是谨慎的闲鱼商家客服助手，只生成回复草稿，不自动发送。",
      }),
    });
    requireAnalyzeShape(analysis);
    require(!/(一定有货|一定送达|最低价|无条件退款)/.test(analysis.reply), "reply should avoid hard promises");
    console.log("[xianyu-loop-smoke] analyze ok");

    const orderResult = await request("/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "browser-extension",
        platform: "闲鱼",
        businessType: "xianyu",
        customerNickname: customerName,
        customerFolder,
        originalMessage: rawMessage,
        sourceUrl,
        analysisResult: analysis,
        suggestedReply: analysis.reply,
        missingInfo: analysis.missing_info,
        riskFlags: analysis.risk_flags,
        items: analysis.items,
      }),
    });
    const order = orderResult.order;
    require(order?.id, "order should be saved");
    require(order.customerFolder === customerFolder, "order should keep customer folder");
    require(order.customerName === customerName, "order should keep customer name");
    require(order.platform === "闲鱼", "order should keep platform");
    require(order.sourceUrl === sourceUrl, "order should keep sourceUrl");
    require(order.analysis?.reply === analysis.reply, "order should keep reply draft");
    require(Array.isArray(order.conversation) && order.conversation.some((turn) => turn.role === "assistant" && turn.content === analysis.reply), "order should include assistant reply turn");
    require(Array.isArray(order.history) && order.history.length >= 1, "order should include history");
    console.log("[xianyu-loop-smoke] order ok");

    const outbox = await request("/api/outbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        messageId: message.id,
        orderId: order.id,
        customerFolder,
        customerName,
        platform: "闲鱼",
        sourceUrl,
        reply: analysis.reply,
        mode: "fill",
      }),
    });
    const command = outbox.command;
    require(command?.id, "outbox command should be created");
    require(command.status === "pending", "outbox command should start pending");
    require(command.messageId === message.id, "outbox command should link message");
    require(command.orderId === order.id, "outbox command should link order");
    require(command.sourceUrl === sourceUrl, "outbox command should keep sourceUrl");
    require(command.reply === analysis.reply, "outbox command should keep reply");
    console.log("[xianyu-loop-smoke] outbox create ok");

    const pending = await request(`/api/outbox?status=pending&platform=${encodeURIComponent("闲鱼")}`, { headers });
    require(Array.isArray(pending.commands) && pending.commands.some((item) => item.id === command.id), "pending outbox command should be visible to plugin poll");
    console.log("[xianyu-loop-smoke] plugin poll queue ok");

    const processing = await request("/api/outbox", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id: command.id, status: "processing" }),
    });
    require(processing.command?.status === "processing", "outbox processing update failed");

    const filled = await request("/api/outbox", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ id: command.id, status: "filled" }),
    });
    require(filled.command?.status === "filled", "outbox filled update failed");
    require(filled.message?.status === "已回复", "filled outbox command should mark source inbox message as replied");
    require(filled.message?.linkedOrderId === order.id, "filled outbox command should keep inbox linked to order");
    console.log("[xianyu-loop-smoke] outbox status flow ok");

    const allCommands = await request(`/api/outbox?status=all&platform=${encodeURIComponent("闲鱼")}`, { headers });
    const storedCommand = Array.isArray(allCommands.commands) ? allCommands.commands.find((item) => item.id === command.id) : null;
    require(storedCommand?.status === "filled", "filled outbox command should be visible in all queue");
    console.log("[xianyu-loop-smoke] final state ok");

    const autoOrderStamp = `${stamp}_auto_order`;
    const autoOrderFolder = `闲鱼直接发送烟测-${autoOrderStamp}`;
    const autoOrderSourceUrl = `https://www.goofish.com/im/chat?loopSmoke=${autoOrderStamp}`;
    const autoOrderRawMessage = "这台相机镜头有霉吗？能便宜一点吗？";
    const autoOrderReply = "您好，镜头情况我再帮您核对一下，价格也可以一起确认。";
    const autoInbox = await request("/api/inbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        customerFolder: autoOrderFolder,
        customerName,
        platform: "闲鱼",
        sourceChannel: "浏览器插件",
        businessType: "xianyu",
        rawMessage: autoOrderRawMessage,
        sourceUrl: autoOrderSourceUrl,
      }),
    });
    const autoMessage = autoInbox.message;
    require(autoMessage?.id, "auto-order source inbox message should be created");

    const autoOutbox = await request("/api/outbox", {
      method: "POST",
      headers,
      body: JSON.stringify({
        messageId: autoMessage.id,
        customerFolder: autoOrderFolder,
        customerName,
        platform: "闲鱼",
        sourceUrl: autoOrderSourceUrl,
        reply: autoOrderReply,
        mode: "fill",
      }),
    });
    require(autoOutbox.command?.id, "auto-order outbox command should be created");
    require(autoOutbox.orderCreated === true, "outbox should auto-create order when sending directly from an inbox message");
    require(autoOutbox.order?.id, "auto-created order should be returned");
    require(autoOutbox.command.orderId === autoOutbox.order.id, "outbox command should link auto-created order");
    require(autoOutbox.order.sourceUrl === autoOrderSourceUrl, "auto-created order should keep sourceUrl");
    require(autoOutbox.order.rawMessage.includes(autoOrderRawMessage), "auto-created order should keep raw message");
    require(autoOutbox.order.analysis?.reply === autoOrderReply, "auto-created order should keep outbound reply");
    require(autoOutbox.message?.linkedOrderId === autoOutbox.order.id, "source inbox message should link auto-created order");
    require(autoOutbox.message?.status === "已分析", "source inbox message should be analyzed after outbox creation");
    require(
      Array.isArray(autoOutbox.message?.conversation) && autoOutbox.message.conversation.some((turn) => turn.role === "assistant" && turn.content === autoOrderReply),
      "source inbox message should include outbound reply turn",
    );

    const allOrders = await request("/api/orders", { headers });
    const storedAutoOrder = Array.isArray(allOrders.orders) ? allOrders.orders.find((item) => item.id === autoOutbox.order.id) : null;
    require(storedAutoOrder?.sourceUrl === autoOrderSourceUrl, "auto-created order should be visible in orders list");
    console.log("[xianyu-loop-smoke] outbox auto-order ok");

    console.log("[xianyu-loop-smoke] PASS");
  } finally {
    await restoreFiles(snapshots);
  }
}

main().catch((error) => {
  console.error(`[xianyu-loop-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
