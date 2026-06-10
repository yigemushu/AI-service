import type { BusinessType, IntentLevel, Order, OrderHistoryEvent, OrderStatus } from "./types";
import { formatItemSummary, repairLegacyItemSummary } from "./format";

export type OrderStats = {
  todayNew: number;
  missingInfo: number;
  pendingQuote: number;
  highIntent: number;
  afterSales: number;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function safeLower(value: unknown) {
  return safeString(value).toLowerCase();
}

export function normalizeOrder(order: Order): Order {
  const createdAt = order.createdAt || order.updatedAt || new Date().toISOString();
  const products = order.analysis?.products || [];
  const itemSummary = products.length > 0 ? formatItemSummary(products) : repairLegacyItemSummary(order.itemSummary) || "待确认";
  const conversation = order.conversation?.length
    ? order.conversation
    : order.rawMessage
      ? [{ id: `${order.id}_initial`, role: "customer" as const, content: order.rawMessage, createdAt }]
      : [];
  const orderTitle = order.orderTitle || buildOrderTitle({ customerName: order.customerName, itemSummary, summary: order.summary });
  const history = order.history?.length
    ? order.history
    : [createOrderHistoryEvent("created", "订单创建", `初始需求：${order.summary || itemSummary}`, createdAt)];
  return {
    ...order,
    orderTitle,
    platform: order.platform || "未识别",
    itemSummary,
    intentLevel: order.intentLevel || inferIntentLevel(order.analysis?.urgency, order.analysis?.missingInfo || []),
    createdAt,
    updatedAt: order.updatedAt || createdAt,
    isNew: order.isNew ?? false,
    conversation,
    history,
  };
}

export function buildOrderTitle(input: { customerName?: string; itemSummary?: string; summary?: string }) {
  const item = (input.itemSummary || input.summary || "待确认需求").replace(/\s+/g, " ").trim();
  const customer = (input.customerName || "客户").trim();
  const shortItem = item.length > 28 ? `${item.slice(0, 28)}...` : item;
  return `${customer} - ${shortItem}`;
}

export function createOrderHistoryEvent(type: OrderHistoryEvent["type"], title: string, detail: string, createdAt = new Date().toISOString()): OrderHistoryEvent {
  return {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    detail,
    createdAt,
  };
}

export function inferIntentLevel(urgency?: string, missingInfo: string[] = []): IntentLevel {
  if (urgency === "high") return "高";
  if (urgency === "medium" || missingInfo.length <= 1) return "中";
  return "低";
}

export function mapOrderStatus(value?: string, missingInfo: string[] = []): OrderStatus {
  if (value && ["待补充", "待确认", "待报价", "待下单", "处理中", "售后中", "已完成", "已取消"].includes(value)) return value as OrderStatus;
  if (missingInfo.length > 0) return "待补充";
  return "待确认";
}

export function calculateStats(orders: Order[]): OrderStats {
  const today = new Date().toDateString();
  return orders.reduce(
    (stats, order) => {
      const normalized = normalizeOrder(order);
      if (new Date(normalized.createdAt).toDateString() === today) stats.todayNew += 1;
      if ((normalized.analysis?.missingInfo || []).length > 0 || normalized.status === "待补充") stats.missingInfo += 1;
      if (normalized.status === "待报价") stats.pendingQuote += 1;
      if (normalized.intentLevel === "高") stats.highIntent += 1;
      if (normalized.status === "售后中") stats.afterSales += 1;
      return stats;
    },
    { todayNew: 0, missingInfo: 0, pendingQuote: 0, highIntent: 0, afterSales: 0 },
  );
}

export function matchesOrderFilters(
  order: Order,
  filters: { status: "all" | OrderStatus; businessType: "all" | BusinessType; intentLevel: "all" | IntentLevel; keyword: string },
) {
  const keyword = safeLower(filters.keyword).trim();
  if (filters.status !== "all" && order.status !== filters.status) return false;
  if (filters.businessType !== "all" && order.businessType !== filters.businessType) return false;
  if (filters.intentLevel !== "all" && order.intentLevel !== filters.intentLevel) return false;
  if (!keyword) return true;
  return safeLower([order.orderTitle, order.customerName, order.platform, order.summary, order.itemSummary, order.note, order.rawMessage].map(safeString).join(" ")).includes(keyword);
}
