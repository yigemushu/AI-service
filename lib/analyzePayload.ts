import type { BusinessType, ConversationTurn, KnowledgeRule, MessageTemplate, Order, Settings } from "./types";
import { businessTypeLabels } from "./constants";
import { formatItemSummary } from "./format";

export type AnalyzePayloadMode = "standard" | "order-followup" | "regenerate";

export const promptVersion = "shared-analyze-v2";

const virtualServicePattern =
  /(写作|代写|润色|改写|文案|小红书|公众号|脚本|检讨书|道歉|致歉|演讲稿|发言稿|申请书|读后感|观后感|PPT|ppt|简历|求职信|翻译|海报|logo|设计|修图|排版|AI生成|提示词|prompt|课程作业|报告|方案|咨询|字数|页数|交稿|交付|修改几次|源文件)/i;

const physicalGoodsPattern =
  /(榴莲|水果|牛肉卷|瑞士卷|鸡胸肉|烤鸡|麻薯|蛋糕|耳机|手机|相机|镜头|键盘|鼠标|鞋|平板|显示器|书|咖啡机|滤芯|商品|库存|规格|品种|配送|自提|收货|发货|快递|包邮)/;

export function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function isVirtualServiceText(text: string) {
  return virtualServicePattern.test(text) && !isPhysicalGoodsText(text);
}

export function isPhysicalGoodsText(text: string) {
  return physicalGoodsPattern.test(text);
}

export function shouldUseVirtualRules(businessType: BusinessType, text: string) {
  if (businessType === "virtual") return true;
  if (businessType !== "xianyu") return false;
  return isVirtualServiceText(text);
}

export function compactTemplates(templates: MessageTemplate[], businessType: BusinessType, signalText: string) {
  const useVirtualRules = shouldUseVirtualRules(businessType, signalText);
  return templates
    .filter((template) => template.enabled && (template.businessType === businessType || (useVirtualRules && template.businessType === "virtual")))
    .map(({ name, scenario, requiredInfo, content }) => ({
      name: safeString(name),
      scenario: safeString(scenario),
      requiredInfo: safeString(requiredInfo),
      content: safeString(content),
    }));
}

export function compactKnowledgeRules(rules: KnowledgeRule[], businessType: BusinessType, signalText: string) {
  const useVirtualRules = shouldUseVirtualRules(businessType, signalText);
  return rules
    .filter((rule) => rule.enabled && (rule.businessType === "all" || rule.businessType === businessType || (useVirtualRules && rule.businessType === "virtual")))
    .map(({ title, category, content }) => ({
      title: safeString(title),
      category: safeString(category),
      content: safeString(content),
    }));
}

export function buildOrderAnalyzeText(order: Order, input: { mode: AnalyzePayloadMode; latestCustomerMessage?: string; conversationHistory: ConversationTurn[] }) {
  const originalCustomerMessage = safeString(order.rawMessage);
  const latestCustomerMessage = safeString(input.latestCustomerMessage);
  const existingItems = order.analysis?.products?.length ? formatItemSummary(order.analysis.products) : safeString(order.itemSummary);
  const historyText = input.conversationHistory
    .map((turn, index) => `${index + 1}. ${turn.role === "assistant" ? "商家已发送回复" : turn.role === "seller_note" ? "商家备注" : "客户消息"}：${safeString(turn.content)}`)
    .join("\n");

  return [
    `promptVersion: ${promptVersion}`,
    `mode: ${input.mode}`,
    "这是同一个客户订单的持续分析。请复用工作台/消息中心同一套识别策略，不要使用旧测试样板。",
    "先判断客户需求属于实物商品、虚拟服务、本地服务还是外贸询盘，再决定缺失信息和回复语气。",
    "如果是实物商品，如榴莲、水果、牛肉卷、耳机，不要输出“待确认虚拟服务”，不要询问虚拟服务的字数、素材、交付格式。",
    "如果是虚拟服务，如检讨书、道歉信、文案优化，不要询问收货地址、快递、包邮。",
    "重新生成回复时必须重新生成 reply，但不要把候选回复当成已发送历史。",
    "",
    `businessType: ${order.businessType}`,
    `业务类型：${businessTypeLabels[order.businessType]}`,
    `platform: ${safeString(order.platform)}`,
    `customerInfo: ${[order.customerName, order.platform, order.status].filter(Boolean).join(" / ")}`,
    `currentOrderSummary: ${safeString(order.summary || order.analysis?.summary)}`,
    `existingItems: ${existingItems}`,
    `missingInfo: ${(order.analysis?.missingInfo || []).join("、") || "暂无"}`,
    `riskFlags: ${(order.analysis?.risks || []).join("、") || "暂无"}`,
    "",
    "originalCustomerMessage:",
    originalCustomerMessage,
    "",
    latestCustomerMessage ? ["latestCustomerMessage:", latestCustomerMessage, ""].join("\n") : "",
    "conversationHistory:",
    historyText || originalCustomerMessage,
  ].filter(Boolean).join("\n");
}

export function buildAnalyzePayload(input: {
  chatText: string;
  businessType: BusinessType;
  settings: Settings;
  templates: MessageTemplate[];
  knowledgeRules: KnowledgeRule[];
  mode?: AnalyzePayloadMode;
  platform?: string;
  order?: Order;
  latestCustomerMessage?: string;
  conversationHistory?: ConversationTurn[];
}) {
  const signalText = [
    input.chatText,
    input.latestCustomerMessage,
    input.order?.rawMessage,
    input.order?.summary,
    input.order?.itemSummary,
    ...(input.order?.analysis?.products || []).map((item) => item.name),
  ].filter(Boolean).join("\n");
  const enabledTemplates = compactTemplates(input.templates, input.businessType, signalText);
  const knowledgeRules = compactKnowledgeRules(input.knowledgeRules, input.businessType, signalText);
  const mode = input.mode === "order-followup" ? "continue" : input.mode === "regenerate" ? "regenerate" : "standard";

  return {
    chatText: input.order
      ? buildOrderAnalyzeText(input.order, { mode: input.mode || "standard", latestCustomerMessage: input.latestCustomerMessage, conversationHistory: input.conversationHistory || [] })
      : safeString(input.chatText),
    mode,
    businessType: input.businessType,
    platform: input.platform || input.order?.platform,
    originalCustomerMessage: input.order?.rawMessage,
    latestCustomerMessage: input.latestCustomerMessage,
    currentMessage: input.latestCustomerMessage,
    conversationHistory: input.conversationHistory,
    currentOrderSummary: input.order?.summary || input.order?.analysis?.summary,
    orderSummary: input.order?.summary || input.order?.analysis?.summary,
    existingItems: input.order?.analysis?.products || [],
    items: input.order?.itemSummary || (input.order?.analysis?.products ? formatItemSummary(input.order.analysis.products) : ""),
    customerInfo: input.order ? [input.order.customerName, input.order.platform, input.order.status].filter(Boolean).join(" / ") : undefined,
    missingInfo: input.order?.analysis?.missingInfo,
    riskFlags: input.order?.analysis?.risks,
    systemPrompt: safeString(input.settings.systemPrompt),
    sellerRules: safeString(input.settings.merchantRules),
    enabledTemplates,
    knowledgeRules,
    knowledgeBase: knowledgeRules,
    responseMode: "fast" as const,
    promptVersion,
  };
}
