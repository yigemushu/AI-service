export type BusinessType = "sam" | "xianyu" | "virtual" | "local" | "trade";

export type OrderStatus = "待补充" | "待确认" | "待报价" | "待下单" | "处理中" | "售后中" | "已完成" | "已取消";

export type IntentLevel = "低" | "中" | "高";

export type SourcePlatform = "闲鱼" | "微信" | "淘宝" | "拼多多" | "Facebook" | "eBay" | "其他" | "未识别";

export type InboxStatus = "未处理" | "已分析" | "已回复" | "待补信息" | "已成单" | "无效咨询";
export type InboxSourceChannel = "网站手动" | "浏览器插件" | "安卓助手" | "iPhone快捷入口" | "官方接口" | "Webhook" | "其他";

export type AnalyzeResult = {
  customerIntent: string;
  products: Array<{ name: string; quantity: string; unit?: string; notes?: string; confidence?: "高" | "中" | "低" }>;
  missingInfo: string[];
  risks: string[];
  nextActions: string[];
  reply: string;
  summary: string;
  customerName: string;
  platform: string;
  orderStatus?: string;
  urgency?: "low" | "medium" | "high";
};

export type AnalyzeApiResponse = {
  summary: string;
  customer_intent: string;
  order_status: string;
  urgency: "low" | "medium" | "high";
  items: Array<{ name: string; quantity: string; unit: string; note: string; confidence: "high" | "medium" | "low" }>;
  customer_info: { name: string; platform: string; address: string; phone: string; preferred_time: string };
  missing_info: string[];
  risk_flags: string[];
  next_action: string[];
  reply: string;
  error?: string;
};

export type ConversationTurn = {
  id: string;
  role: "customer" | "assistant" | "seller_note";
  content: string;
  createdAt: string;
};

export type OutboundReplyStatus = "pending" | "processing" | "filled" | "sent" | "failed" | "cancelled";

export type OutboundReplyCommand = {
  id: string;
  messageId?: string;
  orderId?: string;
  customerFolder: string;
  customerName: string;
  platform: SourcePlatform | string;
  sourceUrl: string;
  reply: string;
  mode: "fill" | "send" | "plugin-default";
  status: OutboundReplyStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrowserPluginStatusKind = "config" | "autoSync" | "outbound";

export type BrowserPluginStatus = {
  id: string;
  kind: BrowserPluginStatusKind;
  ok: boolean;
  platform: SourcePlatform | string;
  sourceUrl?: string;
  commandId?: string;
  messageId?: string;
  mode?: "fill" | "send" | "plugin-default" | string;
  action?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderHistoryEvent = {
  id: string;
  type: "created" | "status_changed" | "reply_generated" | "follow_up" | "note_updated" | "completed";
  title: string;
  detail: string;
  createdAt: string;
};

export type Order = {
  id: string;
  orderTitle?: string;
  customerFolder?: string;
  customerName: string;
  platform: SourcePlatform | string;
  businessType: BusinessType;
  summary: string;
  itemSummary: string;
  status: OrderStatus;
  intentLevel: IntentLevel;
  note: string;
  createdAt: string;
  updatedAt: string;
  isNew: boolean;
  rawMessage: string;
  sourceUrl?: string;
  analysis: AnalyzeResult;
  conversation?: ConversationTurn[];
  history?: OrderHistoryEvent[];
};

export type CustomerMessage = {
  id: string;
  customerFolder?: string;
  linkedOrderId?: string;
  productName?: string;
  productConfirmed?: boolean;
  productGuess?: string;
  productConfidence?: number;
  productRecognitionStatus?: "待确认" | "已确认" | "自动识别";
  productRecognitionRuleId?: string;
  customerName: string;
  platform: SourcePlatform | string;
  sourceChannel?: InboxSourceChannel;
  businessType: BusinessType;
  rawMessage: string;
  sourceUrl: string;
  status: InboxStatus;
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
  analysis?: AnalyzeResult;
  conversation?: ConversationTurn[];
};

export type RecognitionExperience = {
  id: string;
  businessType: BusinessType;
  keywords: string[];
  productName: string;
  subCategory: string;
  correctCount: number;
  wrongCount: number;
  confidence: number;
  autoConfirm: boolean;
  updatedAt: string;
};

export type MessageTemplate = {
  id: string;
  name: string;
  businessType: BusinessType;
  scenario: string;
  requiredInfo?: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeRule = {
  id: string;
  title: string;
  businessType: BusinessType | "all";
  category: "商品库存" | "价格报价" | "配送履约" | "售后退款" | "话术禁区" | "其他";
  content: string;
  enabled: boolean;
  updatedAt: string;
};

export type FeedbackRecord = {
  id: string;
  testerName: string;
  role: string;
  scenario: string;
  rating: number;
  willingnessToPay: "愿意付费" | "再观望" | "暂不愿意";
  feedback: string;
  contact: string;
  createdAt: string;
};

export type OptimizationRecord = {
  id: string;
  source?: "manual" | "evaluation";
  sampleId?: string;
  businessType?: BusinessType;
  rawMessage: string;
  aiOutput: string;
  errorType: string;
  correctResult: string;
  improvementAction?: string;
  status?: "待优化" | "已优化" | "已复测";
  priority?: "高" | "中" | "低";
  optimized: boolean;
  updatedAt: string;
};

export type XianyuMvpVerificationRecord = {
  id: string;
  createdAt: string;
  accepted: boolean;
  pendingCount: number;
  testSessionSummary?: string;
  testSessionAccepted?: boolean;
  testSessionPendingCount?: number;
  testEvidenceItems?: Array<{ label: string; ok: boolean; detail: string }>;
  latestMessageSummary: string;
  latestCommandSummary: string;
  latestConfigSummary?: string;
  latestAutoSyncSummary?: string;
  latestOutboundPluginSummary?: string;
  acceptanceItems: Array<{ label: string; ok: boolean; detail: string }>;
  diagnosticItems: Array<{ label: string; ok: boolean; detail: string }>;
};

export type XianyuMvpTestSession = {
  id: string;
  createdAt: string;
  code: string;
  buyerMessage: string;
};

export type EvaluationRun = {
  id: string;
  sampleGroup: "基础" | "刁钻" | "全部";
  createdAt: string;
  average: number;
  totalSamples: number;
  totalScore: number;
  totalPossible: number;
  byType: Record<BusinessType, { count: number; average: number }>;
  metricFails: Record<string, number>;
  results: Array<{
    sampleId: string;
    businessType: BusinessType;
    title: string;
    message: string;
    score: number;
    failedMetrics: string[];
    outputSummary?: string;
    outputReply?: string;
    outputStatus?: string;
  }>;
};

export type Settings = {
  systemPrompt: string;
  merchantRules: string;
  inboxWebhookToken?: string;
};
