"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultKnowledgeRules, mergeDefaultTemplates } from "@/lib/constants";
import { buildAnalyzePayload, isPhysicalGoodsText, isVirtualServiceText } from "@/lib/analyzePayload";
import { formatItemSummary } from "@/lib/format";
import { buildOrderTitle, createOrderHistoryEvent, inferIntentLevel, mapOrderStatus, normalizeOrder } from "@/lib/orderUtils";
import { createId, getCustomerMessages, getKnowledgeRules, getOrders, getRecognitionExperiences, getSettings, getTemplates, getWebhookTokenForClient, saveCustomerMessages, saveKnowledgeRules, saveOrders, saveRecognitionExperiences, saveTemplates } from "@/lib/storage";
import type { AnalyzeApiResponse, AnalyzeResult, BusinessType, ConversationTurn, CustomerMessage, InboxConversation, InboxStatus, Order, OutboundReplyCommand, OutboundReplyStatus, RecognitionExperience, SourcePlatform } from "@/lib/types";

type MainColumn = "highIntent" | "sam" | "xianyu" | "local" | "trade" | "closed" | "archived";

type CustomerFolderGroup = {
  folder: string;
  messages: CustomerMessage[];
  latest: CustomerMessage;
};

type ProductGuess = {
  productName: string;
  subCategory: string;
  confidence: number;
  source: "经验自动识别" | "经验待确认" | "系统猜测" | "待确认";
  ruleId?: string;
  autoConfirm: boolean;
  reason: string;
};

const platformOptions: Array<SourcePlatform | string> = ["闲鱼", "微信", "淘宝", "拼多多", "Facebook", "eBay", "其他"];

const outboundStatusLabels: Record<OutboundReplyStatus, string> = {
  pending: "待插件处理",
  processing: "插件处理中",
  filled: "已回填输入框",
  sent: "已发送",
  failed: "发送失败",
  cancelled: "已取消",
};

const mainColumns: Array<{ id: MainColumn; label: string; description: string }> = [
  { id: "highIntent", label: "高意向客户", description: "优先处理接近成交的客户" },
  { id: "sam", label: "山姆代购", description: "山姆/代下单客户文件夹" },
  { id: "xianyu", label: "闲鱼卖货", description: "实物买卖、虚拟服务、售后纠纷" },
  { id: "local", label: "本地服务", description: "上门、预约、同城服务" },
  { id: "trade", label: "外贸询盘", description: "报价、目的港、贸易条款" },
  { id: "closed", label: "已成交订单", description: "已经成单或完成的客户" },
  { id: "archived", label: "已归档", description: "暂时不处理或无效咨询" },
];

const sampleMessages: CustomerMessage[] = [
  {
    id: "msg_demo_xianyu",
    customerFolder: "闲鱼买家A",
    customerName: "闲鱼买家A",
    platform: "闲鱼",
    sourceChannel: "浏览器插件",
    businessType: "xianyu",
    rawMessage: "最低多少？能不能包邮，今天拍今天能发吗？耳机电池还行不行？",
    sourceUrl: "https://www.goofish.com/",
    status: "未处理",
    isNew: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "msg_demo_sam",
    customerFolder: "青秀区客户",
    customerName: "青秀区客户",
    platform: "微信",
    sourceChannel: "安卓助手",
    businessType: "sam",
    rawMessage: "想要一盒瑞士卷两个牛肉卷，下午六点前能送到吗？价格多少？",
    sourceUrl: "",
    status: "未处理",
    isNew: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (!url.pathname || url.pathname === "/") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/)[0] || "";
  }
}

function isUsableCustomerName(value: string) {
  const name = normalizeKeyPart(value);
  return Boolean(name && name !== "待识别客户" && !["闲鱼", "咸鱼", "goofish", "消息", "聊天"].includes(name));
}

function getFolderName(message: Pick<CustomerMessage, "customerFolder" | "customerName">) {
  return (message.customerFolder || (isUsableCustomerName(message.customerName || "") ? message.customerName : "待归类")).trim() || "待归类";
}

function getMessageContactKey(message: Pick<CustomerMessage, "customerName" | "platform" | "sourceUrl"> & Partial<Pick<CustomerMessage, "customerFolder">>) {
  const platform = normalizeKeyPart(String(message.platform || "未识别"));
  const folder = normalizeKeyPart(getFolderName(message));
  if (folder && folder !== "待归类") return `${platform}:folder:${folder}`;
  const customerName = normalizeKeyPart(message.customerName || "");
  if (isUsableCustomerName(message.customerName || "")) return `${platform}:name:${customerName}`;
  const sourceUrl = normalizeSourceUrl(message.sourceUrl || "");
  if (sourceUrl) return `${platform}:url:${sourceUrl}`;
  return "";
}

function appendRawMessage(previous: string, next: string, createdAt: string) {
  if (!previous.trim()) return next;
  if (previous.includes(next)) return previous;
  return `${previous}\n\n[客户新消息 ${new Date(createdAt).toLocaleString()}]\n${next}`;
}

function getMessageConversation(message: CustomerMessage): ConversationTurn[] {
  return message.conversation?.length
    ? message.conversation
    : [{ id: `${message.id}_initial`, role: "customer", content: message.rawMessage, createdAt: message.createdAt }];
}

function mergeCustomerMessages(existing: CustomerMessage[], incoming: CustomerMessage[], orders: Order[] = []) {
  const byId = new Map(existing.map((message) => [message.id, message]));
  const orderedIds = existing.map((message) => message.id);
  let changedCount = 0;
  let firstTouchedId = "";

  for (const message of incoming) {
    const contactKey = getMessageContactKey(message);
    const sameContact = contactKey
      ? [...byId.values()].find((item) => item.id !== message.id && getMessageContactKey(item) === contactKey && !isClosed(item, orders))
      : undefined;
    const current = byId.get(message.id) || sameContact;

    if (current) {
      const conversation = message.conversation?.length
        ? message.conversation
        : [
            ...getMessageConversation(current),
            { id: `${message.id}_customer_${message.updatedAt}`, role: "customer" as const, content: message.rawMessage, createdAt: message.updatedAt },
          ];
      const updated: CustomerMessage = {
        ...current,
        ...message,
        id: current.id,
        customerName: current.customerName === "待识别客户" ? message.customerName : current.customerName,
        customerFolder: current.customerFolder || message.customerFolder || message.customerName,
        rawMessage: message.id === current.id ? message.rawMessage : appendRawMessage(current.rawMessage, message.rawMessage, message.updatedAt),
        sourceUrl: current.sourceUrl || message.sourceUrl,
        analysis: message.analysis || current.analysis,
        conversation,
        isNew: message.isNew || current.isNew,
        updatedAt: message.updatedAt > current.updatedAt ? message.updatedAt : current.updatedAt,
      };
      byId.set(current.id, updated);
      firstTouchedId ||= current.id;
      changedCount += 1;
      if (message.id !== current.id) byId.delete(message.id);
    } else {
      const nextMessage = hasClosedSameContact(message, [...byId.values()], orders)
        ? { ...message, customerFolder: buildNewOrderFolderName(message) }
        : message;
      byId.set(nextMessage.id, nextMessage);
      orderedIds.unshift(message.id);
      firstTouchedId ||= nextMessage.id;
      changedCount += 1;
    }
  }

  const seen = new Set<string>();
  const ordered = orderedIds
    .filter((id) => byId.has(id) && !seen.has(id) && seen.add(id))
    .map((id) => byId.get(id) as CustomerMessage);
  const missingNew = [...byId.values()].filter((message) => !seen.has(message.id));
  return { messages: [...missingNew, ...ordered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), changedCount, firstTouchedId };
}

function isUnread(message: CustomerMessage) {
  return message.isNew;
}

function isArchived(message: CustomerMessage) {
  return message.status === "无效咨询";
}

function isClosed(message: CustomerMessage, orders: Order[]) {
  const linkedOrder = orders.find((order) => order.id === message.linkedOrderId);
  return linkedOrder?.status === "已完成";
}

function hasClosedSameContact(message: CustomerMessage, existing: CustomerMessage[], orders: Order[]) {
  const contactKey = getMessageContactKey(message);
  if (!contactKey) return false;
  return existing.some((item) => getMessageContactKey(item) === contactKey && isClosed(item, orders));
}

function buildNewOrderFolderName(message: CustomerMessage) {
  const base = getFolderName(message);
  const stamp = new Date(message.updatedAt || Date.now()).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${base} - 新咨询 ${stamp}`;
}

function isHighIntent(message: CustomerMessage, orders: Order[]) {
  const linkedOrder = orders.find((order) => order.id === message.linkedOrderId);
  const text = [message.rawMessage, message.analysis?.summary, message.analysis?.customerIntent].filter(Boolean).join(" ");
  return (
    message.analysis?.urgency === "high" ||
    linkedOrder?.intentLevel === "高" ||
    /(现在拍|马上|今天|今晚|明天|多少钱|报价|能做吗|能送吗|下单|付款|地址|电话|几件|几个|截止|急)/.test(text)
  );
}

function isVirtualXianyu(message: CustomerMessage) {
  const text = [message.productName, message.productGuess, message.rawMessage, message.analysis?.summary, message.analysis?.customerIntent, ...(message.analysis?.products || []).map((item) => item.name)].join(" ");
  return isVirtualServiceText(text);
}

function getRecognitionText(group: CustomerFolderGroup) {
  return group.messages
    .map((message) => [message.rawMessage, message.analysis?.summary, message.analysis?.customerIntent, ...(message.analysis?.products || []).map((item) => item.name)].filter(Boolean).join(" "))
    .join(" ");
}

function extractLearningKeywords(text: string, productName: string) {
  const candidates = [
    "道歉检讨书",
    "检讨书",
    "道歉信",
    "致歉信",
    "挽回文案",
    "表白文案",
    "情感文案",
    "小红书文案",
    "朋友圈文案",
    "PPT",
    "简历",
    "翻译",
    "设计",
    "修图",
    "报告",
    "方案",
    "提示词",
    "prompt",
    "牛肉卷",
    "瑞士卷",
    "蛋糕",
    "耳机",
    "手机",
    "相机",
    "电脑",
    "iPad",
    "Switch",
  ];
  const source = `${text} ${productName}`;
  const matched = candidates.filter((keyword) => source.toLowerCase().includes(keyword.toLowerCase()));
  if (matched.length) return Array.from(new Set(matched)).slice(0, 6);
  return Array.from(new Set(productName.split(/[、\s/，,]+/).filter((item) => item.length >= 2))).slice(0, 4);
}

function inferSystemGuess(text: string, businessType: BusinessType): ProductGuess {
  if (/道歉检讨书|检讨书|道歉信|致歉信/.test(text)) {
    return { productName: "道歉检讨书写作服务", subCategory: "虚拟服务", confidence: 0.72, source: "系统猜测", autoConfirm: false, reason: "客户提到道歉/检讨书相关需求" };
  }
  if (/挽回|复合|分手|女朋友|男朋友|感情|表白/.test(text)) {
    return { productName: "情感文案写作服务", subCategory: "虚拟服务", confidence: 0.64, source: "系统猜测", autoConfirm: false, reason: "客户提到情感表达或挽回场景" };
  }
  if (/小红书|朋友圈|公众号|文案|种草/.test(text)) {
    return { productName: "文案写作/优化服务", subCategory: "虚拟服务", confidence: 0.68, source: "系统猜测", autoConfirm: false, reason: "客户提到文案平台或内容优化" };
  }
  if (/PPT|ppt|幻灯片|演示文稿/.test(text)) {
    return { productName: "PPT制作/优化服务", subCategory: "虚拟服务", confidence: 0.7, source: "系统猜测", autoConfirm: false, reason: "客户提到PPT或演示文稿" };
  }
  if (/简历|求职|自我介绍/.test(text)) {
    return { productName: "简历优化服务", subCategory: "虚拟服务", confidence: 0.7, source: "系统猜测", autoConfirm: false, reason: "客户提到简历或求职材料" };
  }
  if (/牛肉卷|瑞士卷|榴莲|山姆|蛋糕|烤鸡/.test(text)) {
    return { productName: "山姆代购商品", subCategory: "山姆代购", confidence: 0.62, source: "系统猜测", autoConfirm: false, reason: "客户提到山姆常见商品" };
  }
  if (businessType === "xianyu" && isVirtualServiceText(text)) {
    return { productName: "待确认虚拟服务", subCategory: "虚拟服务", confidence: 0.52, source: "系统猜测", autoConfirm: false, reason: "客户描述更像非实体服务" };
  }
  return { productName: "待确认需求", subCategory: "待确认", confidence: 0.2, source: "待确认", autoConfirm: false, reason: "暂时没有足够信息，建议先人工确认" };
}

function inferProductGuess(group: CustomerFolderGroup, experiences: RecognitionExperience[]): ProductGuess {
  const confirmed = group.messages.find((message) => message.productConfirmed && message.productName);
  if (confirmed?.productName) {
    return { productName: confirmed.productName, subCategory: getSubCategory(confirmed, confirmed.businessType as MainColumn), confidence: 1, source: "经验自动识别", ruleId: confirmed.productRecognitionRuleId, autoConfirm: true, reason: "这个客户文件夹已经人工确认过" };
  }
  const text = getRecognitionText(group);
  const matchedRule = experiences
    .filter((rule) => rule.businessType === group.latest.businessType && rule.keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase())))
    .sort((a, b) => b.confidence - a.confidence || b.correctCount - a.correctCount)[0];
  if (matchedRule) {
    return {
      productName: matchedRule.productName,
      subCategory: matchedRule.subCategory,
      confidence: matchedRule.confidence,
      source: matchedRule.autoConfirm ? "经验自动识别" : "经验待确认",
      ruleId: matchedRule.id,
      autoConfirm: matchedRule.autoConfirm,
      reason: `命中历史经验：${matchedRule.keywords.join("、")}`,
    };
  }
  return inferSystemGuess(text, group.latest.businessType);
}

function upsertRecognitionExperience(experiences: RecognitionExperience[], group: CustomerFolderGroup, productName: string, subCategory: string, wasCorrect: boolean, existingRuleId?: string) {
  const now = new Date().toISOString();
  const text = getRecognitionText(group);
  const keywords = extractLearningKeywords(text, productName);
  const matchedIndex = experiences.findIndex((rule) => rule.id === existingRuleId || (rule.businessType === group.latest.businessType && rule.productName === productName && rule.keywords.some((keyword) => keywords.includes(keyword))));
  if (matchedIndex >= 0) {
    const current = experiences[matchedIndex];
    const correctCount = current.correctCount + (wasCorrect ? 1 : 0);
    const wrongCount = current.wrongCount + (wasCorrect ? 0 : 1);
    const confidence = Math.min(0.99, Math.max(0.15, correctCount / Math.max(1, correctCount + wrongCount)));
    const updated: RecognitionExperience = {
      ...current,
      keywords: Array.from(new Set([...current.keywords, ...keywords])).slice(0, 10),
      productName,
      subCategory,
      correctCount,
      wrongCount,
      confidence,
      autoConfirm: correctCount >= 3 && confidence >= 0.95,
      updatedAt: now,
    };
    return experiences.map((rule, index) => (index === matchedIndex ? updated : rule));
  }
  const correctCount = wasCorrect ? 1 : 0;
  const wrongCount = wasCorrect ? 0 : 1;
  const confidence = wasCorrect ? 0.72 : 0.25;
  return [
    {
      id: createId("rule"),
      businessType: group.latest.businessType,
      keywords,
      productName,
      subCategory,
      correctCount,
      wrongCount,
      confidence,
      autoConfirm: false,
      updatedAt: now,
    },
    ...experiences,
  ];
}

function belongsToColumn(message: CustomerMessage, column: MainColumn, orders: Order[]) {
  if (column === "archived") return isArchived(message);
  if (column === "closed") return isClosed(message, orders);
  if (isArchived(message) || isClosed(message, orders)) return false;
  if (column === "highIntent") return isHighIntent(message, orders);
  if (column === "xianyu" && message.businessType === "virtual") return true;
  return message.businessType === column;
}

function columnForBusinessType(value: BusinessType): MainColumn {
  if (value === "virtual") return "xianyu";
  return value;
}

function getEffectiveBusinessType(group: CustomerFolderGroup): BusinessType {
  if (group.latest.businessType === "xianyu" && groupLooksLikeVirtualService(group)) return "virtual";
  return group.latest.businessType;
}

function getSubCategory(message: CustomerMessage, column: MainColumn) {
  if (column === "highIntent") return businessTypeLabels[message.businessType];
  if (column === "xianyu") {
    if (message.businessType === "virtual" || isVirtualXianyu(message)) return "闲鱼-虚拟货";
    if (message.status === "无效咨询") return "售后/纠纷";
    return "闲鱼-实体货";
  }
  if (column === "closed") return businessTypeLabels[message.businessType];
  if (column === "archived") return businessTypeLabels[message.businessType];
  if (message.status === "待补信息") return "待补信息";
  if (message.status === "未处理" || message.isNew) return "新消息";
  return "跟进中";
}

function getColumnTheme(column: MainColumn) {
  const themes: Record<MainColumn, { badge: string; panel: string; chip: string }> = {
    highIntent: { badge: "bg-rose-50 text-rose-700", panel: "from-rose-50 to-white", chip: "bg-rose-100 text-rose-700" },
    sam: { badge: "bg-sky-50 text-sky-700", panel: "from-sky-50 to-white", chip: "bg-sky-100 text-sky-700" },
    xianyu: { badge: "bg-amber-50 text-amber-700", panel: "from-amber-50 to-white", chip: "bg-amber-100 text-amber-800" },
    local: { badge: "bg-emerald-50 text-emerald-700", panel: "from-emerald-50 to-white", chip: "bg-emerald-100 text-emerald-700" },
    trade: { badge: "bg-indigo-50 text-indigo-700", panel: "from-indigo-50 to-white", chip: "bg-indigo-100 text-indigo-700" },
    closed: { badge: "bg-slate-100 text-slate-700", panel: "from-slate-50 to-white", chip: "bg-slate-200 text-slate-700" },
    archived: { badge: "bg-zinc-100 text-zinc-700", panel: "from-zinc-50 to-white", chip: "bg-zinc-200 text-zinc-700" },
  };
  return themes[column];
}

function getOutboundStatusClass(status: OutboundReplyStatus) {
  if (status === "sent" || status === "filled") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  if (status === "processing") return "bg-sky-50 text-sky-700";
  if (status === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

function getOutboundModeLabel(mode: OutboundReplyCommand["mode"]) {
  if (mode === "send") return "代点击发送";
  if (mode === "fill") return "只回填";
  return "按插件设置";
}

function groupByFolder(messages: CustomerMessage[]) {
  const groups = new Map<string, CustomerMessage[]>();
  for (const message of messages) {
    const folder = getFolderName(message);
    groups.set(folder, [...(groups.get(folder) || []), message]);
  }
  return [...groups.entries()]
    .map(([folder, items]) => {
      const sorted = items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { folder, messages: sorted, latest: sorted[0] };
    })
    .sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt));
}

function makeFallbackAnalysis(group: CustomerFolderGroup): AnalyzeResult {
  const latest = group.latest;
  const productName = latest.productName || latest.productGuess || "待确认需求";
  return {
    customerIntent: latest.analysis?.customerIntent || "客户发来新咨询，已从消息中心进入订单处理。",
    products: latest.analysis?.products || [{ name: productName, quantity: "1", unit: "项", notes: "从消息中心进入订单处理", confidence: productName === "待确认需求" ? "低" : "中" }],
    missingInfo: latest.analysis?.missingInfo || [],
    risks: latest.analysis?.risks || ["请先核对客户真实需求，不要自动承诺价格、时效或结果。"],
    nextActions: latest.analysis?.nextActions || ["查看客户订单并确认推荐回复"],
    reply: latest.analysis?.reply || "我先看下你的需求，确认好后回复你哈~",
    summary: latest.analysis?.summary || latest.rawMessage.slice(0, 80),
    customerName: latest.customerName,
    platform: String(latest.platform || "未识别"),
    orderStatus: "待确认",
    urgency: latest.analysis?.urgency || "medium",
  };
}

function ensureTemplates() {
  const existing = getTemplates();
  const next = mergeDefaultTemplates(existing);
  if (next.length !== existing.length) saveTemplates(next);
  return next;
}

function ensureKnowledgeRules() {
  const existing = getKnowledgeRules();
  if (existing.length > 0) return existing;
  saveKnowledgeRules(defaultKnowledgeRules);
  return defaultKnowledgeRules;
}

function buildFolderAnalysisText(group: CustomerFolderGroup, confirmedProductName = "") {
  const messages = group.messages
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((message, index) => `${index + 1}. 客户消息：${message.rawMessage}`)
    .join("\n");
  return [
    "下面是同一个客户文件夹里的历史消息。请直接基于这些消息生成客户订单分析和推荐回复。",
    "不要要求商家再点一次生成推荐回复；reply 字段必须给出可以直接复制给客户的草稿。",
    "如果客户已经补充过信息，不要重复追问；只追问仍然缺少、会影响报价或交付的信息。",
    confirmedProductName ? `消息中心已确认商品/服务：${confirmedProductName}` : "",
    "",
    `客户：${group.latest.customerName || group.folder}`,
    `平台：${group.latest.platform}`,
    `业务类型：${businessTypeLabels[group.latest.businessType]}`,
    "",
    "历史消息：",
    messages,
  ].filter(Boolean).join("\n");
}

function groupLooksLikeVirtualService(group: CustomerFolderGroup, confirmedProductName = "") {
  const text = [
    confirmedProductName,
    group.latest.productName,
    group.latest.productGuess,
    group.latest.analysis?.summary,
    group.latest.analysis?.customerIntent,
    ...group.messages.map((message) => message.rawMessage),
  ].filter(Boolean).join("\n");
  return isVirtualServiceText(text);
}

async function requestFolderAnalysis(group: CustomerFolderGroup, confirmedProductName = "") {
  const settings = getSettings();
  const effectiveBusinessType: BusinessType = group.latest.businessType === "xianyu" && groupLooksLikeVirtualService(group, confirmedProductName) ? "virtual" : group.latest.businessType;
  const payload = buildAnalyzePayload({
    chatText: buildFolderAnalysisText(group, confirmedProductName),
    businessType: effectiveBusinessType,
    settings,
    templates: ensureTemplates(),
    knowledgeRules: ensureKnowledgeRules(),
    platform: String(group.latest.platform || ""),
  });
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as AnalyzeApiResponse;
  if (!response.ok || data.error) throw new Error(data.error || "AI analysis failed");
  return mapAnalyzeResponse(data);
}

function buildOrderFromFolder(group: CustomerFolderGroup, existingOrder: Order | undefined, now: string, forcedStatus?: Order["status"], analysisOverride?: AnalyzeResult) {
  const analysis = analysisOverride || existingOrder?.analysis || group.latest.analysis || makeFallbackAnalysis(group);
  const effectiveBusinessType = getEffectiveBusinessType(group);
  const confirmedProductName = group.latest.productConfirmed ? group.latest.productName || "" : "";
  const products = confirmedProductName && confirmedProductName !== "待确认需求" && !isPhysicalGoodsText(formatItemSummary(analysis.products))
    ? [{ name: confirmedProductName, quantity: "1", unit: "项", notes: "来自消息中心人工确认", confidence: "高" as const }]
    : analysis.products.filter((item) => item.name !== "待确认虚拟服务" || isVirtualServiceText(group.messages.map((message) => message.rawMessage).join("\n")));
  const nextAnalysis = { ...analysis, products };
  const itemSummary = formatItemSummary(products) || existingOrder?.itemSummary || "待确认";
  const orderId = existingOrder?.id || createId("order");
  const conversation = group.messages
    .flatMap((message) => getMessageConversation(message))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const orderTitle = existingOrder?.orderTitle || buildOrderTitle({ customerName: group.latest.customerName, itemSummary, summary: nextAnalysis.summary });
  return normalizeOrder({
    ...(existingOrder || {}),
    id: orderId,
    orderTitle,
    customerFolder: group.folder,
    customerName: group.latest.customerName || analysis.customerName || group.folder,
    platform: group.latest.platform || analysis.platform || "未识别",
    businessType: effectiveBusinessType,
    summary: nextAnalysis.summary,
    itemSummary,
    status: forcedStatus || existingOrder?.status || mapOrderStatus(nextAnalysis.orderStatus, nextAnalysis.missingInfo),
    intentLevel: existingOrder?.intentLevel || inferIntentLevel(nextAnalysis.urgency, nextAnalysis.missingInfo),
    note: existingOrder?.note || `来源消息：${group.latest.platform}`,
    createdAt: existingOrder?.createdAt || group.latest.createdAt || now,
    updatedAt: now,
    isNew: true,
    rawMessage: group.messages.map((message) => message.rawMessage).join("\n\n"),
    sourceUrl: existingOrder?.sourceUrl || group.latest.sourceUrl || group.messages.find((message) => message.sourceUrl)?.sourceUrl || "",
    analysis: nextAnalysis,
    conversation,
    history: [
      ...(existingOrder?.history || []),
      createOrderHistoryEvent(existingOrder ? "follow_up" : "created", existingOrder ? "从消息中心进入订单处理" : "从消息中心创建客户订单", `客户文件夹：${group.folder}\n消息数：${group.messages.length}`, now),
      ...(forcedStatus === "已完成" ? [createOrderHistoryEvent("completed", "标记已成交", `客户文件夹：${group.folder}`, now)] : []),
    ],
  });
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-amber-100 bg-white p-6 text-sm text-slate-500">消息中心加载中...</div>}>
      <MessagesPageContent />
    </Suspense>
  );
}

function MessagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<CustomerMessage[]>(() => getCustomerMessages());
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [conversationDraft, setConversationDraft] = useState("");
  const [conversationAnalysis, setConversationAnalysis] = useState<AnalyzeResult | null>(null);
  const [conversationProcessing, setConversationProcessing] = useState(false);
  const [orders, setOrders] = useState<Order[]>(() => getOrders().map(normalizeOrder));
  const [recognitionExperiences, setRecognitionExperiences] = useState<RecognitionExperience[]>(() => getRecognitionExperiences());
  const [activeColumn, setActiveColumn] = useState<MainColumn>("highIntent");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [editedProductName, setEditedProductName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [customerFolder, setCustomerFolder] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [platform, setPlatform] = useState<SourcePlatform | string>("闲鱼");
  const [businessType, setBusinessType] = useState<BusinessType>("xianyu");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [processingFolder, setProcessingFolder] = useState("");
  const [outboundFolder, setOutboundFolder] = useState("");
  const [outboundCommands, setOutboundCommands] = useState<OutboundReplyCommand[]>([]);

  const columnMessages = useMemo(() => messages.filter((message) => belongsToColumn(message, activeColumn, orders)), [messages, activeColumn, orders]);
  const subGroups = useMemo(() => {
    const map = new Map<string, CustomerFolderGroup[]>();
    for (const group of groupByFolder(columnMessages)) {
      const subCategory = getSubCategory(group.latest, activeColumn);
      map.set(subCategory, [...(map.get(subCategory) || []), group]);
    }
    return [...map.entries()].map(([name, groups]) => ({ name, groups }));
  }, [columnMessages, activeColumn]);
  const selectedGroup = useMemo(() => {
    const allGroups = subGroups.flatMap((group) => group.groups);
    return allGroups.find((group) => group.folder === selectedFolder) || allGroups[0];
  }, [subGroups, selectedFolder]);
  const selectedOrder = selectedGroup ? orders.find((order) => order.id === selectedGroup.latest.linkedOrderId) || orders.find((order) => (order.customerFolder || order.customerName) === selectedGroup.folder && order.platform === selectedGroup.latest.platform) : undefined;
  const selectedGuess = selectedGroup ? inferProductGuess(selectedGroup, recognitionExperiences) : undefined;
  const selectedSubCategory = selectedGroup ? getSubCategory(selectedGroup.latest, activeColumn) : "";
  const selectedOutboundCommands = useMemo(() => {
    if (!selectedGroup) return [];
    return outboundCommands
      .filter((command) => command.customerFolder === selectedGroup.folder || command.messageId === selectedGroup.latest.id || (selectedOrder?.id && command.orderId === selectedOrder.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [outboundCommands, selectedGroup, selectedOrder?.id]);
  const selectedConversation = useMemo(() => conversations.find((conversation) => conversation.id === selectedConversationId) || conversations[0], [conversations, selectedConversationId]);
  const conversationUnreadCount = useMemo(() => conversations.reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0), [conversations]);

  useEffect(() => {
    const messageId = searchParams.get("messageId") || "";
    const folder = searchParams.get("folder") || "";
    if (!messageId && !folder) return;
    const target = messageId
      ? messages.find((message) => message.id === messageId)
      : messages.find((message) => getFolderName(message) === folder);
    if (!target) return;
    setActiveColumn(columnForBusinessType(target.businessType));
    setSelectedFolder(getFolderName(target));
  }, [messages, searchParams]);

  useEffect(() => {
    setEditedProductName(selectedGuess?.productName || "");
  }, [selectedGroup?.folder, selectedGuess?.productName]);

  useEffect(() => {
    const successful = outboundCommands.filter((command) => command.status === "filled" || command.status === "sent");
    if (!successful.length) return;
    const successfulFolders = new Set(successful.map((command) => command.customerFolder).filter(Boolean));
    const successfulMessageIds = new Set(successful.map((command) => command.messageId).filter(Boolean));
    let changed = false;
    const now = new Date().toISOString();
    const nextMessages = messages.map((message) => {
      const matched = successfulMessageIds.has(message.id) || successfulFolders.has(getFolderName(message));
      if (!matched || message.status === "已回复") return message;
      changed = true;
      return { ...message, status: "已回复" as const, isNew: false, updatedAt: now };
    });
    if (changed) persistMessages(nextMessages);
  }, [outboundCommands]);

  function persistMessages(next: CustomerMessage[]) {
    setMessages(next);
    saveCustomerMessages(next);
  }

  function persistConversations(next: InboxConversation[]) {
    setConversations(next.sort((a, b) => (b.updatedAt || b.latestMessageAt).localeCompare(a.updatedAt || a.latestMessageAt)));
    window.dispatchEvent(new Event("customer-messages-updated"));
  }

  function persistOrders(next: Order[]) {
    const normalized = next.map(normalizeOrder);
    setOrders(normalized);
    saveOrders(normalized);
  }

  function persistRecognitionExperiences(next: RecognitionExperience[]) {
    setRecognitionExperiences(next);
    saveRecognitionExperiences(next);
  }

  async function refreshOutboundCommands(silent = true) {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch(`/api/outbox?status=all&platform=${encodeURIComponent("闲鱼")}`, {
        cache: "no-store",
        headers: token ? { "x-webhook-token": token } : undefined,
      });
      const data = (await response.json()) as { commands?: OutboundReplyCommand[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "sync outbox failed");
      setOutboundCommands(safeArray(data.commands));
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "同步发送状态失败";
        setNotice(`同步闲鱼发送状态失败：${message}`);
      }
    }
  }

  async function retryOutboundCommand(command: OutboundReplyCommand) {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/outbox", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({ id: command.id, status: "pending" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "retry failed");
      await refreshOutboundCommands(true);
      setNotice("已重新放回待发送队列，插件会再次处理。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "重试失败";
      setNotice(`重试闲鱼发送任务失败：${message}`);
    }
  }

  function selectFolder(folder: string) {
    setSelectedFolder(folder);
    const hasUnread = messages.some((message) => getFolderName(message) === folder && message.isNew);
    if (!hasUnread) return;
    const now = new Date().toISOString();
    persistMessages(messages.map((message) => (getFolderName(message) === folder ? { ...message, isNew: false, updatedAt: now } : message)));
  }

  function updateFolderProduct(group: CustomerFolderGroup, productName: string, status: CustomerMessage["productRecognitionStatus"], guess: ProductGuess, confirmed: boolean) {
    const now = new Date().toISOString();
    persistMessages(
      messages.map((item) =>
        getFolderName(item) === group.folder
          ? {
              ...item,
              productName,
              productGuess: guess.productName,
              productConfidence: guess.confidence,
              productRecognitionStatus: status,
              productRecognitionRuleId: guess.ruleId,
              productConfirmed: confirmed,
              updatedAt: now,
            }
          : item,
      ),
    );
  }

  function confirmProductGuess(group: CustomerFolderGroup) {
    const guess = inferProductGuess(group, recognitionExperiences);
    if (!guess.productName || guess.productName === "待确认需求") {
      setNotice("当前还没有可确认的商品/服务，请先手动修改");
      return;
    }
    const nextExperiences = upsertRecognitionExperience(recognitionExperiences, group, guess.productName, guess.subCategory, true, guess.ruleId);
    const savedRule = nextExperiences.find((rule) => rule.productName === guess.productName && rule.businessType === group.latest.businessType);
    persistRecognitionExperiences(nextExperiences);
    updateFolderProduct(group, guess.productName, savedRule?.autoConfirm ? "自动识别" : "已确认", { ...guess, ruleId: savedRule?.id }, true);
    setNotice(savedRule?.autoConfirm ? `已确认，并进入自动识别：${guess.productName}` : `已确认：${guess.productName}。多确认几次后会自动识别。`);
  }

  function saveManualProduct(group: CustomerFolderGroup) {
    const productName = editedProductName.trim();
    if (!productName) {
      setNotice("请先填写商品/服务名称");
      return;
    }
    const oldGuess = inferProductGuess(group, recognitionExperiences);
    const subCategory = group.latest.businessType === "xianyu" && isVirtualServiceText(productName) ? "虚拟服务" : oldGuess.subCategory === "待确认" ? businessTypeLabels[group.latest.businessType] : oldGuess.subCategory;
    const penalized = oldGuess.ruleId ? upsertRecognitionExperience(recognitionExperiences, group, oldGuess.productName, oldGuess.subCategory, false, oldGuess.ruleId) : recognitionExperiences;
    const nextExperiences = upsertRecognitionExperience(penalized, group, productName, subCategory, true);
    const savedRule = nextExperiences.find((rule) => rule.productName === productName && rule.businessType === group.latest.businessType);
    persistRecognitionExperiences(nextExperiences);
    updateFolderProduct(group, productName, savedRule?.autoConfirm ? "自动识别" : "已确认", { ...oldGuess, productName, subCategory, ruleId: savedRule?.id }, true);
    setNotice(`已保存修改：${productName}。系统会记住这次修正。`);
  }

  function addMessage() {
    if (!messageText.trim()) {
      setNotice("请先粘贴客户消息");
      return;
    }
    const now = new Date().toISOString();
    const folder = customerFolder.trim() || customerName.trim() || "待归类";
    const nextMessage: CustomerMessage = {
      id: createId("msg"),
      customerFolder: folder,
      customerName: customerName.trim() || "待识别客户",
      platform,
      sourceChannel: "网站手动",
      businessType,
      rawMessage: messageText.trim(),
      sourceUrl: sourceUrl.trim(),
      status: "未处理",
      isNew: true,
      createdAt: now,
      updatedAt: now,
      conversation: [{ id: `turn_${Date.now()}_customer`, role: "customer", content: messageText.trim(), createdAt: now }],
    };
    const merged = mergeCustomerMessages(messages, [nextMessage], orders);
    persistMessages(merged.messages);
    setActiveColumn(columnForBusinessType(businessType));
    setSelectedFolder(folder);
    setMessageText("");
    setCustomerFolder("");
    setCustomerName("");
    setSourceUrl("");
    setNotice("新消息已进入客户文件夹");
  }

  async function syncExternalMessages() {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/inbox", {
        cache: "no-store",
        headers: token ? { "x-webhook-token": token } : undefined,
      });
      const data = (await response.json()) as { conversations?: InboxConversation[]; messages?: CustomerMessage[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "sync failed");
      const incomingConversations = safeArray(data.conversations);
      if (incomingConversations.length) {
        persistConversations(incomingConversations);
        setSelectedConversationId((current) => current || incomingConversations[0]?.id || "");
      }
      const incoming = safeArray(data.messages);
      const merged = mergeCustomerMessages(messages, incoming, orders);
      persistMessages(merged.messages);
      const touched = merged.messages.find((message) => message.id === merged.firstTouchedId);
      if (touched) {
        setActiveColumn(columnForBusinessType(touched.businessType));
        setSelectedFolder(getFolderName(touched));
      }
      setNotice(incomingConversations.length ? `已同步 ${incomingConversations.length} 个会话，旧消息 ${incoming.length} 条` : incoming.length ? `已同步 ${incoming.length} 条外部消息，同一联系人会合并到同一个客户文件夹` : "外部收件箱暂无消息");
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      setNotice(`同步外部消息失败：${message}。请确认服务器 INBOX_WEBHOOK_TOKEN 与设置页 Webhook Token 一致`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function autoSyncExternalMessages() {
      try {
        const token = await getWebhookTokenForClient();
        const response = await fetch("/api/inbox", {
          cache: "no-store",
          headers: token ? { "x-webhook-token": token } : undefined,
        });
        const data = (await response.json()) as { conversations?: InboxConversation[]; messages?: CustomerMessage[] };
        if (!response.ok) return;
        const incomingConversations = safeArray(data.conversations);
        if (incomingConversations.length) {
          persistConversations(incomingConversations);
          setSelectedConversationId((current) => current || incomingConversations[0]?.id || "");
        }
        const incoming = safeArray(data.messages);
        if (cancelled || incoming.length === 0) return;
        const merged = mergeCustomerMessages(messages, incoming, orders);
        if (merged.changedCount > 0) persistMessages(merged.messages);
      } catch {
        // Silent background sync; the manual sync button still shows detailed errors.
      }
    }

    autoSyncExternalMessages();
    const timer = window.setInterval(autoSyncExternalMessages, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [messages, orders]);

  useEffect(() => {
    refreshOutboundCommands(true);
    const timer = window.setInterval(() => refreshOutboundCommands(true), 8000);
    return () => window.clearInterval(timer);
  }, []);

  function loadDemoMessages() {
    const existing = messages.filter((item) => !item.id.startsWith("msg_demo_"));
    persistMessages([...sampleMessages, ...existing]);
    setActiveColumn("xianyu");
    setSelectedFolder(sampleMessages[0].customerFolder || sampleMessages[0].customerName);
    setNotice("已加载演示消息");
  }

  async function analyzeSelectedConversation() {
    if (!selectedConversation) {
      setNotice("请先选择一个会话");
      return;
    }
    setConversationProcessing(true);
    try {
      const latestCustomerMessage = [...selectedConversation.messages].reverse().find((message) => message.role === "customer")?.content || selectedConversation.latestMessageText;
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAnalyzePayload({
            chatText: latestCustomerMessage,
            businessType: selectedConversation.businessType,
            settings: getSettings(),
            templates: mergeDefaultTemplates(getTemplates()),
            knowledgeRules: [...defaultKnowledgeRules, ...getKnowledgeRules()],
            platform: selectedConversation.platform,
            conversationHistory: selectedConversation.messages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
            })),
            mode: "order-followup",
          }),
        ),
      });
      const data = (await response.json()) as AnalyzeApiResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "AI 分析失败");
      const mapped = mapAnalyzeResponse(data);
      setConversationAnalysis(mapped);
      setConversationDraft(mapped.reply || "");
      setNotice("会话分析已生成，回复草稿不会自动写入历史。");
    } catch (error) {
      setNotice(`会话 AI 分析失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    } finally {
      setConversationProcessing(false);
    }
  }

  async function copyConversationReply() {
    if (!selectedConversation || !conversationDraft.trim()) {
      setNotice("暂无可复制回复");
      return;
    }
    try {
      await navigator.clipboard.writeText(conversationDraft);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = conversationDraft;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/inbox/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          role: "assistant",
          content: conversationDraft,
          sourceUrl: selectedConversation.sourceUrl || "",
        }),
      });
      const data = (await response.json()) as { conversation?: InboxConversation; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "写入会话失败");
      if (data.conversation) {
        persistConversations([data.conversation, ...conversations.filter((conversation) => conversation.id !== data.conversation?.id)]);
      }
      setNotice("已复制回复，并记录到当前会话历史。");
    } catch (error) {
      setNotice(`已复制回复，但写入会话失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    }
  }

  async function createConversationOutbox() {
    if (!selectedConversation || !conversationDraft.trim()) {
      setNotice("暂无可创建的回复草稿");
      return;
    }
    if (String(selectedConversation.platform || "") !== "闲鱼") {
      setNotice("当前先支持创建闲鱼发送任务。");
      return;
    }
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          customerFolder: selectedConversation.customerFolder || selectedConversation.customerName,
          customerName: selectedConversation.customerName,
          platform: selectedConversation.platform,
          sourceUrl: selectedConversation.sourceUrl || "",
          itemTitle: selectedConversation.itemTitle || "",
          platformThreadId: selectedConversation.platformThreadId || "",
          externalConversationId: selectedConversation.externalConversationId || "",
          reply: conversationDraft,
          mode: "fill",
        }),
      });
      const data = (await response.json()) as { command?: OutboundReplyCommand; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "创建发送任务失败");
      if (data.command) setOutboundCommands((current) => [data.command as OutboundReplyCommand, ...current.filter((item) => item.id !== data.command?.id)]);
      setNotice("已创建闲鱼发送任务。请打开对应客户聊天页，在插件里点击“填入闲鱼输入框”。");
    } catch (error) {
      setNotice(`创建发送任务失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    }
  }

  function updateFolder(oldFolder: string, nextFolder: string) {
    const folder = nextFolder.trim() || "待归类";
    const now = new Date().toISOString();
    persistMessages(messages.map((item) => (getFolderName(item) === oldFolder ? { ...item, customerFolder: folder, updatedAt: now } : item)));
    setSelectedFolder(folder);
  }

  async function clearServerFolder(target: CustomerMessage) {
    try {
      const token = await getWebhookTokenForClient();
      await fetch("/api/inbox", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({
          customerFolder: getFolderName(target),
          customerName: target.customerName,
          platform: target.platform,
        }),
      });
    } catch {
      // 本地清空优先，服务端记录下次仍可再清。
    }
  }

  async function deleteFolder(group: CustomerFolderGroup) {
    const confirmed = window.confirm(`确定要清空这个客户文件夹吗？\n\n文件夹：${group.folder}\n客户：${group.latest.customerName || "未识别客户"}\n\n会删除这个客户的消息中心记录和关联客户订单，删除后无法恢复。`);
    if (!confirmed) return;
    await clearServerFolder(group.latest);
    const linkedOrderIds = new Set(group.messages.map((item) => item.linkedOrderId).filter(Boolean));
    const nextMessages = messages.filter((item) => getFolderName(item) !== group.folder);
    const nextOrders = orders.filter((order) => {
      const sameFolder = (order.customerFolder || order.customerName) === group.folder;
      const linked = linkedOrderIds.has(order.id);
      return !sameFolder && !linked;
    });
    persistMessages(nextMessages);
    persistOrders(nextOrders);
    setSelectedFolder("");
    setNotice(`已清空客户文件夹：${group.folder}`);
  }

  function archiveFolder(group: CustomerFolderGroup) {
    const now = new Date().toISOString();
    persistMessages(messages.map((item) => (getFolderName(item) === group.folder ? { ...item, status: "无效咨询", isNew: false, updatedAt: now } : item)));
    setActiveColumn("archived");
    setSelectedFolder(group.folder);
    setNotice(`已归档客户文件夹：${group.folder}`);
  }

  function markFolderClosed(group: CustomerFolderGroup) {
    const now = new Date().toISOString();
    const completedOrder = buildOrderFromFolder(group, selectedOrder, now, "已完成");
    persistOrders(selectedOrder ? orders.map((order) => (order.id === selectedOrder.id ? completedOrder : order)) : [completedOrder, ...orders]);
    persistMessages(messages.map((item) => (getFolderName(item) === group.folder ? { ...item, linkedOrderId: completedOrder.id, status: "已成单", isNew: false, updatedAt: now } : item)));
    setActiveColumn("closed");
    setSelectedFolder(group.folder);
    setNotice(`已标记为已成交：${group.folder}`);
  }

  function markFolderUnclosed(group: CustomerFolderGroup) {
    const now = new Date().toISOString();
    const fallbackOrder = selectedOrder ? undefined : buildOrderFromFolder(group, undefined, now, "待确认");
    const nextOrders = selectedOrder
      ? orders.map((order) =>
          order.id === selectedOrder.id
            ? normalizeOrder({
                ...order,
                status: "待确认",
                updatedAt: now,
                history: [...(order.history || []), createOrderHistoryEvent("status_changed", "标记未成交", "从已成交订单移回待跟进。", now)],
              })
            : order,
        )
      : fallbackOrder
        ? [fallbackOrder, ...orders]
        : orders;
    persistOrders(nextOrders);
    persistMessages(
      messages.map((item) =>
        getFolderName(item) === group.folder
          ? { ...item, linkedOrderId: selectedOrder?.id || fallbackOrder?.id || item.linkedOrderId, status: "已分析", isNew: false, updatedAt: now }
          : item,
      ),
    );
    setActiveColumn(columnForBusinessType(group.latest.businessType));
    setSelectedFolder(group.folder);
    setNotice(`已移回未成交待跟进：${group.folder}`);
  }

  async function openOrderProcessing(group: CustomerFolderGroup) {
    const now = new Date().toISOString();
    const guess = inferProductGuess(group, recognitionExperiences);
    const effectiveBusinessType = getEffectiveBusinessType(group);
    const groupForOrder: CustomerFolderGroup = guess.autoConfirm
      ? {
          ...group,
          latest: {
            ...group.latest,
            businessType: effectiveBusinessType,
            productName: guess.productName,
            productGuess: guess.productName,
            productConfidence: guess.confidence,
            productRecognitionStatus: "自动识别",
            productRecognitionRuleId: guess.ruleId,
            productConfirmed: true,
          },
          messages: group.messages.map((message) => ({
            ...message,
            businessType: effectiveBusinessType,
            productName: guess.productName,
            productGuess: guess.productName,
            productConfidence: guess.confidence,
            productRecognitionStatus: "自动识别" as const,
            productRecognitionRuleId: guess.ruleId,
            productConfirmed: true,
          })),
        }
      : {
          ...group,
          latest: { ...group.latest, businessType: effectiveBusinessType },
          messages: group.messages.map((message) => ({ ...message, businessType: effectiveBusinessType })),
        };
    const existingOrder = selectedOrder;
    setProcessingFolder(group.folder);
    setNotice("正在生成客户订单和推荐回复...");
    let analysis: AnalyzeResult | undefined;
    try {
      analysis = await requestFolderAnalysis(groupForOrder, guess.autoConfirm ? guess.productName : groupForOrder.latest.productName || groupForOrder.latest.productGuess || "");
    } catch {
      analysis = undefined;
      setNotice("AI 推荐回复生成失败，已先进入客户订单并保留兜底回复。");
    } finally {
      setProcessingFolder("");
    }
    const nextOrder = buildOrderFromFolder(groupForOrder, existingOrder, now, undefined, analysis);
    const orderId = nextOrder.id;
    persistOrders(existingOrder ? orders.map((order) => (order.id === existingOrder.id ? nextOrder : order)) : [nextOrder, ...orders]);
    persistMessages(
      messages.map((message) =>
        getFolderName(message) === group.folder
          ? {
              ...message,
              businessType: effectiveBusinessType,
              ...(guess.autoConfirm
                ? {
                    productName: guess.productName,
                    productGuess: guess.productName,
                    productConfidence: guess.confidence,
                    productRecognitionStatus: "自动识别" as const,
                    productRecognitionRuleId: guess.ruleId,
                    productConfirmed: true,
                  }
                : {}),
              linkedOrderId: orderId,
              isNew: false,
              status: message.status === "未处理" ? "已分析" : message.status,
              updatedAt: now,
            }
          : message,
      ),
    );
    router.push(`/orders/${orderId}`);
  }

  async function sendReplyToPlatform(group: CustomerFolderGroup) {
    if (String(group.latest.platform) !== "闲鱼") {
      setNotice("当前先支持发送回闲鱼，其他平台等平台适配器接入后再开放。");
      return;
    }
    if (!group.latest.sourceUrl) {
      setNotice("这个客户缺少原平台链接，插件不知道要发回哪个闲鱼聊天页。请先从插件同步消息，或补上原平台链接。");
      return;
    }

    const now = new Date().toISOString();
    const existingOrder = orders.find((order) => order.id === group.latest.linkedOrderId) || orders.find((order) => (order.customerFolder || order.customerName) === group.folder && order.platform === group.latest.platform);
    let workingOrders = orders;
    let workingMessages = messages;
    let orderForRecord = existingOrder;
    let analysis = existingOrder?.analysis || group.latest.analysis;

    try {
      setOutboundFolder(group.folder);
      if (!analysis?.reply) {
        setNotice("正在生成推荐回复，然后发送到闲鱼...");
        const effectiveBusinessType = getEffectiveBusinessType(group);
        const groupForOrder: CustomerFolderGroup = {
          ...group,
          latest: { ...group.latest, businessType: effectiveBusinessType },
          messages: group.messages.map((message) => ({ ...message, businessType: effectiveBusinessType })),
        };
        analysis = await requestFolderAnalysis(groupForOrder, group.latest.productName || group.latest.productGuess || "");
        const nextOrder = buildOrderFromFolder(groupForOrder, existingOrder, now, undefined, analysis);
        orderForRecord = nextOrder;
        workingOrders = existingOrder ? orders.map((order) => (order.id === existingOrder.id ? nextOrder : order)) : [nextOrder, ...orders];
        persistOrders(workingOrders);
        workingMessages = messages.map((message) =>
          getFolderName(message) === group.folder
            ? { ...message, businessType: effectiveBusinessType, linkedOrderId: nextOrder.id, analysis, status: message.status === "未处理" ? "已分析" : message.status, isNew: false, updatedAt: now }
            : message,
        );
        persistMessages(workingMessages);
      }

      if (!orderForRecord && analysis?.reply) {
        const effectiveBusinessType = getEffectiveBusinessType(group);
        const groupForOrder: CustomerFolderGroup = {
          ...group,
          latest: { ...group.latest, businessType: effectiveBusinessType, analysis },
          messages: group.messages.map((message) => ({ ...message, businessType: effectiveBusinessType })),
        };
        const nextOrder = buildOrderFromFolder(groupForOrder, undefined, now, undefined, analysis);
        orderForRecord = nextOrder;
        workingOrders = [nextOrder, ...workingOrders];
        persistOrders(workingOrders);
        workingMessages = workingMessages.map((message) =>
          getFolderName(message) === group.folder
            ? {
                ...message,
                businessType: effectiveBusinessType,
                linkedOrderId: nextOrder.id,
                analysis: message.analysis || analysis,
                status: message.status === "未处理" ? "已分析" : message.status,
                isNew: false,
                updatedAt: now,
              }
            : message,
        );
        persistMessages(workingMessages);
      }

      const reply = analysis?.reply || makeFallbackAnalysis(group).reply;
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({
          messageId: group.latest.id,
          orderId: orderForRecord?.id || "",
          customerFolder: group.folder,
          customerName: group.latest.customerName,
          platform: group.latest.platform,
          sourceUrl: group.latest.sourceUrl,
          reply,
          mode: "plugin-default",
        }),
      });
      const data = (await response.json()) as { command?: { id?: string }; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "创建发送任务失败");
      await refreshOutboundCommands(true);

      const sentAt = new Date().toISOString();
      const assistantTurn: ConversationTurn = { id: `turn_${Date.now()}_assistant`, role: "assistant", content: reply, createdAt: sentAt };
      const nextMessages = workingMessages.map((message) =>
        getFolderName(message) === group.folder
          ? {
              ...message,
              status: message.status === "未处理" ? "已分析" as const : message.status,
              isNew: false,
              updatedAt: sentAt,
              conversation: [...getMessageConversation(message), assistantTurn],
            }
          : message,
      );
      persistMessages(nextMessages);
      if (orderForRecord) {
        const nextOrders = workingOrders.map((order) =>
          order.id === orderForRecord?.id
            ? normalizeOrder({
                ...order,
                updatedAt: sentAt,
                conversation: [...(order.conversation || []), assistantTurn],
                history: [...(order.history || []), createOrderHistoryEvent("follow_up", "已创建闲鱼发送任务", `任务ID：${data.command?.id || "待插件同步"}\n回复：${reply}`, sentAt)],
              })
            : order,
        );
        persistOrders(nextOrders);
      }
      setNotice("已创建闲鱼发送任务。插件会在打开的闲鱼聊天页回填或发送这条回复。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送任务创建失败";
      setNotice(`发送回闲鱼失败：${message}`);
    } finally {
      setOutboundFolder("");
    }
  }

  function selectColumn(column: MainColumn) {
    setActiveColumn(column);
    setSelectedFolder("");
  }

  const activeColumnInfo = mainColumns.find((item) => item.id === activeColumn) || mainColumns[0];
  const activeTheme = getColumnTheme(activeColumn);

  return (
    <div className="space-y-5">
      <header className={`overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br ${activeTheme.panel} shadow-xl shadow-slate-200/70 ring-1 ring-slate-100`}>
        <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-7">
          <div>
            <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${activeTheme.badge}`}>客户文件夹总览</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 lg:text-4xl">消息中心</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              这里专门看所有客户文件夹和分类。新消息先进消息中心，真正的 AI 分析、推荐回复和跟进处理放到客户订单里完成。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="未处理红点" value={messages.filter(isUnread).length} tone="bg-rose-50 text-rose-700" />
            <Metric label="客户文件夹" value={groupByFolder(messages).length} tone="bg-sky-50 text-sky-700" />
            <Metric label="已成交" value={messages.filter((item) => isClosed(item, orders)).length} tone="bg-emerald-50 text-emerald-700" />
          </div>
        </div>
      </header>

      {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{notice}</div> : null}

      <Section title="统一会话收件箱" description="优先展示新的 InboxConversation。旧客户文件夹视图仍保留在下方作为兼容层。">
        {conversations.length === 0 ? (
          <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/60 p-5 text-sm leading-6 text-slate-600">
            暂无新会话数据。点击“同步外部消息”后，如果服务端已有 conversations，会优先显示在这里；旧消息仍在下方客户文件夹中展示。
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="会话数" value={conversations.length} tone="bg-sky-50 text-sky-700" />
                <Metric label="未读" value={conversationUnreadCount} tone="bg-rose-50 text-rose-700" />
                <Metric label="平台数" value={new Set(conversations.map((conversation) => conversation.platform)).size} tone="bg-emerald-50 text-emerald-700" />
              </div>
              <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
                {conversations.map((conversation) => {
                  const active = selectedConversation?.id === conversation.id;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`w-full rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-0.5 ${active ? "border-slate-950 bg-slate-950 text-white" : "border-white bg-white hover:bg-sky-50"}`}
                      onClick={() => setSelectedConversationId(conversation.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{conversation.customerFolder || conversation.customerName}</div>
                          <div className={`mt-1 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>
                            {conversation.platform} · {conversation.shopAlias || "default-shop"} · {businessTypeLabels[conversation.businessType] || conversation.businessType}
                          </div>
                        </div>
                        {conversation.unreadCount ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{conversation.unreadCount}</span> : null}
                      </div>
                      {conversation.itemTitle ? <div className={`mt-2 truncate text-xs ${active ? "text-slate-200" : "text-amber-700"}`}>{conversation.itemTitle}</div> : null}
                      <div className={`mt-2 line-clamp-2 text-sm leading-6 ${active ? "text-white" : "text-slate-700"}`}>{conversation.latestMessageText}</div>
                      <div className={`mt-2 text-xs ${active ? "text-slate-300" : "text-slate-400"}`}>{new Date(conversation.latestMessageAt || conversation.updatedAt).toLocaleString()} · {conversation.status}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedConversation ? (
              <div className="rounded-2xl border border-white bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div>
                    <div className="text-lg font-semibold text-slate-950">{selectedConversation.customerName || selectedConversation.customerFolder}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedConversation.platform} · {selectedConversation.shopAlias || "default-shop"} · {selectedConversation.itemTitle || "未识别商品"} · {selectedConversation.messages.length} 条消息
                    </div>
                    {selectedConversation.sourceUrl ? <div className="mt-1 truncate text-xs text-slate-400">{selectedConversation.sourceUrl}</div> : null}
                  </div>
                  <button type="button" className={primaryButtonClass} onClick={analyzeSelectedConversation} disabled={conversationProcessing}>
                    {conversationProcessing ? "分析中..." : "结合历史 AI 分析"}
                  </button>
                </div>

                <div className="mt-4 max-h-80 space-y-3 overflow-auto rounded-2xl bg-slate-50 p-3">
                  {selectedConversation.messages.map((message) => (
                    <div key={message.id} className={`rounded-xl border p-3 text-sm ${message.role === "customer" ? "border-sky-100 bg-white" : "border-emerald-100 bg-emerald-50"}`}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{message.role === "customer" ? "客户" : message.role === "assistant" ? "客服回复" : "备注"}</span>
                        <span>{new Date(message.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="whitespace-pre-line leading-6 text-slate-800">{message.content}</div>
                    </div>
                  ))}
                </div>

                {conversationAnalysis ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm">
                      <div className="font-semibold text-slate-950">AI 摘要</div>
                      <div className="mt-2 leading-6 text-slate-700">{conversationAnalysis.summary || conversationAnalysis.customerIntent}</div>
                      <div className="mt-3 text-xs font-semibold text-slate-500">缺失信息</div>
                      <div className="mt-1 text-slate-700">{conversationAnalysis.missingInfo.join("、") || "暂无明显缺失"}</div>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm">
                      <div className="font-semibold text-slate-950">回复草稿</div>
                      <textarea className={`${textareaClass} mt-2 min-h-32 bg-white`} value={conversationDraft} onChange={(event) => setConversationDraft(event.target.value)} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={primaryButtonClass} onClick={copyConversationReply}>??????????</button>
                        <button type="button" className={secondaryButtonClass} onClick={createConversationOutbox}>????????</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="栏目">
            <div className="space-y-2">
              {mainColumns.map((column) => {
                const list = messages.filter((message) => belongsToColumn(message, column.id, orders));
                const unread = list.filter(isUnread).length;
                const theme = getColumnTheme(column.id);
                return (
                  <button
                    key={column.id}
                    className={`w-full rounded-2xl border p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${activeColumn === column.id ? "border-slate-950 bg-slate-950 text-white shadow-slate-300/60" : "border-white bg-white hover:border-sky-100 hover:bg-sky-50/70"}`}
                    onClick={() => selectColumn(column.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{column.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeColumn === column.id ? "bg-white text-slate-950" : unread ? "bg-rose-500 text-white" : theme.chip}`}>
                        {unread || list.length}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${activeColumn === column.id ? "text-slate-200" : "text-slate-500"}`}>{column.description}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="新增客户消息" description="也可以用浏览器插件同步进来，同一个客户会自动合并到同一个文件夹。">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="来源平台">
                  <select className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value)}>
                    {platformOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="业务类型">
                  <select className={inputClass} value={businessType} onChange={(event) => setBusinessType(event.target.value as BusinessType)}>
                    {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="客户文件夹">
                <input className={inputClass} value={customerFolder} onChange={(event) => setCustomerFolder(event.target.value)} placeholder="例如：一个木薯" />
              </Field>
              <Field label="客户昵称">
                <input className={inputClass} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="可不填" />
              </Field>
              <Field label="原平台链接">
                <input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="可选" />
              </Field>
              <Field label="客户消息">
                <textarea className={`${textareaClass} min-h-32`} value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="粘贴客户发来的消息..." />
              </Field>
              <div className="flex flex-col gap-2">
                <button className={primaryButtonClass} onClick={addMessage}>加入客户文件夹</button>
                <button className={secondaryButtonClass} onClick={syncExternalMessages}>同步外部消息</button>
                <button className={secondaryButtonClass} onClick={loadDemoMessages}>加载演示消息</button>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title={activeColumnInfo.label} description="点每个栏目都会看到该分类里的客户文件夹。红点数字表示还有未处理消息。">
            {subGroups.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/60 p-6 text-sm text-slate-600">这个栏目里暂时没有客户文件夹。</div>
            ) : (
              <div className="space-y-5">
                {subGroups.map((subGroup) => (
                  <div key={subGroup.name}>
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="inline-flex items-center rounded-full bg-white px-3 py-1 text-base font-semibold text-slate-950 shadow-sm ring-1 ring-slate-100">{subGroup.name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeTheme.chip}`}>{subGroup.groups.length} 个客户</span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {subGroup.groups.map((group) => {
                        const unread = group.messages.filter(isUnread).length;
                        const active = selectedGroup?.folder === group.folder;
                        return (
                          <button
                            key={group.folder}
                            className={`rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${active ? "border-slate-950 bg-slate-950 text-white shadow-slate-300/70" : "border-white bg-white/95 hover:border-sky-100 hover:bg-white"}`}
                            onClick={() => selectFolder(group.folder)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">{group.folder}</div>
                                <div className={`mt-1 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>{group.latest.platform} · {getSubCategory(group.latest, activeColumn)} · {group.messages.length} 条消息</div>
                              </div>
                              {unread ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm shadow-rose-200">{unread}</span> : <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-white text-slate-950" : "bg-emerald-50 text-emerald-700"}`}>已读</span>}
                            </div>
                            <div className={`mt-3 line-clamp-2 text-sm leading-6 ${active ? "text-white" : "text-slate-700"}`}>{group.latest.rawMessage}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {selectedGroup ? (
            <Section title="客户文件夹详情">
              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <Field label="客户文件夹">
                    <input className={inputClass} value={selectedGroup.folder} onChange={(event) => updateFolder(selectedGroup.folder, event.target.value)} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoPill label="客户昵称" value={selectedGroup.latest.customerName} />
                    <InfoPill label="来源平台" value={String(selectedGroup.latest.platform)} />
                    <InfoPill label="业务类型" value={selectedSubCategory || businessTypeLabels[selectedGroup.latest.businessType]} />
                    <InfoPill label="订单状态" value={selectedOrder ? selectedOrder.status : "未进入订单"} />
                  </div>
                  {selectedGuess ? (
                    <div className={`rounded-2xl border border-white bg-gradient-to-br ${activeTheme.panel} p-4 shadow-sm ring-1 ring-slate-100`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-950">商品/服务识别</div>
                          <div className="mt-1 text-xs text-slate-500">{selectedGuess.reason}</div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selectedGuess.autoConfirm ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {selectedGuess.source}
                        </span>
                      </div>
                      <div className="mt-3 rounded-xl border border-white bg-white/80 p-3 shadow-sm">
                        <div className="text-xs font-semibold text-slate-500">当前识别</div>
                        <div className="mt-1 text-sm font-semibold text-slate-950">{selectedGuess.productName}</div>
                        <div className="mt-1 text-xs text-slate-500">分类：{selectedGuess.subCategory} · 置信度：{Math.round(selectedGuess.confidence * 100)}%</div>
                      </div>
                      {selectedGuess.autoConfirm || selectedGroup.latest.productConfirmed ? (
                        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                          {selectedGuess.autoConfirm ? "这类需求已经多次确认正确，后续会自动识别。" : "这个客户文件夹已人工确认商品/服务。"}
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          <button className={primaryButtonClass} onClick={() => confirmProductGuess(selectedGroup)}>确认正确</button>
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input className={inputClass} value={editedProductName} onChange={(event) => setEditedProductName(event.target.value)} placeholder="如果不对，手动填写商品/服务名称" />
                            <button className={secondaryButtonClass} onClick={() => saveManualProduct(selectedGroup)}>保存修改</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <button className={primaryButtonClass} onClick={() => openOrderProcessing(selectedGroup)} disabled={processingFolder === selectedGroup.folder}>
                      {processingFolder === selectedGroup.folder ? "生成推荐回复中..." : "进入客户订单处理"}
                    </button>
                    <button className={secondaryButtonClass} onClick={() => sendReplyToPlatform(selectedGroup)} disabled={outboundFolder === selectedGroup.folder}>
                      {outboundFolder === selectedGroup.folder ? "正在创建发送任务..." : "发送回闲鱼"}
                    </button>
                    {activeColumn === "closed" ? (
                      <button className={secondaryButtonClass} onClick={() => markFolderUnclosed(selectedGroup)}>未成交</button>
                    ) : (
                      <button className={secondaryButtonClass} onClick={() => markFolderClosed(selectedGroup)}>标记已成交</button>
                    )}
                    <button className={secondaryButtonClass} onClick={() => archiveFolder(selectedGroup)}>归档</button>
                    <button className="inline-flex min-h-10 items-center justify-center rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm shadow-amber-100/60 transition hover:bg-rose-50" onClick={() => deleteFolder(selectedGroup)}>删除文件夹</button>
                  </div>
                  {selectedOrder ? <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">已连接客户订单：{selectedOrder.orderTitle || selectedOrder.customerName}</div> : null}
                  <div className="rounded-2xl border border-white bg-white/90 p-4 text-sm shadow-sm ring-1 ring-slate-100">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-950">闲鱼发送状态</div>
                      <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => refreshOutboundCommands(false)}>刷新</button>
                    </div>
                    {selectedOutboundCommands.length ? (
                      <div className="mt-3 space-y-2">
                        {selectedOutboundCommands.slice(0, 3).map((command) => (
                          <div key={command.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getOutboundStatusClass(command.status)}`}>{outboundStatusLabels[command.status]}</span>
                              <span className="text-xs text-slate-500">{getOutboundModeLabel(command.mode)} · {new Date(command.updatedAt).toLocaleString()}</span>
                            </div>
                            <div className="mt-2 line-clamp-2 whitespace-pre-line text-slate-700">{command.reply}</div>
                            {command.error ? <div className="mt-2 text-xs font-medium text-rose-600">{command.error}</div> : null}
                            {command.status === "failed" || command.status === "cancelled" ? (
                              <button className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => retryOutboundCommand(command)}>重试</button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">还没有发送回闲鱼的任务。</div>
                    )}
                  </div>
                  {(selectedOrder?.analysis.reply || selectedGroup.latest.analysis?.reply) ? (
                    <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-950">待发送回复</div>
                      <div className="mt-2 whitespace-pre-line leading-6">{selectedOrder?.analysis.reply || selectedGroup.latest.analysis?.reply}</div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                      这个客户还没有推荐回复。点击“发送回闲鱼”时，系统会先生成回复，再创建发送任务。
                    </div>
                  )}
                </div>
                <div className={`rounded-2xl border border-white bg-gradient-to-br ${activeTheme.panel} p-4 shadow-sm ring-1 ring-slate-100`}>
                  <div className="text-sm font-semibold text-slate-950">最近消息</div>
                  <p className="mt-3 whitespace-pre-line rounded-2xl bg-white/80 p-4 text-sm leading-6 text-slate-700 shadow-sm">{selectedGroup.latest.rawMessage}</p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold text-slate-800">文件夹消息记录</div>
                <div className="space-y-3">
                  {selectedGroup.messages.map((message) => (
                    <div key={message.id} className="rounded-2xl border border-white bg-white/90 p-3 text-sm shadow-sm ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-950">{message.customerName || selectedGroup.folder}</div>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-slate-600">{message.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{new Date(message.updatedAt).toLocaleString()} · {message.sourceChannel || "网站手动"}</div>
                      <div className="mt-2 whitespace-pre-line leading-6 text-slate-700">{message.rawMessage}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function mapAnalyzeResponse(data: AnalyzeApiResponse): AnalyzeResult {
  const confidenceMap = { high: "高", medium: "中", low: "低" } as const;
  return {
    customerIntent: data.customer_intent,
    products: safeArray(data.items).map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, notes: item.note, confidence: confidenceMap[item.confidence] })),
    missingInfo: safeArray(data.missing_info),
    risks: safeArray(data.risk_flags),
    nextActions: safeArray(data.next_action),
    reply: data.reply,
    summary: data.summary,
    customerName: data.customer_info?.name || "待填写客户",
    platform: data.customer_info?.platform || "未识别",
    orderStatus: data.order_status,
    urgency: data.urgency,
  };
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-amber-100 bg-white p-3">
      <div className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-amber-100 bg-white p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value || "未识别"}</div>
    </div>
  );
}
