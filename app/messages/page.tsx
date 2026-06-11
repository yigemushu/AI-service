"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels } from "@/lib/constants";
import { formatItemSummary } from "@/lib/format";
import { buildOrderTitle, createOrderHistoryEvent, inferIntentLevel, mapOrderStatus, normalizeOrder } from "@/lib/orderUtils";
import { createId, getCustomerMessages, getOrders, getRecognitionExperiences, getSettings, saveCustomerMessages, saveOrders, saveRecognitionExperiences } from "@/lib/storage";
import type { AnalyzeResult, BusinessType, ConversationTurn, CustomerMessage, InboxStatus, Order, RecognitionExperience, SourcePlatform } from "@/lib/types";

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
  return message.isNew || message.status === "未处理" || message.status === "待补信息";
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

function isVirtualServiceText(text: string) {
  return /(写作|代写|润色|改写|文案|小红书|公众号|脚本|检讨书|道歉|致歉|演讲稿|发言稿|申请书|读后感|观后感|PPT|ppt|简历|翻译|设计|修图|提示词|prompt|报告|方案|咨询|字数|页数|交付)/i.test(text);
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
function getSubCategory(message: CustomerMessage, column: MainColumn) {
  if (column === "highIntent") return businessTypeLabels[message.businessType];
  if (column === "xianyu") {
    if (isVirtualXianyu(message)) return "虚拟服务";
    if (message.status === "无效咨询") return "售后/纠纷";
    return "实物买卖";
  }
  if (column === "closed") return businessTypeLabels[message.businessType];
  if (column === "archived") return businessTypeLabels[message.businessType];
  if (message.status === "待补信息") return "待补信息";
  if (message.status === "未处理" || message.isNew) return "新消息";
  return "跟进中";
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
    customerIntent: latest.analysis?.customerIntent || "客户发来新咨询，等待在客户订单中分析。",
    products: latest.analysis?.products || [{ name: productName, quantity: "1", unit: "项", notes: "从消息中心进入订单处理", confidence: productName === "待确认需求" ? "低" : "中" }],
    missingInfo: latest.analysis?.missingInfo || ["需要在客户订单中结合完整聊天分析"],
    risks: latest.analysis?.risks || ["请先核对客户真实需求，不要自动承诺价格、时效或结果。"],
    nextActions: latest.analysis?.nextActions || ["进入客户订单处理", "结合历史消息生成推荐回复"],
    reply: latest.analysis?.reply || "我先看下你的需求，确认好后回复你哈~",
    summary: latest.analysis?.summary || latest.rawMessage.slice(0, 80),
    customerName: latest.customerName,
    platform: String(latest.platform || "未识别"),
    orderStatus: "待确认",
    urgency: latest.analysis?.urgency || "medium",
  };
}

function buildOrderFromFolder(group: CustomerFolderGroup, existingOrder: Order | undefined, now: string, forcedStatus?: Order["status"]) {
  const analysis = existingOrder?.analysis || group.latest.analysis || makeFallbackAnalysis(group);
  const confirmedProductName = group.latest.productName || group.latest.productGuess || "";
  const products = confirmedProductName && confirmedProductName !== "待确认需求" ? [{ name: confirmedProductName, quantity: "1", unit: "项", notes: "来自消息中心商品识别", confidence: group.latest.productConfirmed ? "高" as const : "中" as const }] : analysis.products;
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
    businessType: group.latest.businessType,
    summary: nextAnalysis.summary,
    itemSummary,
    status: forcedStatus || existingOrder?.status || mapOrderStatus(nextAnalysis.orderStatus, nextAnalysis.missingInfo),
    intentLevel: existingOrder?.intentLevel || inferIntentLevel(nextAnalysis.urgency, nextAnalysis.missingInfo),
    note: existingOrder?.note || `来源消息：${group.latest.platform}`,
    createdAt: existingOrder?.createdAt || group.latest.createdAt || now,
    updatedAt: now,
    isNew: true,
    rawMessage: group.messages.map((message) => message.rawMessage).join("\n\n"),
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
  const router = useRouter();
  const [messages, setMessages] = useState<CustomerMessage[]>(() => getCustomerMessages());
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

  useEffect(() => {
    setEditedProductName(selectedGuess?.productName || "");
  }, [selectedGroup?.folder, selectedGuess?.productName]);

  function persistMessages(next: CustomerMessage[]) {
    setMessages(next);
    saveCustomerMessages(next);
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
      const token = getSettings().inboxWebhookToken?.trim();
      const response = await fetch("/api/inbox", {
        cache: "no-store",
        headers: token ? { "x-inbox-token": token } : undefined,
      });
      const data = (await response.json()) as { messages?: CustomerMessage[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "sync failed");
      const incoming = safeArray(data.messages);
      const merged = mergeCustomerMessages(messages, incoming, orders);
      persistMessages(merged.messages);
      const touched = merged.messages.find((message) => message.id === merged.firstTouchedId);
      if (touched) {
        setActiveColumn(columnForBusinessType(touched.businessType));
        setSelectedFolder(getFolderName(touched));
      }
      setNotice(incoming.length ? `已同步 ${incoming.length} 条外部消息，同一联系人会合并到同一个客户文件夹` : "外部收件箱暂无消息");
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      setNotice(`同步外部消息失败：${message}。请确认服务器 INBOX_WEBHOOK_TOKEN 与设置页 Webhook Token 一致`);
    }
  }

  function loadDemoMessages() {
    const existing = messages.filter((item) => !item.id.startsWith("msg_demo_"));
    persistMessages([...sampleMessages, ...existing]);
    setActiveColumn("xianyu");
    setSelectedFolder(sampleMessages[0].customerFolder || sampleMessages[0].customerName);
    setNotice("已加载演示消息");
  }

  function updateFolder(oldFolder: string, nextFolder: string) {
    const folder = nextFolder.trim() || "待归类";
    const now = new Date().toISOString();
    persistMessages(messages.map((item) => (getFolderName(item) === oldFolder ? { ...item, customerFolder: folder, updatedAt: now } : item)));
    setSelectedFolder(folder);
  }

  async function clearServerFolder(target: CustomerMessage) {
    try {
      await fetch("/api/inbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
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

  function openOrderProcessing(group: CustomerFolderGroup) {
    const now = new Date().toISOString();
    const guess = inferProductGuess(group, recognitionExperiences);
    const groupForOrder: CustomerFolderGroup = guess.autoConfirm
      ? {
          ...group,
          latest: {
            ...group.latest,
            productName: guess.productName,
            productGuess: guess.productName,
            productConfidence: guess.confidence,
            productRecognitionStatus: "自动识别",
            productRecognitionRuleId: guess.ruleId,
            productConfirmed: true,
          },
          messages: group.messages.map((message) => ({
            ...message,
            productName: guess.productName,
            productGuess: guess.productName,
            productConfidence: guess.confidence,
            productRecognitionStatus: "自动识别" as const,
            productRecognitionRuleId: guess.ruleId,
            productConfirmed: true,
          })),
        }
      : group;
    const existingOrder = selectedOrder;
    const nextOrder = buildOrderFromFolder(groupForOrder, existingOrder, now);
    const orderId = nextOrder.id;
    persistOrders(existingOrder ? orders.map((order) => (order.id === existingOrder.id ? nextOrder : order)) : [nextOrder, ...orders]);
    persistMessages(
      messages.map((message) =>
        getFolderName(message) === group.folder
          ? {
              ...message,
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

  function selectColumn(column: MainColumn) {
    setActiveColumn(column);
    setSelectedFolder("");
  }

  const activeColumnInfo = mainColumns.find((item) => item.id === activeColumn) || mainColumns[0];

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-lg border border-amber-100 bg-white shadow-sm shadow-amber-100/50">
        <div className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-6">
          <div>
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">客户文件夹总览</div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950 lg:text-3xl">消息中心</h1>
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

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="栏目">
            <div className="space-y-2">
              {mainColumns.map((column) => {
                const list = messages.filter((message) => belongsToColumn(message, column.id, orders));
                const unread = list.filter(isUnread).length;
                return (
                  <button
                    key={column.id}
                    className={`w-full rounded-lg border p-3 text-left transition ${activeColumn === column.id ? "border-slate-950 bg-slate-950 text-white" : "border-amber-100 bg-white hover:bg-emerald-50"}`}
                    onClick={() => selectColumn(column.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{column.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeColumn === column.id ? "bg-white text-slate-950" : unread ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-slate-600"}`}>
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
                      <h2 className="text-base font-semibold text-slate-950">{subGroup.name}</h2>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-slate-600">{subGroup.groups.length} 个客户</span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {subGroup.groups.map((group) => {
                        const unread = group.messages.filter(isUnread).length;
                        const active = selectedGroup?.folder === group.folder;
                        return (
                          <button
                            key={group.folder}
                            className={`rounded-lg border p-4 text-left transition ${active ? "border-slate-950 bg-slate-950 text-white" : "border-amber-100 bg-white hover:bg-emerald-50"}`}
                            onClick={() => setSelectedFolder(group.folder)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">{group.folder}</div>
                                <div className={`mt-1 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>{group.latest.platform} · {businessTypeLabels[group.latest.businessType]} · {group.messages.length} 条消息</div>
                              </div>
                              {unread ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">{unread}</span> : <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-white text-slate-950" : "bg-emerald-50 text-emerald-700"}`}>已读</span>}
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
                    <InfoPill label="业务类型" value={businessTypeLabels[selectedGroup.latest.businessType]} />
                    <InfoPill label="订单状态" value={selectedOrder ? selectedOrder.status : "未进入订单"} />
                  </div>
                  {selectedGuess ? (
                    <div className="rounded-lg border border-amber-100 bg-[#fffaf2] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-950">商品/服务识别</div>
                          <div className="mt-1 text-xs text-slate-500">{selectedGuess.reason}</div>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${selectedGuess.autoConfirm ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {selectedGuess.source}
                        </span>
                      </div>
                      <div className="mt-3 rounded-md border border-amber-100 bg-white p-3">
                        <div className="text-xs font-semibold text-slate-500">当前识别</div>
                        <div className="mt-1 text-sm font-semibold text-slate-950">{selectedGuess.productName}</div>
                        <div className="mt-1 text-xs text-slate-500">分类：{selectedGuess.subCategory} · 置信度：{Math.round(selectedGuess.confidence * 100)}%</div>
                      </div>
                      {selectedGuess.autoConfirm || selectedGroup.latest.productConfirmed ? (
                        <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
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
                    <button className={primaryButtonClass} onClick={() => openOrderProcessing(selectedGroup)}>进入客户订单处理</button>
                    {activeColumn === "closed" ? (
                      <button className={secondaryButtonClass} onClick={() => markFolderUnclosed(selectedGroup)}>未成交</button>
                    ) : (
                      <button className={secondaryButtonClass} onClick={() => markFolderClosed(selectedGroup)}>标记已成交</button>
                    )}
                    <button className={secondaryButtonClass} onClick={() => archiveFolder(selectedGroup)}>归档</button>
                    <button className="inline-flex min-h-10 items-center justify-center rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm shadow-amber-100/60 transition hover:bg-rose-50" onClick={() => deleteFolder(selectedGroup)}>删除文件夹</button>
                  </div>
                  {selectedOrder ? <div className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">已连接客户订单：{selectedOrder.orderTitle || selectedOrder.customerName}</div> : null}
                </div>
                <div className="rounded-lg border border-amber-100 bg-[#fffaf2] p-4">
                  <div className="text-sm font-semibold text-slate-950">最近消息</div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{selectedGroup.latest.rawMessage}</p>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold text-slate-800">文件夹消息记录</div>
                <div className="space-y-3">
                  {selectedGroup.messages.map((message) => (
                    <div key={message.id} className="rounded-md border border-amber-100 bg-white p-3 text-sm">
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
