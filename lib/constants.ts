import type { BusinessType, KnowledgeRule, MessageTemplate, OrderStatus, Settings } from "./types";

export const businessTypeLabels: Record<BusinessType, string> = {
  sam: "山姆代下单",
  xianyu: "闲鱼卖货",
  local: "本地服务",
  trade: "外贸询盘",
};

export const businessGuides: Record<BusinessType, string> = {
  sam: "重点识别商品、数量、地址、配送时间、缺货替代、联系方式。",
  xianyu: "同时覆盖实物和虚拟服务。实物重点识别砍价、成色、发货、包邮；虚拟服务重点识别写作/润色/PPT/简历/设计等服务内容、交付格式、截止时间、素材和修改次数。",
  local: "重点识别服务类型、预约时间、地点、预算、联系方式。",
  trade: "重点识别产品、数量、MOQ、目的国家/地区、交期、报价需求。",
};

export const orderStatuses: OrderStatus[] = ["待补充", "待确认", "待报价", "待下单", "处理中", "售后中", "已完成", "已取消"];

export const defaultSettings: Settings = {
  systemPrompt: "你是一个谨慎但有温度的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。请提取客户诉求、商品/服务、数量、地址、时间、缺失信息、风险点和下一步动作。给客户看的推荐回复要短、自然、像真人商家，中文场景可在整段最后一句少量使用 ~，不要每句话都加。",
  merchantRules: "不要承诺一定有货、一定送达、最低价或无条件退款。地址、电话、规格、数量、价格、库存和履约时间必须确认后再下单。",
};

const now = "2026-05-28T00:00:00.000Z";

export const defaultKnowledgeRules: KnowledgeRule[] = [
  {
    id: "rule_stock_confirm",
    title: "库存与时效必须二次确认",
    businessType: "sam",
    category: "商品库存",
    content: "山姆商品、库存、价格和配送时间均以人工确认结果为准，回复中不要承诺一定有货或一定送达。",
    enabled: true,
    updatedAt: now,
  },
  {
    id: "rule_xianyu_price",
    title: "闲鱼议价底线",
    businessType: "xianyu",
    category: "价格报价",
    content: "遇到砍价、包邮、催发货，先确认商品成色、收货地和发货方式，不承诺最低价。",
    enabled: true,
    updatedAt: now,
  },
  {
    id: "rule_xianyu_virtual_service",
    title: "闲鱼虚拟服务交付边界",
    businessType: "xianyu",
    category: "其他",
    content: "遇到写作、润色、检讨书、道歉信、PPT、简历、设计、AI生成、咨询等非实体服务时，不要按实物要求收货地址、包邮、库存或发货；需先确认需求范围、字数/页数、素材、交付格式、截止时间、修改次数、是否可商用及报价边界，不承诺包过、保原创、百分百满意或无限修改。",
    enabled: true,
    updatedAt: now,
  },
  {
    id: "rule_local_booking",
    title: "本地服务预约前置条件",
    businessType: "local",
    category: "配送履约",
    content: "上门服务需要确认服务地址、楼层/停车、预约时间、服务范围和联系方式后再报价。",
    enabled: true,
    updatedAt: now,
  },
  {
    id: "rule_trade_quote",
    title: "外贸报价信息",
    businessType: "trade",
    category: "价格报价",
    content: "外贸询盘回复需确认产品规格、数量、目的国家、贸易条款、MOQ、交期，正式报价前不要给最终价格。",
    enabled: true,
    updatedAt: now,
  },
];

export const defaultTemplates: MessageTemplate[] = [
  { id: "tpl_sam_missing", name: "信息补全", businessType: "sam", scenario: "缺少地址、电话、时间或规格", requiredInfo: "详细地址\n联系电话\n期望送达时间\n商品规格/数量", content: "可以的哦，我先帮你看一下。\n\n麻烦你发我一下详细地址、电话和期望送达时间，我确认下今天能不能安排、以及现在有没有货~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_xianyu_price", name: "报价说明", businessType: "xianyu", scenario: "客户砍价或问包邮", requiredInfo: "收货地\n是否自提\n商品规格/成色确认", content: "可以的，我先帮你确认下。\n\n价格和包邮要看收货地跟商品情况，我看完再给你准话哈~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_xianyu_virtual_service", name: "虚拟服务确认", businessType: "xianyu", scenario: "写作、润色、检讨书、道歉信、PPT、简历、设计、AI生成等非实体服务", requiredInfo: "具体内容/事件经过\n用途/使用场景\n字数/页数/工作量\n语气风格\n截止时间\n交付格式\n修改次数/验收边界", content: "可以的，我先帮你看下需求。\n\n麻烦你发我具体内容、用途/场景、字数/页数、想要的语气风格、截止时间和需要的格式，我确认工作量后给你报价哈~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_local_confirm", name: "预约确认", businessType: "local", scenario: "客户咨询上门服务", requiredInfo: "服务地址\n预约时间\n服务范围\n联系方式", content: "可以的，我先帮你看一下。\n\n麻烦你发我服务地址和方便的时间，我确认下师傅能不能安排、再给你报价~", enabled: true, createdAt: now, updatedAt: now },
  { id: "tpl_trade_quote", name: "外贸报价说明", businessType: "trade", scenario: "外贸客户询价", requiredInfo: "quantity\nproduct specification\ndestination country/port\ntrade terms\nrequired delivery time", content: "Thank you for your inquiry. Please share quantity, destination country, delivery terms, and target schedule. We will check pricing, MOQ, and lead time before sending a formal quotation.", enabled: true, createdAt: now, updatedAt: now },
];

export function mergeDefaultTemplates(templates: MessageTemplate[]) {
  const existingIds = new Set(templates.map((template) => template.id));
  const missingDefaults = defaultTemplates.filter((template) => !existingIds.has(template.id));
  const upgraded = templates.map((template) => {
    const defaultTemplate = defaultTemplates.find((item) => item.id === template.id);
    if (!defaultTemplate || template.requiredInfo) return template;
    return { ...template, requiredInfo: defaultTemplate.requiredInfo, updatedAt: new Date().toISOString() };
  });
  return [...upgraded, ...missingDefaults];
}
