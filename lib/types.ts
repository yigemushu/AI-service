export type BusinessType = "sam" | "xianyu" | "local" | "trade";

export type OrderStatus = "待补充" | "待确认" | "待报价" | "待下单" | "处理中" | "售后中" | "已完成" | "已取消";

export type IntentLevel = "低" | "中" | "高";

export type SourcePlatform = "闲鱼" | "微信" | "淘宝" | "拼多多" | "Facebook" | "eBay" | "其他" | "未识别";

export type AnalyzeResult = {
  customerIntent: string;
  products: Array<{
    name: string;
    quantity: string;
    unit?: string;
    notes?: string;
    confidence?: "高" | "中" | "低";
  }>;
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
  items: Array<{
    name: string;
    quantity: string;
    unit: string;
    note: string;
    confidence: "high" | "medium" | "low";
  }>;
  customer_info: {
    name: string;
    platform: string;
    address: string;
    phone: string;
    preferred_time: string;
  };
  missing_info: string[];
  risk_flags: string[];
  next_action: string[];
  reply: string;
  error?: string;
};

export type Order = {
  id: string;
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
  analysis: AnalyzeResult;
};

export type MessageTemplate = {
  id: string;
  name: string;
  businessType: BusinessType;
  scenario: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OptimizationRecord = {
  id: string;
  rawMessage: string;
  aiOutput: string;
  errorType: string;
  correctResult: string;
  optimized: boolean;
  updatedAt: string;
};

export type Settings = {
  systemPrompt: string;
  merchantRules: string;
};
