import { NextResponse } from "next/server";
import { businessGuides, businessTypeLabels } from "@/lib/constants";
import type { BusinessType } from "@/lib/types";

type AnalyzeRequest = {
  chatText?: string;
  businessType?: BusinessType;
  sellerRules?: string;
  systemPrompt?: string;
  enabledTemplates?: Array<{ name: string; scenario: string; content: string }>;
};

type AnalyzeApiItem = {
  name: string;
  quantity: string;
  unit: string;
  note: string;
  confidence: "high" | "medium" | "low";
};

type AnalyzeApiResponse = {
  summary: string;
  customer_intent: string;
  order_status: string;
  urgency: "low" | "medium" | "high";
  items: AnalyzeApiItem[];
  customer_info: {
    name: string;
    platform: string;
    address: string;
    phone: string;
    preferred_time: string;
  };
  missing_info: string[];
  risk_flags: string[];
  next_action: string[];
  reply: string;
};

const defaultSystemPrompt =
  "你是一个谨慎的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。请从客户聊天记录中提取客户诉求、所有商品或服务、数量、地址、电话、时间、缺失信息、风险点、下一步动作，并生成礼貌、明确、可复制的客服回复。客户一条消息中可能包含多个商品，必须逐一提取。不确定的信息也要输出，confidence 标为 low，并在 note 中说明需确认。";

const analyzeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "customer_intent",
    "order_status",
    "urgency",
    "items",
    "customer_info",
    "missing_info",
    "risk_flags",
    "next_action",
    "reply",
  ],
  properties: {
    summary: { type: "string" },
    customer_intent: { type: "string" },
    order_status: { type: "string" },
    urgency: { type: "string", enum: ["low", "medium", "high"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unit", "note", "confidence"],
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          note: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    customer_info: {
      type: "object",
      additionalProperties: false,
      required: ["name", "platform", "address", "phone", "preferred_time"],
      properties: {
        name: { type: "string" },
        platform: { type: "string" },
        address: { type: "string" },
        phone: { type: "string" },
        preferred_time: { type: "string" },
      },
    },
    missing_info: { type: "array", items: { type: "string" } },
    risk_flags: { type: "array", items: { type: "string" } },
    next_action: { type: "array", items: { type: "string" } },
    reply: { type: "string" },
  },
} as const;

const knownProducts = [
  "瑞士卷",
  "牛肉卷",
  "鸡胸肉",
  "烤鸡",
  "麻薯",
  "蛋糕",
  "耳机",
  "空调清洗",
  "清洗空调",
  "保洁",
  "water bottles",
  "stainless steel water bottles",
];

const chineseDigits: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const units = ["个", "盒", "包", "袋", "份", "件", "箱", "瓶", "套", "斤", "台", "pieces"];
const unitPattern = units.join("|");
const quantityPattern = `(?:\\d+|[一二两三四五六七八九十])\\s*(?:${unitPattern})?`;

function normalizeNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  return chineseDigits[value] || 1;
}

function splitQuantity(raw?: string) {
  if (!raw) return { quantity: "", unit: "" };
  const match = raw.replace(/\s+/g, "").match(/^(\d+|[一二两三四五六七八九十])(.+)?$/);
  if (!match) return { quantity: raw, unit: "" };
  return { quantity: String(normalizeNumber(match[1])), unit: match[2] || "" };
}

function addItem(items: AnalyzeApiItem[], name: string, rawQuantity?: string, confidence: AnalyzeApiItem["confidence"] = "medium") {
  const cleanedName = name
    .replace(/^(客户|我要|我想要|想要|要|买|拍|订|下单|采购|来|拿|帮我|给我|一个|一盒|一包|两个|2个)+/g, "")
    .replace(/[，。,.、\s]+$/g, "")
    .trim();
  if (!cleanedName || cleanedName.length < 2) return;
  const { quantity, unit } = splitQuantity(rawQuantity);
  if (items.some((item) => item.name === cleanedName && item.quantity === quantity && item.unit === unit)) return;
  items.push({ name: cleanedName, quantity, unit, confidence, note: confidence === "low" ? "需确认" : "" });
}

function pickPlatform(text: string, businessType: BusinessType) {
  if (/闲鱼|小黄鱼|拍下|包邮/.test(text)) return "闲鱼";
  if (/淘宝/.test(text)) return "淘宝";
  if (/拼多多/.test(text)) return "拼多多";
  if (/facebook/i.test(text)) return "Facebook";
  if (/ebay/i.test(text)) return "eBay";
  if (/微信|wx|v信|转账/.test(text)) return "微信";
  if (businessType === "xianyu") return "闲鱼";
  if (businessType === "trade") return /ebay/i.test(text) ? "eBay" : "Facebook";
  return "微信";
}

function extractMockItems(text: string, businessType: BusinessType) {
  const items: AnalyzeApiItem[] = [];
  const productList = businessType === "local" ? ["清洗空调", "空调清洗", "保洁"] : knownProducts;

  for (const product of productList) {
    const productRegExp = new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const afterRegExp = new RegExp(`^\\s*(${quantityPattern})`, "i");
    const beforeRegExp = new RegExp(`(${quantityPattern})\\s*$`, "i");

    for (const match of text.matchAll(productRegExp)) {
      const index = match.index ?? 0;
      const afterQuantity = text.slice(index + product.length, index + product.length + 12).match(afterRegExp)?.[1];
      const beforeQuantity = text.slice(Math.max(0, index - 12), index).match(beforeRegExp)?.[1];
      addItem(items, match[0], afterQuantity || beforeQuantity, "high");
    }
  }

  const tradeMatch = text.match(/(\d+)\s*(pieces|pcs|件)?\s+of\s+([a-zA-Z\s-]{3,60})/i);
  if (tradeMatch) addItem(items, tradeMatch[3].trim(), `${tradeMatch[1]}${tradeMatch[2] || "pieces"}`, "high");

  if (items.length === 0 && /便宜|包邮|发货|成色/.test(text)) addItem(items, "待确认商品", "", "low");
  if (items.length === 0 && /服务|上门|预约|清洗|保洁/.test(text)) addItem(items, "待确认服务", "", "low");
  return items;
}

function mockAnalyze(input: AnalyzeRequest): AnalyzeApiResponse {
  const text = input.chatText || "";
  const businessType = input.businessType || "sam";
  const items = extractMockItems(text, businessType);
  const hasAddress = /(省|市|区|县|路|街|小区|地址|收货|青秀区|万象城|Malaysia|Germany)/i.test(text);
  const hasPhone = /(1[3-9]\d{9}|电话|手机号|联系方式|phone|email)/i.test(text);
  const hasTime = /(今天|明天|后天|周|星期|\d{1,2}点|上午|下午|晚上|delivery time|lead time)/i.test(text);
  const isAfterSales = /退|退款|没到|还没到|售后|投诉/.test(text);
  const missingInfo = [
    !hasAddress && businessType !== "xianyu" ? "地址/服务地点/目的地" : "",
    !hasPhone ? "联系方式" : "",
    !hasTime && businessType !== "xianyu" ? "期望时间" : "",
    businessType === "trade" && !/MOQ|FOB|CIF|quote|price/i.test(text) ? "报价条款" : "",
  ].filter(Boolean);
  const itemText = items.map((item) => `${item.name}${item.quantity ? ` x${item.quantity}${item.unit}` : ""}`).join("、") || "待确认";

  return {
    summary: `${businessTypeLabels[businessType]}：${itemText}`,
    customer_intent: `${businessTypeLabels[businessType]}客户咨询：${text}`,
    order_status: isAfterSales ? "售后中" : missingInfo.length > 0 ? "待补充" : businessType === "trade" ? "待报价" : "待确认",
    urgency: /今天|明天|急|生日|delivery time/i.test(text) ? "high" : /多少钱|报价|quote|FOB/i.test(text) ? "medium" : "low",
    items,
    customer_info: {
      name: "待填写客户",
      platform: pickPlatform(text, businessType),
      address: hasAddress ? "已提及，需核对完整信息" : "",
      phone: hasPhone ? "已提及，需核对" : "",
      preferred_time: hasTime ? "已提及，需核对" : "",
    },
    missing_info: missingInfo,
    risk_flags: ["当前为 mock 分析结果，关键字段需人工复核"],
    next_action: missingInfo.length > 0 ? ["补齐缺失信息", "确认价格、库存和履约时间"] : ["复述需求并确认", "推进报价或下单"],
    reply:
      businessType === "trade"
        ? `Thank you for your inquiry. We noted your request: ${itemText}. We will confirm MOQ, FOB price and delivery time before sending a formal quotation.`
        : `您好，我先帮您确认：${itemText}。${missingInfo.length ? `还需要补充：${missingInfo.join("、")}。` : ""}库存、价格和履约时间确认后再回复您。`,
  };
}

function buildPrompt(input: AnalyzeRequest) {
  const businessType = input.businessType || "sam";
  const templates = input.enabledTemplates?.length
    ? input.enabledTemplates.map((tpl) => `- ${tpl.name}（${tpl.scenario}）：${tpl.content}`).join("\n")
    : "暂无启用模板";

  return [
    input.systemPrompt || defaultSystemPrompt,
    "",
    `业务类型：${businessTypeLabels[businessType]}`,
    `业务关注点：${businessGuides[businessType]}`,
    `商家规则：${input.sellerRules || "暂无"}`,
    "启用话术模板：",
    templates,
    "",
    "输出要求：严格返回 JSON。reply 只能是草稿，不要自动发送。不要承诺一定有货、一定送达、最低价或无条件退款。",
    "外贸询盘如果客户使用英文，请生成英文或中英文回复草稿。",
    "客户聊天记录：",
    input.chatText || "",
  ].join("\n");
}

function readOutputText(response: unknown) {
  const data = response as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (data.output_text) return data.output_text;
  return data.output?.flatMap((item) => item.content || []).map((content) => content.text || "").join("") || "";
}

async function analyzeWithOpenAI(input: AnalyzeRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mockAnalyze(input);
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: buildPrompt(input) }],
      text: { format: { type: "json_schema", name: "customer_order_analysis", strict: true, schema: analyzeSchema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const outputText = readOutputText(await response.json());
  if (!outputText) throw new Error("OpenAI returned empty output");
  return JSON.parse(outputText) as AnalyzeApiResponse;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const result = process.env.OPENAI_API_KEY ? await analyzeWithOpenAI(body) : mockAnalyze(body);
    return NextResponse.json(normalizeAnalysis(result, body));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI 分析失败，请稍后重试或使用 mock 模式" }, { status: 500 });
  }
}

function normalizeAnalysis(result: AnalyzeApiResponse, input: AnalyzeRequest): AnalyzeApiResponse {
  const text = input.chatText || "";
  const riskFlags = new Set(result.risk_flags || []);
  if (result.items.length > 0) riskFlags.add("库存、价格和履约时效需确认后再回复，不应直接承诺。");
  if (/便宜|低五块|低\d+块|最低价|优惠|砍价|包邮/.test(text)) riskFlags.add("客户正在议价或确认包邮，需要按商家规则确认价格。");
  if (/退|退款|没到|还没到|售后|投诉/.test(text)) riskFlags.add("涉及售后或退款，需要先核对订单信息和履约状态。");
  if (/今天|明天|上午|下午|晚上|生日|急|delivery time/i.test(text)) riskFlags.add("客户有时效要求，需要确认库存、服务档期或配送能力。");
  if (result.missing_info.length > 0) riskFlags.add(`仍缺少关键信息：${result.missing_info.join("、")}。`);
  return { ...result, items: normalizeItems(result.items), risk_flags: Array.from(riskFlags), reply: sanitizeReply(result.reply) };
}

function sanitizeReply(reply: string) {
  return (reply || "")
    .replace(/一定有货/g, "我先帮您确认库存")
    .replace(/一定送达/g, "我先帮您确认配送时效")
    .replace(/保证送达/g, "确认履约能力后再回复您")
    .replace(/肯定能到/g, "我先确认是否能到")
    .replace(/最低价/g, "按当前可确认价格");
}

function normalizeItems(items: AnalyzeApiItem[]) {
  return items.map((item) => {
    const unit = item.unit || "";
    let quantity = item.quantity || "";
    if (unit && quantity.toLowerCase().endsWith(unit.toLowerCase())) {
      quantity = quantity.slice(0, -unit.length).trim();
    }
    return { ...item, quantity, unit };
  });
}
