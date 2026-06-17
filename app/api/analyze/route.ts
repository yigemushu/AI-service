import { NextResponse } from "next/server";
import { callAiProvider } from "@/lib/aiProvider";
import { businessGuides, businessTypeLabels } from "@/lib/constants";
import type { BusinessType } from "@/lib/types";

type AnalyzeRequest = {
  chatText?: string;
  businessType?: BusinessType;
  sellerRules?: string;
  systemPrompt?: string;
  responseMode?: "fast" | "full";
  enabledTemplates?: Array<{ name: string; scenario: string; requiredInfo?: string; content: string }>;
  knowledgeRules?: Array<{ title: string; category: string; content: string }>;
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

const businessTypes: BusinessType[] = ["sam", "xianyu", "local", "trade"];

function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeAnalyzeRequest(value: unknown): AnalyzeRequest {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawBusinessType = safeString(raw.businessType);
  const businessType = businessTypes.includes(rawBusinessType as BusinessType) ? rawBusinessType as BusinessType : "sam";
  const responseMode = raw.responseMode === "full" ? "full" : "fast";
  const enabledTemplates = Array.isArray(raw.enabledTemplates)
    ? raw.enabledTemplates
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ name: safeString(item.name), scenario: safeString(item.scenario), content: safeString(item.content) }))
    : [];
  const knowledgeRules = Array.isArray(raw.knowledgeRules)
    ? raw.knowledgeRules
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ title: safeString(item.title), category: safeString(item.category), content: safeString(item.content) }))
    : [];
  return {
    chatText: safeString(raw.chatText),
    businessType,
    sellerRules: safeString(raw.sellerRules),
    systemPrompt: safeString(raw.systemPrompt),
    responseMode,
    enabledTemplates,
    knowledgeRules,
  };
}

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
const virtualServiceNames = [
  "AI写作", "写作", "代写", "润色", "改写", "论文润色", "文案优化", "小红书文案", "公众号文章", "脚本", "短视频脚本",
  "道歉检讨书", "检讨书", "道歉信", "致歉信", "演讲稿", "发言稿", "申请书", "读后感", "观后感",
  "PPT", "简历优化", "简历", "求职信", "翻译", "海报设计", "logo设计", "设计", "图片处理", "修图", "排版",
  "AI生成", "提示词", "prompt", "课程作业", "报告", "方案", "商业计划书", "咨询",
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
  if (businessType === "virtual") return "闲鱼";
  if (businessType === "trade") return "Facebook";
  return "微信";
}

function isVirtualServiceText(text: string) {
  return /(写作|代写|润色|改写|文案|小红书|公众号|脚本|检讨书|道歉|致歉|演讲稿|发言稿|申请书|读后感|观后感|PPT|ppt|简历|求职信|翻译|海报|logo|设计|修图|排版|AI生成|提示词|prompt|课程作业|报告|方案|咨询|字数|页数|交稿|交付|修改几次|源文件)/i.test(text);
}

function addVirtualServiceItem(items: AnalyzeApiItem[], text: string) {
  for (const service of virtualServiceNames) {
    if (new RegExp(service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
      addItem(items, service, "", "high");
      return;
    }
  }
  if (isVirtualServiceText(text)) addItem(items, "待确认虚拟服务", "", "low");
}

function extractMockItems(text: string, businessType: BusinessType) {
  const items: AnalyzeApiItem[] = [];
  const productList = businessType === "local" ? ["清洗空调", "空调清洗", "保洁"] : businessType === "virtual" ? [] : knownProducts;
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
  if (businessType === "xianyu" || businessType === "virtual") addVirtualServiceItem(items, text);
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
    !hasAddress && businessType !== "xianyu" && businessType !== "virtual" ? "地址/服务地点/目的地" : "",
    !hasPhone ? "联系方式" : "",
    !hasTime && businessType !== "xianyu" && businessType !== "virtual" ? "期望时间" : "",
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
  const templates = input.enabledTemplates?.length
    ? input.enabledTemplates.map((tpl) => `- ${tpl.name}（${tpl.scenario}）\n  需要的信息：${tpl.requiredInfo || "按模板内容判断"}\n  回复模板：${tpl.content}`).join("\n")
    : "暂无启用模板";
  const knowledgeRules = input.knowledgeRules?.length
    ? input.knowledgeRules.map((rule) => `- ${rule.title}（${rule.category}）：${rule.content}`).join("\n")
    : "暂无知识库规则";
  return [
    input.systemPrompt || "你是一个谨慎的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。",
    "",
    `业务类型：${businessTypeLabels[businessType]}`,
    `业务关注点：${businessGuides[businessType]}`,
    `商家规则：${input.sellerRules || "暂无"}`,
    "商家知识库规则：",
    knowledgeRules,
    "启用话术模板：",
    templates,
    "",
    "如果最新客户消息是在问问题、解释疑惑、闲聊或确认流程，例如“修改次数是什么意思”“还没看到草稿要不要改”“正常格式可以吗”，reply 必须先直接回答客户问题，不要机械追问所有模板字段；missing_info 只列当前回复后确实还要继续推进订单的信息。",
    "如果有启用话术模板，优先按最匹配模板的“需要的信息”判断 missing_info，并让 reply 参考对应“回复模板”的表达方式。",
    "输出要求：严格返回 JSON。reply 只能是草稿，不要自动发送。不要承诺一定有货、一定送达、最低价或无条件退款。",
    "reply 是给客户看的推荐回复，不是内部分析。请写得像微信真人商家：短、自然、有一点情绪，不要一大段说明。中文场景一般 2-4 行，先接住客户需求，再问缺失信息或说明需要确认。可以少量使用“哦、呀、哈、我帮你看下”，中文回复的 ~ 只放在整段最后一句结尾，不要每句话都加。外贸询盘保持英文商务语气，不使用 ~。",
    "如果是闲鱼虚拟服务，reply 必须像服务商沟通：问具体内容、用途/场景、字数/页数、风格语气、截止时间、交付格式和修改次数。不要询问收货地址、联系方式、包邮、发货、库存、成色，也不要承诺包过、保证原创、无限修改。",
    "reply 不要把商品、数量、风险、缺失信息像报告一样全部堆给客户；只保留客户下一步需要知道或补充的内容。风险和内部判断放到 risk_flags、missing_info、next_action。",
    "order_status 必须且只能使用这些固定值之一：待补充、待确认、待报价、待下单、处理中、售后中、已完成、已取消。",
    "状态判断规则：缺少地址、电话、数量、规格、目的地、贸易条款等关键信息时用待补充；外贸询价或需要报价时用待报价；闲鱼已拍下/待发货用处理中；退款、破损、投诉、没收到、质量问题用售后中；信息基本齐全但仍需人工确认库存、价格、排期或配送时用待确认。",
    "闲鱼不仅有实体商品，也可能是写作、润色、PPT、简历、设计、翻译、AI生成、咨询等虚拟服务。遇到虚拟服务时，不要要求收货地址、包邮或发货方式；要识别服务内容、需求范围、素材、字数/页数/数量、交付格式、截止时间、修改次数、是否可商用和报价边界。",
    "missing_info 要具体列出仍需补充的字段，例如联系方式、收货地址、服务地点、规格、数量、目的港、贸易条款、照片、订单号；虚拟服务则列需求说明、素材、字数/页数、交付格式、截止时间、修改次数、用途/风格。",
    "risk_flags 要覆盖真实经营风险，例如库存、价格、配送时效、包邮/议价、成色/正品、上门排期、售后证据、MOQ、贸易条款、交期；虚拟服务还要覆盖需求不清、范围蔓延、版权/原创承诺、违规代写、无限修改、交付验收边界，不要只写泛泛的风险。",
    "items 要尽量拆分所有商品/服务，数量和单位分开放入 quantity 与 unit；无法确定实物时写待确认商品，无法确定非实体服务时写待确认虚拟服务。",
    "客户聊天记录：",
    input.chatText || "",
  ].join("\n");
}

async function analyzeWithOpenAI(input: AnalyzeRequest) {
  const outputText = await callAiProvider({ prompt: buildPrompt(input), responseMode: input.responseMode, schema: analyzeSchema });
  return JSON.parse(outputText) as AnalyzeApiResponse;
}

function normalizeItems(items: AnalyzeApiItem[]) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const name = String(item?.name || "");
    const unit = String(item?.unit || "");
    let quantity = String(item?.quantity || "");
    const note = String(item?.note || "");
    const confidence = ["high", "medium", "low"].includes(String(item?.confidence)) ? item.confidence : "medium";
    if (unit && safeLower(quantity).endsWith(safeLower(unit))) quantity = quantity.slice(0, -unit.length).trim();
    return { name, quantity, unit, note, confidence } as AnalyzeApiItem;
  }).filter((item) => item.name.trim());
}

function mergeItems(primary: AnalyzeApiItem[], fallback: AnalyzeApiItem[]) {
  const items = [...normalizeItems(primary)];
  for (const item of normalizeItems(fallback)) {
    const name = safeLower(item.name);
    if (!items.some((existing) => safeLower(existing.name).includes(name) || name.includes(safeLower(existing.name)))) {
      items.push(item);
    }
  }
  return items;
}

function addUnique(list: string[], value: string) {
  if (value && !list.some((item) => item.includes(value) || value.includes(item))) list.push(value);
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function safeLower(value: unknown) {
  const safe = typeof value === "string" ? value : String(value ?? "");
  return safe.toLowerCase();
}

function getLatestCustomerSignal(text: string) {
  const marker = "最新客户消息：";
  const index = text.lastIndexOf(marker);
  if (index >= 0) return text.slice(index + marker.length).trim();
  return text;
}

function isCustomerQuestionTurn(signalText: string, businessType: BusinessType, isVirtualXianyu: boolean) {
  const signal = signalText.trim();
  if (!signal) return false;
  const asksProcessOrClarification = /(修改次数|修改|草稿|格式|什么意思|是什么|怎么改|怎么修改|要不要改|需不需要改|没看到|没看见|没收到|正常.*格式|普通.*格式|流程|怎么弄|怎么操作)/.test(signal);
  const asksCapability = /(能写吗|能做吗|可以写吗|可以做吗|能不能写|能不能做)/.test(signal);
  const asksGeneralQuestion = /[?？]|什么意思|是什么|怎么|为什么|要不要|需不需要|可以吗|行吗/.test(signal);
  const isOrderPush = /(多少钱|报价|价格|费用|怎么收费|多久|什么时候|几天|今天|明天|下单|拍下|买|订|要\s*\d|要[一二两三四五六七八九十]+个)/.test(signal);
  if (isVirtualXianyu) return asksProcessOrClarification || asksCapability || (asksGeneralQuestion && !isOrderPush);
  if (businessType === "trade") return false;
  return asksProcessOrClarification || (asksGeneralQuestion && !isOrderPush);
}

function buildCustomerQuestionReply(signalText: string, itemText: string, isVirtualXianyu: boolean) {
  const signal = signalText.trim();
  const serviceName = itemText || "这个需求";
  if (/修改次数|要不要改|需不需要改|修改/.test(signal) && /草稿|没看到|没看见|没收到/.test(signal)) {
    return "没事，你还没看到草稿的话不用先决定要不要修改。\n\n修改次数就是草稿出来后，我按同一个方向帮你调整几轮，比如措辞、语气、细节这些。先按正常文字格式来就行，你看完哪里不合适再跟我说哈~";
  }
  if (/修改次数|修改/.test(signal)) {
    return "修改次数就是草稿出来后，你可以让我按同一个方向调整几轮，比如措辞、语气、细节这些。\n\n不是让你现在就必须确定，先把草稿写出来，你看完哪里不合适再说就行哈~";
  }
  if (/草稿|没看到|没看见|没收到/.test(signal)) {
    return "没事，草稿出来前不用先决定要不要改。\n\n我先按你现在说的内容写一版，你看完后觉得哪里不合适，再告诉我调整就行哈~";
  }
  if (/格式|正常.*格式|普通.*格式/.test(signal)) {
    return "可以的，正常文字格式就行。\n\n我会按一段一段、方便你直接复制发送的形式来写，不做复杂排版哈~";
  }
  if (/(能写吗|能做吗|可以写吗|可以做吗|能不能写|能不能做)/.test(signal)) {
    return `可以写的，我先帮你看下${isVirtualXianyu ? `：${serviceName}` : ""}。\n\n你把想表达的重点和大概经过发我，我会按合适的语气帮你整理哈~`;
  }
  if (/怎么收费|多少钱|报价|价格|费用/.test(signal)) {
    return "价格要看具体内容和工作量，我先帮你确认需求范围后再给你报价。\n\n你把大概内容、字数/页数和什么时候要发我，我看完给你准话哈~";
  }
  return "可以的，我先回答你这个问题。\n\n你现在这个情况不用急着一次性把所有信息都补齐，先把最关心的点说清楚，我这边边确认边帮你推进哈~";
}

function hasVirtualDemandDetail(text: string) {
  return /(因为|昨天|朋友|女朋友|男朋友|客户|老师|领导|同学|用于|场景|原因|内容|事情|经过|认错|道歉|分手|迟到|吵架|不耐烦|素材|原文|资料|参考|文档|文件)/.test(text);
}

function hasVirtualPurpose(text: string) {
  return /(用于|用途|场景|发给|给.{0,8}(女朋友|男朋友|朋友|老师|领导|客户|同学)|道歉认错|表白|求职|汇报|发布|小红书|朋友圈)/.test(text);
}

function hasVirtualStyle(text: string) {
  return /(语气|风格|诚恳|委婉|真诚|正式|口语|温柔|不卑微|深刻|情感|幽默|专业|高级|自然|像真人)/.test(text);
}

function hasVirtualDeadline(text: string) {
  return /(今晚|今天|明天|后天|七点|7点|点前|截止|交稿|ddl|deadline|中午|晚上|下午|上午|周|星期)/i.test(text);
}

function hasVirtualFormat(text: string) {
  return /(Word|PDF|PPT|源文件|格式|docx|xlsx|图片|海报|链接|文档|文字版|微信发|直接发)/i.test(text);
}

function hasVirtualWorkload(text: string) {
  return /([0-9０-９一二两三四五六七八九十百千万]+\s*(字|页|篇|份|张|套)|字数|页数|篇幅|工作量|多少字|多长|一千|两千|三千)/.test(text);
}

function hasRevisionBoundary(text: string) {
  return /(修改|改几次|返工|定稿|满意为止|验收|包改|改到)/.test(text);
}

function removeSatisfiedVirtualMissingInfo(missingInfo: string[], signalText: string) {
  return missingInfo.filter((item) => {
    if (/(需求|素材|内容|具体内容|主题|原文|资料|文档|文件|事件|经过)/.test(item)) return !hasVirtualDemandDetail(signalText);
    if (/(用途|场景)/.test(item)) return !hasVirtualPurpose(signalText);
    if (/(风格|语气)/.test(item)) return !hasVirtualStyle(signalText);
    if (/(截止|时间|交付时间|什么时候要)/.test(item)) return !hasVirtualDeadline(signalText);
    if (/(字数|页数|工作量|篇幅)/.test(item)) return !hasVirtualWorkload(signalText);
    if (/(交付格式|格式|源文件)/.test(item)) return !hasVirtualFormat(signalText);
    if (/(修改|验收|边界)/.test(item)) return !hasRevisionBoundary(signalText);
    return true;
  });
}

function dedupeMissingInfo(list: string[]) {
  const normalized = list.map((item) => {
    if (/(修改|验收|边界)/.test(item)) return "修改次数/验收边界";
    if (/(字数|页数|工作量|篇幅|多长)/.test(item)) return "字数/页数/工作量";
    if (/(交付格式|格式|源文件)/.test(item)) return "交付格式";
    if (/(用途|场景)/.test(item)) return "用途/场景";
    if (/(语气|风格)/.test(item)) return "语气风格";
    if (/(具体内容|事件|经过|需求|素材)/.test(item)) return "具体内容/事件经过";
    return item;
  });
  return normalized.filter((item, index) => item && !normalized.some((other, otherIndex) => otherIndex < index && (item.includes(other) || other.includes(item))));
}

function parseRequiredInfo(value?: string) {
  return String(value || "")
    .split(/[\n\r、,，；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function templateMatchesText(template: NonNullable<AnalyzeRequest["enabledTemplates"]>[number], text: string, businessType: BusinessType) {
  const haystack = `${template.name} ${template.scenario} ${template.requiredInfo || ""} ${template.content}`.toLowerCase();
  if (businessType === "xianyu" && isVirtualServiceText(text) && /(虚拟|写作|润色|检讨|道歉|ppt|简历|设计|ai生成|交付)/i.test(haystack)) return true;
  if (businessType === "xianyu" && /砍价|便宜|最低|包邮|价格/.test(text) && /(报价|砍价|包邮|价格)/.test(haystack)) return true;
  const keywords = text.match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || [];
  return keywords.some((word) => word.length >= 2 && haystack.includes(word.toLowerCase()));
}

function pickMatchedTemplate(input: AnalyzeRequest, text: string, businessType: BusinessType) {
  const templates = input.enabledTemplates || [];
  if (templates.length === 0) return undefined;
  return templates.find((template) => templateMatchesText(template, text, businessType)) || templates[0];
}

function isRequiredInfoSatisfied(label: string, text: string, businessType: BusinessType) {
  const signalText = getLatestCustomerSignal(text);
  if (/(具体内容|事件|经过|需求|素材|原文|资料|文档|文件)/.test(label)) return hasVirtualDemandDetail(signalText);
  if (/(用途|场景)/.test(label)) return hasVirtualPurpose(signalText);
  if (/(语气|风格)/.test(label)) return hasVirtualStyle(signalText);
  if (/(字数|页数|工作量|篇幅|多长)/.test(label)) return hasVirtualWorkload(signalText);
  if (/(截止|交付时间|期望时间|送达时间|预约时间|时间)/.test(label)) return hasVirtualDeadline(signalText) || /(今天|明天|后天|周|星期|月底|晚上|上午|下午|\d{1,2}点|delivery time|lead time|July)/i.test(text);
  if (/(交付格式|格式|源文件)/.test(label)) return hasVirtualFormat(signalText);
  if (/(修改|验收|边界)/.test(label)) return hasRevisionBoundary(signalText);
  if (/(地址|收货地|收货地址|服务地址|服务地点)/.test(label)) return /(省|市|区|县|路|街|小区|地址|收货|青秀区|凤岭|民族大道|万象城|会展中心|良庆|上海|广东|浙江|成都|广州|新疆)/i.test(text);
  if (/(电话|联系方式|联系)/.test(label)) return /(1[3-9]\d{9}|电话|手机号|联系方式|phone|email|平台有|你有)/i.test(text);
  if (/(数量|规格|成色|型号)/.test(label)) return /(\d+|一|二|两|三|仨|四|五|六|七|八|九|十|套|盒|包|个|台|小时|型号|成色|尺码|规格)/i.test(text);
  if (businessType === "trade" && /(quantity|数量)/i.test(label)) return /(\d[\d,]*)\s*(pcs|pieces)?/i.test(text);
  if (businessType === "trade" && /(destination|目的|港|country|port)/i.test(label)) return /(Malaysia|Germany|UAE|Canada|Australia|Rotterdam|Los Angeles|Poland|Chile|EU|Mexico|UK|Dubai|Peru|destination|port|ship to)/i.test(text);
  if (businessType === "trade" && /(trade terms|条款|FOB|CIF|DDP)/i.test(label)) return /(FOB|CIF|DDP|trade terms|terms)/i.test(text);
  return false;
}

function applyTemplateRequiredInfo(missingInfo: string[], input: AnalyzeRequest, text: string, businessType: BusinessType) {
  const matchedTemplate = pickMatchedTemplate(input, text, businessType);
  if (!matchedTemplate) return { missingInfo, matchedTemplate };
  const next = [...missingInfo];
  for (const info of parseRequiredInfo(matchedTemplate.requiredInfo)) {
    if (!isRequiredInfoSatisfied(info, text, businessType)) addUnique(next, info);
  }
  return { missingInfo: dedupeMissingInfo(next), matchedTemplate };
}

function applyTemplateReply(reply: string, matchedTemplate: NonNullable<AnalyzeRequest["enabledTemplates"]>[number] | undefined, missingInfo: string[]) {
  if (!matchedTemplate?.content || missingInfo.length === 0) return reply;
  return matchedTemplate.content;
}

function isPhysicalXianyuInfo(value: string) {
  return /(收货|收货地|收货地址|自提|包邮|发货|物流|快递|库存|成色|商品状态|联系电话|联系方式|运费)/.test(value);
}

function isPhysicalXianyuReply(value: string) {
  return /(收货|收货地|收货地址|自提|包邮|发货|物流|快递|库存|成色|商品状态|联系电话|联系方式|运费|价格和是否包邮)/.test(value);
}

function enforceVirtualMissingInfo(missingInfo: string[], text: string) {
  const signalText = getLatestCustomerSignal(text);
  let next = removeSatisfiedVirtualMissingInfo(missingInfo.filter((item) => !isPhysicalXianyuInfo(item)), signalText);
  if (!hasVirtualDemandDetail(signalText)) addUnique(next, "具体内容/事件经过");
  if (!hasVirtualPurpose(signalText)) addUnique(next, "用途/场景");
  if (!hasVirtualStyle(signalText)) addUnique(next, "语气风格");
  if (!hasVirtualWorkload(signalText)) addUnique(next, "字数/页数/工作量");
  if (!hasVirtualDeadline(signalText)) addUnique(next, "截止时间");
  if (!hasVirtualFormat(signalText)) addUnique(next, "交付格式");
  if (!hasRevisionBoundary(signalText)) addUnique(next, "修改次数/验收边界");
  next = removeSatisfiedVirtualMissingInfo(next, signalText);
  return dedupeMissingInfo(next).filter((item) => !isPhysicalXianyuInfo(item));
}

function buildVirtualServiceReply(itemText: string, missingInfo: string[], text: string) {
  const signalText = getLatestCustomerSignal(text);
  const serviceName = /检讨|道歉|致歉/.test(`${itemText} ${text}`) ? "道歉检讨书" : itemText || "这个需求";
  if (missingInfo.length === 0) {
    return `可以的，我先帮你看下：${serviceName}。\n\n你补充的信息我记下了，我确认下工作量和报价后回复你哈~`;
  }
  const missingText = missingInfo.join("、");
  if (hasVirtualDemandDetail(signalText) || hasVirtualPurpose(signalText)) {
    return `可以的，我先帮你看下：${serviceName}。\n\n你补充的内容和想表达的方向我记下了，麻烦再确认一下${missingText}，我好判断工作量并给你报价哈~`;
  }
  return `可以的，我先帮你看下：${serviceName}。\n\n麻烦你补充一下${missingText}，我确认工作量后给你报价哈~`;
}

function templateLooksPhysicalXianyu(template: NonNullable<AnalyzeRequest["enabledTemplates"]>[number] | undefined) {
  if (!template) return false;
  return isPhysicalXianyuInfo(`${template.name} ${template.scenario} ${template.requiredInfo || ""} ${template.content}`);
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
    if (businessType === "virtual") {
      return `可以的，我先帮你看下：${itemText}。\n\n麻烦你补充一下${missingText}，我确认工作量后给你报价哈~`;
    }
    if (businessType === "xianyu") {
      const isVirtual = missingInfo.some((item) => /需求|素材|字数|页数|交付|截止|修改|用途|风格|格式/.test(item)) || /写作|润色|PPT|简历|设计|虚拟服务|翻译|文案/.test(itemText);
      if (isVirtual) return `可以的，我先帮你看下：${itemText}。\n\n麻烦你补充一下${missingText}，我确认工作量后给你报价哈~`;
      return `可以的，我先帮你确认下：${itemText}。\n\n麻烦你补充一下${missingText}，我看完再给你准话哈~`;
    }
    return `可以的，我先帮你看一下：${itemText}。\n\n麻烦你补充一下${missingText}，我确认下时间和报价后回复你~`;
  }
  if (businessType === "sam") return `可以的哦，我先帮你看一下：${itemText}。\n\n我确认下库存、价格和今天能不能安排，再回复你~`;
  if (businessType === "virtual") return `可以的，我先帮你看下：${itemText}。\n\n我确认下需求范围、交付时间和报价后回复你哈~`;
  if (businessType === "xianyu") {
    if (/写作|润色|PPT|简历|设计|虚拟服务|翻译|文案/.test(itemText)) return `可以的，我先帮你看下：${itemText}。\n\n我确认下需求范围、交付时间和报价后回复你哈~`;
    return `可以的，我先帮你确认下：${itemText}。\n\n我看下商品状态和发货安排，再给你准话哈~`;
  }
  if (businessType === "local") return `可以的，我先帮你看一下：${itemText}。\n\n我确认下师傅时间和最终报价后回复你~`;
  return `收到，我先确认一下：${itemText}。`;
}

function enrichMissingInfo(missingInfo: string[], text: string, businessType: BusinessType) {
  const signalText = getLatestCustomerSignal(text);
  let next = [...missingInfo];
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
  if (businessType === "xianyu" || businessType === "virtual") {
    const isVirtualService = businessType === "virtual" || isVirtualServiceText(text);
    if (isVirtualService) {
      next = removeSatisfiedVirtualMissingInfo(next, signalText);
      if (!hasVirtualDemandDetail(signalText)) addUnique(next, "具体内容/事件经过");
      if (!hasVirtualPurpose(signalText)) addUnique(next, "用途/场景");
      if (!hasVirtualStyle(signalText)) addUnique(next, "语气风格");
      if (!hasVirtualWorkload(signalText)) addUnique(next, "字数/页数/工作量");
      if (!hasVirtualDeadline(signalText)) addUnique(next, "截止时间");
      if (!hasVirtualFormat(signalText)) addUnique(next, "交付格式");
      if (!hasRevisionBoundary(signalText)) addUnique(next, "修改次数/验收边界");
    } else {
      if (!hasAddress && !/自提|平台有/.test(text)) addUnique(next, "收货地");
      if (/型号|128|256|尺码|M 码|成色|几成新/.test(text)) addUnique(next, "规格/成色确认");
      if (/没声音|退款|收到/.test(text)) addUnique(next, "订单号/照片或视频");
    }
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
  return dedupeMissingInfo(next);
}

function inferStableStatus(text: string, businessType: BusinessType, missingInfo: string[]) {
  if (/售后|退款|没到|还没到|投诉|压坏|破损|异味|broken|solve|quality|shipment/i.test(text)) return "售后中";
  if (/拍下了|已拍|寄出|发货|平台有/.test(text)) return "处理中";
  if (businessType === "trade" && /(\d[\d,]*)\s*(pcs|pieces)?|quote|FOB|CIF|DDP|price/i.test(text) && /(Malaysia|Germany|UAE|Canada|Australia|Rotterdam|Los Angeles|Poland|Chile|EU|Mexico|UK|Dubai|Peru|destination|port|ship to)/i.test(text)) return "待报价";
  if ((businessType === "xianyu" || businessType === "virtual") && isVirtualServiceText(text) && /报价|多少钱|价格|怎么收费|费用|多少米|多少/.test(text)) return missingInfo.length > 0 ? "待补充" : "待报价";
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

function sanitizeReply(reply: string, isVirtualXianyu = false, itemText = "", text = "", missingInfo: string[] = []) {
  const cleaned = (reply || "")
    .replace(/一定有货/g, "我先帮您确认库存")
    .replace(/一定送达/g, "我先帮您确认配送时效")
    .replace(/最低价/g, "按当前可确认价格")
    .replace(/包过/g, "我会按确认好的要求处理")
    .replace(/保证原创/g, "会尽量按原创要求处理，具体以确认范围为准")
    .replace(/无限修改/g, "按确认好的修改次数调整");
  if (!isVirtualXianyu) return cleaned;
  if (isPhysicalXianyuReply(cleaned)) {
    return buildVirtualServiceReply(itemText || "这项服务", missingInfo, text);
  }
  const signalText = getLatestCustomerSignal(text);
  const satisfiedKeys = [
    hasVirtualDemandDetail(signalText) ? /(具体内容|内容|事件|经过|需求|素材|资料)/ : null,
    hasVirtualPurpose(signalText) ? /(用途|场景)/ : null,
    hasVirtualStyle(signalText) ? /(语气|风格)/ : null,
    hasVirtualDeadline(signalText) ? /(截止|时间|什么时候要)/ : null,
  ].filter(Boolean) as RegExp[];
  const asksSatisfiedInfo = satisfiedKeys.some((pattern) => pattern.test(cleaned));
  if (asksSatisfiedInfo && missingInfo.length > 0) {
    return buildVirtualServiceReply(itemText || "内容", missingInfo, text);
  }
  return cleaned;
}

function normalizeAnalysis(result: AnalyzeApiResponse, input: AnalyzeRequest): AnalyzeApiResponse {
  const text = input.chatText || "";
  const businessType = input.businessType || "sam";
  const items = mergeItems(result.items || [], extractMockItems(text, businessType)).filter((item, _index, list) => {
    if (item.name !== "待确认虚拟服务") return true;
    return !list.some((other) => other.name !== "待确认虚拟服务" && /(写作|文案|检讨|道歉|PPT|简历|设计|翻译|服务|稿|报告|方案)/.test(other.name));
  });
  const isVirtualXianyu = businessType === "virtual" || (businessType === "xianyu" && isVirtualServiceText(text));
  const latestSignal = getLatestCustomerSignal(text);
  const shouldAnswerQuestion = isCustomerQuestionTurn(latestSignal, businessType, isVirtualXianyu);
  const enrichedMissingInfo = enrichMissingInfo(normalizeStringList(result.missing_info), text, businessType);
  const templateResult = applyTemplateRequiredInfo(enrichedMissingInfo, input, text, businessType);
  const missingInfo = shouldAnswerQuestion ? [] : isVirtualXianyu ? enforceVirtualMissingInfo(templateResult.missingInfo, text) : templateResult.missingInfo;
  const matchedTemplate = shouldAnswerQuestion ? undefined : isVirtualXianyu && templateLooksPhysicalXianyu(templateResult.matchedTemplate) ? undefined : templateResult.matchedTemplate;
  const itemText = items.map((item) => item.name).join("、");
  const riskFlags = new Set(normalizeStringList(result.risk_flags));
  if (items.length > 0 && isVirtualXianyu) riskFlags.add("虚拟服务的工作量、报价、交付格式和修改边界需确认后再回复，不应直接承诺结果。");
  if (items.length > 0 && !isVirtualXianyu) riskFlags.add("库存、价格和履约时效需确认后再回复，不应直接承诺。");
  if (/便宜|最低价|砍价|包邮/.test(text)) riskFlags.add("客户正在议价或确认包邮，需要按商家规则确认价格。");
  if (/今天|明天|上午|下午|急|delivery time/i.test(text)) riskFlags.add(isVirtualXianyu ? "客户有交付时效要求，需要确认工作量和是否来得及交付。" : "客户有时效要求，需要确认库存、服务档期或配送能力。");
  if (/成色|正品|验货|不合适|退|退款|没声音/.test(text)) riskFlags.add("闲鱼交易需确认成色、验货、退换和售后边界。");
  if (isVirtualXianyu && !shouldAnswerQuestion) riskFlags.add("虚拟服务需确认需求范围、素材、交付格式、截止时间和修改次数，避免承诺包过、保证原创或无限修改。");
  if (/上门|预约|清洗|保洁|维修|搬家|美甲|家教|拍摄/.test(text)) riskFlags.add("本地服务需确认上门地址、排期、服务范围和最终报价。");
  if (/MOQ|FOB|CIF|DDP|quote|price|lead time|pcs|pieces|shipment/i.test(text)) riskFlags.add("外贸询盘需确认 MOQ、贸易条款、目的港、规格和交期后再正式报价。");
  if (/异味|重新上门|昨天清洗|返工/.test(text)) riskFlags.add("本地服务售后需确认原订单、问题证据和是否需要返工。");
  if (/broken|quality|solve|last shipment|handles/i.test(text)) riskFlags.add("外贸售后需确认质量问题证据、订单号、数量和补救方案。");
  if (missingInfo.length > 0) riskFlags.add(`仍缺少关键信息：${missingInfo.join("、")}。`);
  const customerInfo = result.customer_info || { name: "", platform: "", address: "", phone: "", preferred_time: "" };
  const address = String(customerInfo.address || "") || extractMentionedAddress(text, businessType);
  const preferredTime = String(customerInfo.preferred_time || "") || extractMentionedTime(text);
  return {
    ...result,
    summary: String(result.summary || ""),
    customer_intent: String(result.customer_intent || ""),
    items,
    customer_info: {
      name: String(customerInfo.name || "待填写客户"),
      platform: String(customerInfo.platform || pickPlatform(text, businessType)),
      address,
      phone: String(customerInfo.phone || ""),
      preferred_time: preferredTime,
    },
    missing_info: missingInfo,
    order_status: inferStableStatus(text, businessType, missingInfo),
    risk_flags: Array.from(riskFlags),
    next_action: shouldAnswerQuestion ? ["先回复客户问题", "客户确认后再继续推进订单信息"] : normalizeStringList(result.next_action),
    reply: shouldAnswerQuestion
      ? buildCustomerQuestionReply(latestSignal, itemText, isVirtualXianyu)
      : isVirtualXianyu
        ? applyTemplateReply(sanitizeReply(String(result.reply || ""), true, itemText, text, missingInfo), matchedTemplate, missingInfo)
        : applyTemplateReply(sanitizeReply(String(result.reply || ""), false, itemText, text, missingInfo), matchedTemplate, missingInfo),
  };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let stage = "request_parse";
  try {
    const body = normalizeAnalyzeRequest(await request.json());
    if (!body.chatText?.trim()) {
      console.warn("[api/analyze] rejected", { requestId, status: 400, reason: "empty_chat_text" });
      return NextResponse.json({ error: "聊天记录不能为空", requestId }, { status: 400 });
    }
    console.info("[api/analyze] started", {
      requestId,
      businessType: body.businessType,
      chatLength: body.chatText.length,
      templateCount: body.enabledTemplates?.length || 0,
      knowledgeRuleCount: body.knowledgeRules?.length || 0,
      provider: safeString(process.env.AI_PROVIDER || "openai"),
    });
    stage = "provider_call";
    const result = process.env.OPENAI_API_KEY ? await analyzeWithOpenAI(body) : mockAnalyze(body);
    stage = "response_normalize";
    const normalized = normalizeAnalysis(result, body);
    console.info("[api/analyze] succeeded", { requestId, durationMs: Date.now() - startedAt, itemCount: normalized.items.length });
    return NextResponse.json(normalized);
  } catch (error) {
    console.error("[api/analyze] failed", {
      requestId,
      stage,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : safeString(error).slice(0, 300),
    });
    return NextResponse.json({ error: "AI 分析失败，请稍后重试或使用 mock 模式", requestId }, { status: 500 });
  }
}
