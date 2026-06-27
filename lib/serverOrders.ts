import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { formatItemSummary } from "./format";
import { buildOrderTitle, createOrderHistoryEvent, inferIntentLevel, mapOrderStatus, normalizeOrder } from "./orderUtils";
import type { AnalyzeApiResponse, AnalyzeResult, BusinessType, ConversationTurn, CustomerMessage, Order } from "./types";

const ordersFilePath = path.join(process.cwd(), "data", "orders.json");

type ExtensionOrderPayload = {
  source?: unknown;
  platform?: unknown;
  businessType?: unknown;
  customerNickname?: unknown;
  customerName?: unknown;
  customerFolder?: unknown;
  originalMessage?: unknown;
  rawMessage?: unknown;
  analysisResult?: unknown;
  suggestedReply?: unknown;
  missingInfo?: unknown;
  riskFlags?: unknown;
  items?: unknown;
  createdAt?: unknown;
  sourceUrl?: unknown;
};

type OutboundOrderPayload = {
  orderId?: unknown;
  messageId?: unknown;
  customerFolder?: unknown;
  customerName?: unknown;
  platform?: unknown;
  sourceUrl?: unknown;
  reply?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBusinessType(value: unknown): BusinessType {
  if (value === "sam" || value === "xianyu" || value === "virtual" || value === "local" || value === "trade") return value;
  return "xianyu";
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function createServerId() {
  return `srv_order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readOrdersFile() {
  try {
    const raw = await readFile(ordersFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Order[]).map(normalizeOrder) : [];
  } catch {
    return [];
  }
}

async function writeOrdersFile(orders: Order[]) {
  await mkdir(path.dirname(ordersFilePath), { recursive: true });
  await writeFile(ordersFilePath, JSON.stringify(orders.map(normalizeOrder), null, 2), "utf8");
}

function mapConfidence(value: unknown): "高" | "中" | "低" {
  if (value === "high" || value === "高") return "高";
  if (value === "low" || value === "低") return "低";
  return "中";
}

function normalizeAnalysis(payload: ExtensionOrderPayload, rawMessage: string, platform: string): AnalyzeResult {
  const api = payload.analysisResult as Partial<AnalyzeApiResponse> | undefined;
  const fallbackItems = safeArray<Record<string, unknown>>(payload.items);
  const items = safeArray<Record<string, unknown>>(api?.items).length ? safeArray<Record<string, unknown>>(api?.items) : fallbackItems;
  const products = items.map((item) => ({
    name: safeString(item.name) || "待确认",
    quantity: safeString(item.quantity) || "1",
    unit: safeString(item.unit),
    notes: safeString(item.note) || safeString(item.notes),
    confidence: mapConfidence(item.confidence),
  }));
  const missingInfo = safeArray<string>(api?.missing_info).length ? safeArray<string>(api?.missing_info) : safeArray<string>(payload.missingInfo);
  const risks = safeArray<string>(api?.risk_flags).length ? safeArray<string>(api?.risk_flags) : safeArray<string>(payload.riskFlags);
  return {
    customerIntent: safeString(api?.customer_intent) || safeString(api?.summary) || rawMessage.slice(0, 80),
    products,
    missingInfo,
    risks,
    nextActions: safeArray<string>(api?.next_action),
    reply: safeString(api?.reply) || safeString(payload.suggestedReply),
    summary: safeString(api?.summary) || rawMessage.slice(0, 80),
    customerName: safeString(api?.customer_info?.name),
    platform: safeString(api?.customer_info?.platform) || platform,
    orderStatus: safeString(api?.order_status),
    urgency: api?.urgency === "high" || api?.urgency === "low" ? api.urgency : "medium",
  };
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return value.split("#")[0];
  }
}

function isDuplicate(candidate: Order, existing: Order) {
  const sameSource = normalizeKeyPart(candidate.note).includes("browser-extension") && normalizeKeyPart(existing.note).includes("browser-extension");
  if (!sameSource) return false;
  if (normalizeKeyPart(candidate.rawMessage) !== normalizeKeyPart(existing.rawMessage)) return false;
  const candidateTime = new Date(candidate.createdAt).getTime();
  const existingTime = new Date(existing.createdAt).getTime();
  return Number.isFinite(candidateTime) && Number.isFinite(existingTime) && Math.abs(candidateTime - existingTime) <= 10 * 60 * 1000;
}

export async function getServerOrders() {
  return readOrdersFile();
}

export async function addServerOrder(payload: ExtensionOrderPayload) {
  const now = new Date().toISOString();
  const createdAt = safeString(payload.createdAt) || now;
  const rawMessage = safeString(payload.originalMessage) || safeString(payload.rawMessage);
  if (!rawMessage) throw new Error("originalMessage is required");

  const platform = safeString(payload.platform) || "未识别";
  const businessType = normalizeBusinessType(payload.businessType);
  const customerName = safeString(payload.customerNickname) || safeString(payload.customerName) || "待识别客户";
  const customerFolder = safeString(payload.customerFolder) || customerName;
  const analysis = normalizeAnalysis(payload, rawMessage, platform);
  const itemSummary = formatItemSummary(analysis.products) || "待确认";
  const conversation: ConversationTurn[] = [
    { id: `turn_${Date.now()}_customer`, role: "customer", content: rawMessage, createdAt },
  ];
  if (analysis.reply) {
    conversation.push({ id: `turn_${Date.now()}_assistant`, role: "assistant", content: analysis.reply, createdAt: now });
  }

  const order = normalizeOrder({
    id: createServerId(),
    orderTitle: buildOrderTitle({ customerName, itemSummary, summary: analysis.summary }),
    customerFolder,
    customerName,
    platform,
    businessType,
    summary: analysis.summary || rawMessage.slice(0, 80),
    itemSummary,
    status: mapOrderStatus(analysis.orderStatus, analysis.missingInfo),
    intentLevel: inferIntentLevel(analysis.urgency, analysis.missingInfo),
    note: `来源：browser-extension${safeString(payload.source) ? ` / ${safeString(payload.source)}` : ""}`,
    createdAt,
    updatedAt: now,
    isNew: true,
    rawMessage,
    sourceUrl: safeString(payload.sourceUrl),
    analysis,
    conversation,
    history: [createOrderHistoryEvent("created", "浏览器插件创建订单", `客户：${customerName}`, createdAt)],
  });

  const orders = await readOrdersFile();
  const duplicate = orders.find((item) => isDuplicate(order, item));
  if (duplicate) return { order: duplicate, duplicate: true };

  const next = [order, ...orders].slice(0, 1000);
  await writeOrdersFile(next);
  return { order, duplicate: false };
}

export async function ensureServerOrderForOutboundReply(payload: OutboundOrderPayload, sourceMessage?: CustomerMessage) {
  const orders = await readOrdersFile();
  const orderId = safeString(payload.orderId);
  if (orderId) {
    const existing = orders.find((order) => order.id === orderId);
    if (existing) return { order: existing, created: false };
  }

  const sourceUrl = safeString(payload.sourceUrl) || sourceMessage?.sourceUrl || "";
  const normalizedSourceUrl = normalizeUrl(sourceUrl);
  const customerFolder = safeString(payload.customerFolder) || sourceMessage?.customerFolder || "";
  const customerName = safeString(payload.customerName) || sourceMessage?.customerName || "待识别客户";
  const platform = safeString(payload.platform) || String(sourceMessage?.platform || "闲鱼");
  const existingByContext = orders.find((order) => {
    const sameUrl = normalizedSourceUrl && normalizeUrl(order.sourceUrl || "") === normalizedSourceUrl;
    const sameFolder = customerFolder && normalizeKeyPart(order.customerFolder || order.customerName) === normalizeKeyPart(customerFolder);
    const samePlatform = normalizeKeyPart(String(order.platform || "")) === normalizeKeyPart(platform);
    return samePlatform && (sameUrl || sameFolder);
  });
  if (existingByContext) return { order: existingByContext, created: false };

  const rawMessage = sourceMessage?.rawMessage || "";
  if (!rawMessage.trim()) return { order: undefined, created: false };

  const now = new Date().toISOString();
  const reply = safeString(payload.reply);
  const businessType = normalizeBusinessType(sourceMessage?.businessType);
  const analysis: AnalyzeResult = sourceMessage?.analysis || {
    customerIntent: rawMessage.slice(0, 80),
    products: [{ name: "待确认", quantity: "1", unit: "", notes: "", confidence: "中" }],
    missingInfo: [],
    risks: [],
    nextActions: [],
    reply,
    summary: rawMessage.slice(0, 80),
    customerName,
    platform,
    orderStatus: "待确认",
    urgency: "medium",
  };
  const nextAnalysis: AnalyzeResult = { ...analysis, reply: analysis.reply || reply };
  const itemSummary = formatItemSummary(nextAnalysis.products) || "待确认";
  const conversation: ConversationTurn[] = [
    ...(sourceMessage?.conversation || [{ id: `turn_${Date.now()}_customer`, role: "customer", content: rawMessage, createdAt: sourceMessage?.createdAt || now }]),
  ];
  if (reply && !conversation.some((turn) => turn.role === "assistant" && turn.content === reply)) {
    conversation.push({ id: `turn_${Date.now()}_assistant_outbox`, role: "assistant", content: reply, createdAt: now });
  }

  const order = normalizeOrder({
    id: createServerId(),
    orderTitle: buildOrderTitle({ customerName, itemSummary, summary: nextAnalysis.summary }),
    customerFolder: customerFolder || customerName,
    customerName,
    platform,
    businessType,
    summary: nextAnalysis.summary || rawMessage.slice(0, 80),
    itemSummary,
    status: mapOrderStatus(nextAnalysis.orderStatus, nextAnalysis.missingInfo),
    intentLevel: inferIntentLevel(nextAnalysis.urgency, nextAnalysis.missingInfo),
    note: "来源：outbox-auto-order",
    createdAt: sourceMessage?.createdAt || now,
    updatedAt: now,
    isNew: true,
    rawMessage,
    sourceUrl,
    analysis: nextAnalysis,
    conversation,
    history: [
      createOrderHistoryEvent("created", "发送回闲鱼前自动创建订单", `客户：${customerName}\n来源消息：${sourceMessage?.id || "按链接匹配"}`, now),
      createOrderHistoryEvent("follow_up", "已创建闲鱼发送任务", reply ? `回复：${reply}` : "回复内容已进入发送任务", now),
    ],
  });

  const next = [order, ...orders].slice(0, 1000);
  await writeOrdersFile(next);
  return { order, created: true };
}
