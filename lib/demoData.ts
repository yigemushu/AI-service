import type { AnalyzeResult, BusinessType, IntentLevel, Order, OrderStatus, SourcePlatform } from "./types";

const baseDate = new Date();

function daysAgo(days: number) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function makeAnalysis(summary: string, items: string[], missingInfo: string[], risks: string[], reply: string): AnalyzeResult {
  return {
    customerIntent: summary,
    products: items.map((item) => ({ name: item, quantity: "1", confidence: "中" })),
    missingInfo,
    risks,
    nextActions: missingInfo.length > 0 ? ["补齐缺失信息", "确认价格和履约时间"] : ["确认订单信息", "推进下一步"],
    reply,
    summary,
    customerName: "演示客户",
    platform: "微信",
  };
}

function order(id: string, customerName: string, platform: SourcePlatform, businessType: BusinessType, summary: string, itemSummary: string, status: OrderStatus, intentLevel: IntentLevel, note: string, days: number, missingInfo: string[], risks: string[]): Order {
  const createdAt = daysAgo(days);
  return {
    id,
    customerName,
    platform,
    businessType,
    summary,
    itemSummary,
    status,
    intentLevel,
    note,
    createdAt,
    updatedAt: createdAt,
    isNew: days <= 1,
    rawMessage: summary,
    analysis: makeAnalysis(summary, itemSummary.split("、"), missingInfo, risks, "您好，我先帮您确认关键信息后再回复您。"),
  };
}

export const demoOrders: Order[] = [
  order("demo_sam_1", "青秀区李女士", "微信", "sam", "想要瑞士卷一盒和牛肉卷两个，今天下午送青秀区。", "瑞士卷 x1盒、牛肉卷 x2个", "待补充", "高", "缺联系电话，客户时效强。", 0, ["联系电话"], ["客户有当天配送要求，需确认库存和配送能力。"]),
  order("demo_xianyu_1", "闲鱼买家A", "闲鱼", "xianyu", "耳机还能不能便宜，问是否包邮和今天发货。", "蓝牙耳机 x1", "待确认", "高", "客户急买，关注包邮。", 0, ["收货地"], ["议价场景，避免承诺最低价。"]),
  order("demo_local_1", "万象城王女士", "微信", "local", "预约明天下午上门清洗空调，青秀区，问大概多少钱。", "空调清洗 x1", "待报价", "高", "待确认机型和楼层。", 0, ["联系电话", "空调类型"], ["上门服务需确认地址和服务范围。"]),
  order("demo_trade_1", "Malaysia Buyer", "Facebook", "trade", "Need 500 stainless steel water bottles, quote FOB and delivery time to Malaysia.", "stainless steel water bottle x500", "待报价", "高", "需要确认规格、港口和包装。", 1, ["specification", "destination port"], ["外贸报价需确认 MOQ、交期和贸易条款。"]),
];
