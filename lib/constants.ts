import type { BusinessType, MessageTemplate, OrderStatus, Settings } from "./types";

export const businessTypeLabels: Record<BusinessType, string> = {
  sam: "山姆代下单",
  xianyu: "闲鱼卖货",
  local: "本地服务",
  trade: "外贸询盘",
};

export const businessGuides: Record<BusinessType, string> = {
  sam: "重点识别商品、数量、地址、配送时间、缺货替代、联系方式。",
  xianyu: "重点识别砍价、商品成色、发货方式、是否包邮、是否急买。",
  local: "重点识别服务类型、预约时间、地点、预算、联系方式。",
  trade: "重点识别产品、数量、MOQ、目的国家/地区、交期、报价需求。",
};

export const orderStatuses: OrderStatus[] = ["待补充", "待确认", "待报价", "待下单", "处理中", "售后中", "已完成", "已取消"];

export const defaultSettings: Settings = {
  systemPrompt: "你是一个谨慎但有温度的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。请提取客户诉求、商品/服务、数量、地址、时间、缺失信息、风险点和下一步动作。给客户看的推荐回复要短、自然、像真人商家，中文场景可在整段最后一句少量使用 ~，不要每句话都加。",
  merchantRules: "不要承诺一定有货、一定送达、最低价或无条件退款。地址、电话、规格、数量、价格、库存和履约时间必须确认后再下单。",
};

const now = "2026-05-28T00:00:00.000Z";

export const defaultTemplates: MessageTemplate[] = [
  { id: "tpl_sam_missing", name: "信息补全", businessType: "sam", scenario: "缺少地址、电话、时间或规格", content: "可以的哦，我先帮你看一下。\n\n麻烦你发我一下详细地址、电话和期望送达时间，我确认下今天能不能安排、以及现在有没有货~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_xianyu_price", name: "报价说明", businessType: "xianyu", scenario: "客户砍价或问包邮", content: "可以的，我先帮你确认下。\n\n价格和包邮要看收货地跟商品情况，我看完再给你准话哈~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_local_confirm", name: "预约确认", businessType: "local", scenario: "客户咨询上门服务", content: "可以的，我先帮你看一下。\n\n麻烦你发我服务地址和方便的时间，我确认下师傅能不能安排、再给你报价~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_trade_quote", name: "外贸报价说明", businessType: "trade", scenario: "外贸客户询价", content: "Thank you for your inquiry. Please share quantity, destination country, delivery terms, and target schedule. We will check pricing, MOQ, and lead time before sending a formal quotation.", enabled: true, createdAt: now, updatedAt: now },
];
