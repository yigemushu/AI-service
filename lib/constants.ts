import type { BusinessType, MessageTemplate, OrderStatus, Settings } from "./types";

export const businessTypeLabels: Record<BusinessType, string> = {
  sam: "山姆代下单",
  xianyu: "闲鱼卖货",
  local: "本地服务",
  trade: "外贸询盘",
};

export const businessGuides: Record<BusinessType, string> = {
  sam: "重点识别商品、数量、地址、配送时间、缺货替代、联系方式。回复语气要像私域代下单客服：谨慎确认库存、价格和配送时效。",
  xianyu: "重点识别砍价、商品成色、发货方式、是否包邮、是否急买。回复语气要像闲鱼卖家：自然、简短、避免承诺最低价。",
  local: "重点识别服务类型、预约时间、地点、预算、联系方式。回复语气要像本地服务商：确认上门范围、时间和报价前置条件。",
  trade:
    "重点识别产品、数量、MOQ、目的国家/地区、交期、报价需求。需要生成英文或中英文回复草稿，语气专业、适合外贸询盘。",
};

export const orderStatuses: OrderStatus[] = [
  "待补充",
  "待确认",
  "待报价",
  "待下单",
  "处理中",
  "售后中",
  "已完成",
  "已取消",
];

export const defaultSettings: Settings = {
  systemPrompt:
    "你是一个谨慎的 AI 客服订单助手，只生成客服回复草稿，不自动发送任何消息。请从客户聊天记录中提取客户诉求、所有商品或服务、数量、地址、时间、缺失信息、风险点和下一步动作。客户一条消息中可能包含多个商品，必须逐一提取，不要因为第一个商品识别成功就停止解析。不确定的信息要保留并标记低置信度。",
  merchantRules:
    "不要承诺一定有货、一定送达、最低价或无条件退款。地址、电话、规格、数量、价格、库存和履约时间必须确认后再下单。遇到高价值、售后、退款、投诉或易争议订单要提示人工复核。",
};

const now = "2026-05-28T00:00:00.000Z";

export const defaultTemplates: MessageTemplate[] = [
  {
    id: "tpl_sam_welcome",
    name: "欢迎咨询",
    businessType: "sam",
    scenario: "客户首次咨询山姆商品",
    content: "您好，我可以帮您先确认商品、数量、库存、价格和配送时间。您把想要的商品和地址发我就行。",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tpl_sam_missing",
    name: "信息补全",
    businessType: "sam",
    scenario: "缺少地址、电话、时间或规格",
    content: "我这边还需要您补充一下收货地址、联系电话、期望送达时间和商品规格，确认后再帮您核价和安排。",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tpl_xianyu_price",
    name: "报价说明",
    businessType: "xianyu",
    scenario: "客户砍价或问包邮",
    content: "价格我可以帮您按当前情况确认一下，是否包邮和发货时间也要看收货地与商品状态，确认后再给您准话。",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tpl_local_confirm",
    name: "催付款/催确认",
    businessType: "local",
    scenario: "客户已咨询但未确认预约",
    content: "如果时间和服务内容没问题，您可以先确认预约信息。我这边再根据地点和服务项目给您安排后续。",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tpl_after_sales",
    name: "售后安抚",
    businessType: "sam",
    scenario: "客户催单、退款或售后",
    content: "不好意思让您久等了。我先帮您核对订单状态和处理进度，再根据实际情况给您一个明确回复。",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tpl_trade_quote",
    name: "外贸报价说明",
    businessType: "trade",
    scenario: "外贸客户询价",
    content:
      "Thank you for your inquiry. Please share the required quantity, destination country, delivery terms, and target schedule. We will check pricing, MOQ, and lead time before sending a formal quotation.",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  },
];
