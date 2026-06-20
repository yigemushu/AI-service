import type { BusinessType, IntentLevel, Order, OrderHistoryEvent, OrderStatus } from "./types";
import { formatItemSummary, repairLegacyItemSummary } from "./format";

export type OrderStats = {
  todayNew: number;
  missingInfo: number;
  pendingQuote: number;
  highIntent: number;
  afterSales: number;
};

const virtualServicePattern =
  /(写作|代写|润色|改写|文案|小红书|公众号|脚本|检讨书|道歉|致歉|演讲稿|发言稿|申请书|读后感|观后感|PPT|ppt|简历|求职信|翻译|海报|logo|设计|修图|排版|AI生成|提示词|prompt|课程作业|报告|方案|咨询|字数|页数|交稿|交付|修改几次|源文件)/i;

const physicalXianyuPattern = /(收货|自提|包邮|发货|物流|快递|库存|成色|商品状态|地址|联系电话|联系方式)/;
const concretePhysicalGoodsPattern = /(榴莲|水果|牛肉卷|瑞士卷|鸡胸肉|烤鸡|麻薯|蛋糕|耳机|手机|相机|镜头|键盘|鼠标|鞋|平板|显示器|书|咖啡机|滤芯|规格|品种|配送|自提|库存|收货|发货)/;

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
  const normalized = {
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
  return repairVirtualServiceOrder(normalized);
}

function repairVirtualServiceOrder(order: Order): Order {
  if (order.businessType !== "xianyu" || !isVirtualServiceOrder(order)) return order;

  const analysis = order.analysis;
  const signalText = collectOrderText(order);
  const missingInfo = buildVirtualServiceMissingInfo((analysis?.missingInfo || []).filter((item) => !physicalXianyuPattern.test(item)), signalText);
  const itemSummary = repairVirtualItemSummary(order.itemSummary, signalText);
  const reply = needsVirtualReplyRepair(analysis?.reply || "") ? buildVirtualServiceReply(itemSummary, missingInfo, signalText) : analysis.reply;
  const risks = dedupe([
    ...(analysis?.risks || []).filter((item) => !/包邮|物流|快递|收货|发货|库存|成色/.test(item)),
    "虚拟服务需确认需求范围、交付格式、截止时间和修改次数，避免承诺包过、保证原创或无限修改。",
  ]);
  const nextActions = missingInfo.length
    ? [`提醒客户补充：${missingInfo.join("、")}`]
    : ["确认工作量和报价", "确认交付时间后推进成单"];

  return {
    ...order,
    itemSummary,
    status: mapOrderStatus(order.status === "已完成" ? order.status : undefined, missingInfo),
    intentLevel: inferIntentLevel(analysis?.urgency, missingInfo),
    analysis: {
      ...analysis,
      customerIntent: repairVirtualCustomerIntent(analysis?.customerIntent || order.summary, signalText),
      products: repairVirtualProducts(analysis?.products || [], itemSummary),
      missingInfo,
      risks,
      nextActions,
      reply,
      summary: repairVirtualCustomerIntent(analysis?.summary || order.summary, signalText),
    },
  };
}

function collectOrderText(order: Order) {
  return [
    order.orderTitle,
    order.customerName,
    order.platform,
    order.summary,
    order.itemSummary,
    order.note,
    order.rawMessage,
    order.analysis?.customerIntent,
    order.analysis?.summary,
    order.analysis?.reply,
    ...(order.analysis?.products || []).map((item) => `${item.name} ${item.notes || ""}`),
    ...(order.conversation || []).map((turn) => turn.content),
  ]
    .filter(Boolean)
    .join("\n");
}

function isVirtualServiceOrder(order: Order) {
  const text = collectOrderText(order).replace(/待确认虚拟服务/g, "");
  if (concretePhysicalGoodsPattern.test(text)) return false;
  return virtualServicePattern.test(text);
}

function repairVirtualItemSummary(itemSummary: string, signalText = itemSummary) {
  const text = `${itemSummary} ${signalText}`;
  if (/检讨|道歉|致歉/.test(text)) return "道歉检讨书写作服务 x1份";
  if (/PPT|ppt/.test(text)) return "PPT制作/优化服务 x1份";
  if (/简历/.test(text)) return "简历优化服务 x1份";
  if (/文案|小红书|公众号/.test(text)) return "文案写作/优化服务 x1份";
  if (/翻译/.test(text)) return "翻译服务 x1份";
  if (/设计|修图|海报|logo/i.test(text)) return "设计/修图服务 x1份";
  return virtualServicePattern.test(itemSummary) ? itemSummary : "虚拟服务 x1份";
}

function repairVirtualProducts(products: Order["analysis"]["products"], itemSummary: string) {
  const productName = itemSummary.replace(/\s*x?1份?$/i, "").trim() || "虚拟服务";
  if (!products.length || products.some((item) => physicalXianyuPattern.test(item.name))) {
    return [{ name: productName, quantity: "1", unit: "份", notes: "非实体服务", confidence: "中" as const }];
  }
  return products.map((item) => ({
    ...item,
    name: physicalXianyuPattern.test(item.name) ? productName : item.name,
    quantity: item.quantity || "1",
    unit: item.unit || "份",
  }));
}

function repairVirtualCustomerIntent(current: string, signalText: string) {
  if (/检讨|道歉|致歉/.test(signalText)) return "订购道歉检讨书写作服务。";
  if (/文案|小红书|公众号/.test(signalText)) return "咨询文案写作/优化服务。";
  if (/PPT|ppt/.test(signalText)) return "咨询PPT制作/优化服务。";
  if (/简历/.test(signalText)) return "咨询简历优化服务。";
  return current || "咨询虚拟服务。";
}

function buildVirtualServiceMissingInfo(existing: string[], signalText: string) {
  const next = [...existing];
  if (!/(字数|页数|多少字|几页|篇幅|工作量)/.test(signalText)) next.push("字数/页数/工作量");
  if (!/(格式|word|doc|pdf|图片|源文件|交付方式)/i.test(signalText)) next.push("交付格式");
  if (!/(今天|明天|今晚|中午|下午|晚上|截止|什么时候|几点|时间|交稿|交付)/.test(signalText)) next.push("截止时间");
  if (!/(修改|改几次|售后|验收|满意|返工)/.test(signalText)) next.push("修改次数/验收边界");
  return dedupe(next).filter((item) => !physicalXianyuPattern.test(item));
}

function needsVirtualReplyRepair(reply: string) {
  if (!reply.trim()) return true;
  return physicalXianyuPattern.test(reply) || /价格和是否包邮|商品状态|收货地/.test(reply);
}

function buildVirtualServiceReply(itemSummary: string, missingInfo: string[], signalText: string) {
  const serviceName = /检讨|道歉|致歉/.test(signalText) ? "道歉检讨书" : itemSummary.replace(/\s*x?1份?$/i, "") || "这个需求";
  const missingText = missingInfo.length ? missingInfo.join("、") : "交付要求";
  return `可以的，我先帮你看下：${serviceName}。\n\n你补充的事情经过和想表达的歉意我记下了，麻烦再确认一下${missingText}，我好判断工作量并给你报价哈~`;
}

function dedupe(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
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
