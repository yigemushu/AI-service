const baseUrl = normalizeBaseUrl(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000");

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

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function requireAnalyzeShape(result, label) {
  require(typeof result.summary === "string" && result.summary.trim(), `${label}: summary missing`);
  require(typeof result.customer_intent === "string" && result.customer_intent.trim(), `${label}: customer_intent missing`);
  require(typeof result.order_status === "string" && result.order_status.trim(), `${label}: order_status missing`);
  require(["low", "medium", "high"].includes(result.urgency), `${label}: urgency invalid`);
  require(Array.isArray(result.items), `${label}: items should be array`);
  require(result.customer_info && typeof result.customer_info === "object", `${label}: customer_info missing`);
  require(Array.isArray(result.missing_info), `${label}: missing_info should be array`);
  require(Array.isArray(result.risk_flags), `${label}: risk_flags should be array`);
  require(Array.isArray(result.next_action), `${label}: next_action should be array`);
  require(typeof result.reply === "string" && result.reply.trim(), `${label}: reply missing`);
}

function assertNoHardPromises(reply, label) {
  const forbidden = /(一定有货|一定送达|最低价|无条件退款|包过|保证原创|无限修改)/;
  require(!forbidden.test(reply), `${label}: reply contains risky hard promise: ${reply}`);
}

async function analyze(label, payload) {
  const result = await request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      responseMode: "fast",
      sellerRules: "没有确认库存、运费、交付时间前，不要承诺一定有货、一定包邮、一定当天发。",
      systemPrompt: "你是谨慎的电商客服助手，只生成回复草稿，不自动发送。",
      ...payload,
    }),
  });
  requireAnalyzeShape(result, label);
  assertNoHardPromises(result.reply, label);
  console.log(`[reply-smoke] ${label} ok`);
  return result;
}

async function main() {
  console.log(`[reply-smoke] site=${baseUrl}`);
  await request("/api/health");

  const physical = await analyze("xianyu physical goods", {
    businessType: "xianyu",
    platform: "闲鱼",
    chatText: "最低多少？可以包邮吗？耳机还在吗，今天拍今天能发吗？",
  });
  const physicalText = [
    physical.summary,
    physical.customer_intent,
    physical.reply,
    ...physical.items.map((item) => item.name),
    ...physical.missing_info,
    ...physical.risk_flags,
  ].join("\n");
  require(/耳机|商品|待确认/.test(physicalText), "xianyu physical goods: should recognize physical item context");
  require(!/(字数|页数|交付格式|修改次数|验收边界)/.test(physical.reply), "xianyu physical goods: reply should not ask virtual-service questions");

  const virtual = await analyze("xianyu virtual service", {
    businessType: "xianyu",
    platform: "闲鱼",
    chatText: "我想要一份道歉检讨书，给女朋友看的，今晚能不能给我？多少钱？",
  });
  const virtualText = [
    virtual.summary,
    virtual.customer_intent,
    virtual.reply,
    ...virtual.items.map((item) => item.name),
    ...virtual.missing_info,
    ...virtual.risk_flags,
  ].join("\n");
  require(/道歉|检讨|写作|文案|虚拟|服务/.test(virtualText), "xianyu virtual service: should recognize virtual service context");
  require(!/(收货|快递|包邮|库存|成色|发货)/.test(virtual.reply), "xianyu virtual service: reply should not ask physical-goods questions");

  const followUp = await analyze("order follow-up", {
    businessType: "xianyu",
    platform: "闲鱼",
    mode: "continue",
    chatText: [
      "promptVersion: smoke",
      "mode: order-followup",
      "originalCustomerMessage:",
      "最低多少？耳机还在吗？",
      "",
      "latestCustomerMessage:",
      "包邮是什么意思？",
      "",
      "conversationHistory:",
      "1. 客户消息：最低多少？耳机还在吗？",
      "2. 商家已发送回复：我先确认商品状态和运费。",
    ].join("\n"),
    latestMessage: "包邮是什么意思？",
    currentMessage: "包邮是什么意思？",
    conversationHistory: [
      { role: "customer", content: "最低多少？耳机还在吗？" },
      { role: "assistant", content: "我先确认商品状态和运费。" },
      { role: "customer", content: "包邮是什么意思？" },
    ],
  });
  require(/包邮|运费|邮费|快递费|配送费/.test(followUp.reply), "order follow-up: reply should answer the customer's latest question");

  console.log("[reply-smoke] PASS");
}

main().catch((error) => {
  console.error(`[reply-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
