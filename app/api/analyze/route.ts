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
  customer_info: { name: string; platform: string; address: string; phone: string; preferred_time: string };
  missing_info: string[];
  risk_flags: string[];
  next_action: string[];
  reply: string;
};

const analyzeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "customer_intent", "order_status", "urgency", "items", "customer_info", "missing_info", "risk_flags", "next_action", "reply"],
  properties: {
    summary: { type: "string" },
    customer_intent: { type: "string" },
    order_status: { type: "string", enum: ["待补充", "待确认", "待报价", "待下单", "处理中", "售后中", "已完成", "已取消"] },
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
  "瑞士卷", "牛肉卷", "鸡胸肉", "烤鸡", "麻薯", "蛋糕", "甜点",
  "耳机", "相机", "镜头", "键盘", "鼠标", "鞋", "平板", "笔", "壳", "显示器", "书", "Switch", "手柄", "iPhone", "衣服", "咖啡机", "滤芯",
  "空调深度清洗", "清洗空调", "空调清洗", "开荒保洁", "保洁", "洗衣机维修", "搬家", "美甲", "猫眼", "小学数学", "家教", "宠物洗护", "修毛", "活动拍摄",
  "stainless steel water bottles", "water bottles", "yoga mats", "LED desk lamp", "custom tote bags", "bamboo toothbrush", "ceramic mugs", "pet carriers", "silicone lunch boxes", "umbrellas", "camping chairs",
  "pet bowls", "silicone bibs", "baby toys", "notebooks", "lunch bags", "electric lunch boxes", "promotional umbrellas", "kids bottles", "storage boxes", "backpacks", "zippers",
];
const chineseDigits: Record<string, number> = { "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
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
  if (/facebook/i.test(text)) return "Facebook";
  if (/ebay/i.test(text)) return "eBay";
  if (businessType === "xianyu") return "闲鱼";
  if (businessType === "trade") return "Facebook";
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
  const tradeMatch = text.match(/([\d,]+)\s*(pieces|pcs|件)?\s+(?:of\s+)?([a-zA-Z\s-]{3,60}?)(?:\.|,| before| with| to| for| if|$)/i);
  if (tradeMatch) addItem(items, tradeMatch[3].trim(), `${tradeMatch[1]}${tradeMatch[2] || "pieces"}`, "high");
  if (items.length === 0 && /便宜|包邮|发货|成色/.test(text)) addItem(items, "待确认商品", "", "low");
  if (items.length === 0 && /服务|上门|预约|清洗|保洁/.test(text)) addItem(items, "待确认服务", "", "low");
  return items;
}

function mockAnalyze(input: AnalyzeRequest): AnalyzeApiResponse {
  const text = input.chatText || "";
  const businessType = input.businessType || "sam";
  const items = extractMockItems(text, businessType);
  const hasAddress = /(省|市|区|县|路|街|小区|地址|收货|青秀区|Malaysia|Germany)/i.test(text);
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
    customer_info: { name: "待填写客户", platform: pickPlatform(text, businessType), address: hasAddress ? "已提及，需核对完整信息" : "", phone: hasPhone ? "已提及，需核对" : "", preferred_time: hasTime ? "已提及，需核对" : "" },
    missing_info: missingInfo,
    risk_flags: ["当前为 mock 分析结果，关键字段需人工复核"],
    next_action: missingInfo.length > 0 ? ["补齐缺失信息", "确认价格、库存和履约时间"] : ["复述需求并确认", "推进报价或下单"],
    reply: buildWarmReply(businessType, itemText, missingInfo),
  };
}

function buildPrompt(input: AnalyzeRequest) {
  const businessType = input.businessType || "sam";
  const templates = input.enabledTemplates?.length ? input.enabledTemplates.map((tpl) => `- ${tpl.name}（${tpl.scenario}）：${tpl.content}`).join("\n") : "暂无启用模板";
  return [
    input.systemPrompt || "你是一个谨慎的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。",
    "",
    `业务类型：${businessTypeLabels[businessType]}`,
    `业务关注点：${businessGuides[businessType]}`,
    `商家规则：${input.sellerRules || "暂无"}`,
    "启用话术模板：",
    templates,
    "",
    "输出要求：严格返回 JSON。reply 只能是草稿，不要自动发送。不要承诺一定有货、一定送达、最低价或无条件退款。",
    "reply 是给客户看的推荐回复，不是内部分析。请写得像微信真人商家：短、自然、有一点情绪，不要一大段说明。中文场景一般 2-4 行，先接住客户需求，再问缺失信息或说明需要确认。可以少量使用“哦、呀、哈、我帮你看下”，中文回复的 ~ 只放在整段最后一句结尾，不要每句话都加。外贸询盘保持英文商务语气，不使用 ~。",
    "reply 不要把商品、数量、风险、缺失信息像报告一样全部堆给客户；只保留客户下一步需要知道或补充的内容。风险和内部判断放到 risk_flags、missing_info、next_action。",
    "order_status 必须且只能使用这些固定值之一：待补充、待确认、待报价、待下单、处理中、售后中、已完成、已取消。",
    "状态判断规则：缺少地址、电话、数量、规格、目的地、贸易条款等关键信息时用待补充；外贸询价或需要报价时用待报价；闲鱼已拍下/待发货用处理中；退款、破损、投诉、没收到、质量问题用售后中；信息基本齐全但仍需人工确认库存、价格、排期或配送时用待确认。",
    "missing_info 要具体列出仍需补充的字段，例如联系方式、收货地址、服务地点、规格、数量、目的港、贸易条款、照片、订单号。",
    "risk_flags 要覆盖真实经营风险，例如库存、价格、配送时效、包邮/议价、成色/正品、上门排期、售后证据、MOQ、贸易条款、交期，不要只写泛泛的风险。",
    "items 要尽量拆分所有商品/服务，数量和单位分开放入 quantity 与 unit；无法确定商品时写待确认商品或待确认服务。",
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
    body: JSON.stringify({ model, input: [{ role: "user", content: buildPrompt(input) }], text: { format: { type: "json_schema", name: "customer_order_analysis", strict: true, schema: analyzeSchema } } }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const outputText = readOutputText(await response.json());
  if (!outputText) throw new Error("OpenAI returned empty output");
  return JSON.parse(outputText) as AnalyzeApiResponse;
}

function normalizeItems(items: AnalyzeApiItem[]) {
  return (items || []).map((item) => {
    const unit = item.unit || "";
    let quantity = item.quantity || "";
    if (unit && quantity.toLowerCase().endsWith(unit.toLowerCase())) quantity = quantity.slice(0, -unit.length).trim();
    return { ...item, quantity, unit };
  });
}

function mergeItems(primary: AnalyzeApiItem[], fallback: AnalyzeApiItem[]) {
  const items = [...normalizeItems(primary)];
  for (const item of fallback) {
    const name = item.name.toLowerCase();
    if (!items.some((existing) => existing.name.toLowerCase().includes(name) || name.includes(existing.name.toLowerCase()))) {
      items.push(item);
    }
  }
  return items;
}

function addUnique(list: string[], value: string) {
  if (value && !list.some((item) => item.includes(value) || value.includes(item))) list.push(value);
}

function buildWarmReply(businessType: BusinessType, itemText: string, missingInfo: string[]) {
  if (businessType === "trade") {
    return `Thank you for your inquiry. We noted your request: ${itemText}.\n\nPlease share the missing details so we can confirm MOQ, price and lead time before sending a formal quotation.`;
  }
  if (missingInfo.length > 0) {
    const missingText = missingInfo.join("、");
    if (businessType === "sam") {
      return `可以的哦，我先帮你看一下：${itemText}。\n\n麻烦你补充一下${missingText}，我确认下今天能不能安排、以及现在有没有货~`;
    }
    if (businessType === "xianyu") {
      return `可以的，我先帮你确认下：${itemText}。\n\n麻烦你补充一下${missingText}，我看完再给你准话哈~`;
    }
    return `可以的，我先帮你看一下：${itemText}。\n\n麻烦你补充一下${missingText}，我确认下时间和报价后回复你~`;
  }
  if (businessType === "sam") return `可以的哦，我先帮你看一下：${itemText}。\n\n我确认下库存、价格和今天能不能安排，再回复你~`;
  if (businessType === "xianyu") return `可以的，我先帮你确认下：${itemText}。\n\n我看下商品状态和发货安排，再给你准话哈~`;
  if (businessType === "local") return `可以的，我先帮你看一下：${itemText}。\n\n我确认下师傅时间和最终报价后回复你~`;
  return `收到，我先确认一下：${itemText}。`;
}

function enrichMissingInfo(missingInfo: string[], text: string, businessType: BusinessType) {
  const next = [...missingInfo];
  const hasAddress = /(省|市|区|县|路|街|小区|地址|收货|青秀区|凤岭|民族大道|万象城|会展中心|良庆|Germany|Malaysia|UAE|Canada|Australia|Rotterdam|Los Angeles|上海|广东|浙江|成都|广州|新疆)/i.test(text);
  const hasPhone = /(1[3-9]\d{9}|电话|手机号|联系方式|phone|email|平台有|你有)/i.test(text);
  const hasTime = /(今天|明天|后天|周|星期|月底|晚上|上午|下午|\d{1,2}点|delivery time|lead time|July)/i.test(text);
  const hasQuantity = /(\d+|一|二|两|三|仨|四|五|六|七|八|九|十|one|two|pcs|pieces|套|盒|包|个|台|小时)/i.test(text);
  if (businessType === "sam") {
    if (!hasAddress) addUnique(next, "收货地址");
    if (!hasPhone) addUnique(next, "联系方式");
    if (!hasTime) addUnique(next, "期望送达时间");
    if (!hasQuantity) addUnique(next, "数量");
  }
  if (businessType === "xianyu") {
    if (!hasAddress && !/自提|平台有/.test(text)) addUnique(next, "收货地");
    if (/型号|128|256|尺码|M 码|成色|几成新/.test(text)) addUnique(next, "规格/成色确认");
    if (/没声音|退款|收到/.test(text)) addUnique(next, "订单号/照片或视频");
  }
  if (businessType === "local") {
    if (!hasAddress) addUnique(next, "服务地点");
    if (!hasPhone) addUnique(next, "联系方式");
    if (!hasTime) addUnique(next, "预约时间");
    if (/空调|洗衣机/.test(text)) addUnique(next, "设备型号/服务细节");
  }
  if (businessType === "trade") {
    if (!hasQuantity) addUnique(next, "quantity");
    if (!/(FOB|CIF|DDP|trade terms|terms)/i.test(text)) addUnique(next, "trade terms");
    if (!/(Malaysia|Germany|UAE|Canada|Australia|Rotterdam|Los Angeles|Poland|Chile|EU|Mexico|UK|Dubai|Peru|destination|port|ship to)/i.test(text)) addUnique(next, "destination");
    if (!/(spec|size|color|logo|printing|box|packaging|custom)/i.test(text)) addUnique(next, "specification");
  }
  return next;
}

function inferStableStatus(text: string, businessType: BusinessType, missingInfo: string[]) {
  if (/售后|退款|没到|还没到|投诉|压坏|破损|异味|broken|solve|quality|shipment/i.test(text)) return "售后中";
  if (/拍下了|已拍|寄出|发货|平台有/.test(text)) return "处理中";
  if (businessType === "trade" && /(\d[\d,]*)\s*(pcs|pieces)?|quote|FOB|CIF|DDP|price/i.test(text) && /(Malaysia|Germany|UAE|Canada|Australia|Rotterdam|Los Angeles|Poland|Chile|EU|Mexico|UK|Dubai|Peru|destination|port|ship to)/i.test(text)) return "待报价";
  if (missingInfo.length > 0) return "待补充";
  if (businessType === "trade" || /报价|多少钱|quote|price|FOB|CIF|DDP/i.test(text)) return "待报价";
  return "待确认";
}

function extractMentionedAddress(text: string, businessType: BusinessType) {
  const trade = text.match(/(Malaysia|Germany|UAE|Canada|Australia|Rotterdam|Los Angeles|Shenzhen|Ningbo|Poland|Chile|EU|Mexico|UK|Dubai|Peru)/i)?.[0];
  if (trade) return trade;
  const local = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:区|路|街|大道|小区|广场|中心|城|附近|号))/)?.[0];
  if (local) return local;
  return businessType === "xianyu" ? text.match(/(上海|广东|浙江|成都|广州|新疆)/)?.[0] || "" : "";
}

function extractMentionedTime(text: string) {
  return text.match(/(今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|月底|上午|下午|晚上|今晚|中午|July\s*\d+|lead time|delivery time)/i)?.[0] || "";
}

function sanitizeReply(reply: string) {
  return (reply || "")
    .replace(/一定有货/g, "我先帮您确认库存")
    .replace(/一定送达/g, "我先帮您确认配送时效")
    .replace(/最低价/g, "按当前可确认价格");
}

function normalizeAnalysis(result: AnalyzeApiResponse, input: AnalyzeRequest): AnalyzeApiResponse {
  const text = input.chatText || "";
  const businessType = input.businessType || "sam";
  const items = mergeItems(result.items || [], extractMockItems(text, businessType));
  const missingInfo = enrichMissingInfo(result.missing_info || [], text, businessType);
  const riskFlags = new Set(result.risk_flags || []);
  if (items.length > 0) riskFlags.add("库存、价格和履约时效需确认后再回复，不应直接承诺。");
  if (/便宜|最低价|砍价|包邮/.test(text)) riskFlags.add("客户正在议价或确认包邮，需要按商家规则确认价格。");
  if (/今天|明天|上午|下午|急|delivery time/i.test(text)) riskFlags.add("客户有时效要求，需要确认库存、服务档期或配送能力。");
  if (/成色|正品|验货|不合适|退|退款|没声音/.test(text)) riskFlags.add("闲鱼交易需确认成色、验货、退换和售后边界。");
  if (/上门|预约|清洗|保洁|维修|搬家|美甲|家教|拍摄/.test(text)) riskFlags.add("本地服务需确认上门地址、排期、服务范围和最终报价。");
  if (/MOQ|FOB|CIF|DDP|quote|price|lead time|pcs|pieces|shipment/i.test(text)) riskFlags.add("外贸询盘需确认 MOQ、贸易条款、目的港、规格和交期后再正式报价。");
  if (/异味|重新上门|昨天清洗|返工/.test(text)) riskFlags.add("本地服务售后需确认原订单、问题证据和是否需要返工。");
  if (/broken|quality|solve|last shipment|handles/i.test(text)) riskFlags.add("外贸售后需确认质量问题证据、订单号、数量和补救方案。");
  if (missingInfo.length > 0) riskFlags.add(`仍缺少关键信息：${missingInfo.join("、")}。`);
  const address = result.customer_info?.address || extractMentionedAddress(text, businessType);
  const preferredTime = result.customer_info?.preferred_time || extractMentionedTime(text);
  return {
    ...result,
    items,
    customer_info: { ...result.customer_info, address, preferred_time: preferredTime },
    missing_info: missingInfo,
    order_status: inferStableStatus(text, businessType, missingInfo),
    risk_flags: Array.from(riskFlags),
    reply: sanitizeReply(result.reply),
  };
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
