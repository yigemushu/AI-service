import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { BusinessType, CustomerMessage, InboxConversation, InboxMessage, InboxSourceChannel } from "./types";

const conversationsFilePath = path.join(process.cwd(), "data", "inbox-conversations.json");

export type InboxConversationPayload = {
  shopAlias?: unknown;
  externalConversationId?: unknown;
  platformThreadId?: unknown;
  conversationKey?: unknown;
  externalMessageId?: unknown;
  messageText?: unknown;
  messageTime?: unknown;
  direction?: unknown;
  itemTitle?: unknown;
  customerFolder?: unknown;
  customerName?: unknown;
  platform?: unknown;
  sourceChannel?: unknown;
  businessType?: unknown;
  rawMessage?: unknown;
  text?: unknown;
  sourceUrl?: unknown;
};

type NormalizedInboxPayload = {
  shopAlias: string;
  externalConversationId: string;
  platformThreadId: string;
  externalMessageId: string;
  itemTitle: string;
  customerFolder: string;
  customerName: string;
  platform: string;
  sourceChannel: string;
  businessType: BusinessType;
  content: string;
  sourceUrl: string;
  role: InboxMessage["role"];
  messageTime: string;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKeyPart(value: unknown, fallback = "") {
  const text = safeString(value) || fallback;
  return text.trim().toLowerCase().replace(/\s+/g, "-").replace(/[:|]/g, "-");
}

function normalizeBusinessType(value: unknown): BusinessType {
  const text = safeString(value);
  const map: Record<string, BusinessType> = {
    sam: "sam",
    xianyu: "xianyu",
    virtual: "virtual",
    local: "local",
    trade: "trade",
    山姆代下单: "sam",
    闲鱼卖货: "xianyu",
    虚拟服务: "virtual",
    本地服务: "local",
    外贸询盘: "trade",
  };
  return map[text] || "xianyu";
}

function normalizeSourceChannel(value: unknown): InboxSourceChannel {
  const text = safeString(value);
  if (["网站手动", "浏览器插件", "安卓助手", "iPhone快捷入口", "官方接口", "Webhook", "其他"].includes(text)) return text as InboxSourceChannel;
  return "Webhook";
}

function normalizeRole(value: unknown): InboxMessage["role"] {
  const text = safeString(value).toLowerCase();
  if (text === "outbound" || text === "assistant" || text === "seller") return "assistant";
  if (text === "seller_note" || text === "note") return "seller_note";
  return "customer";
}

function normalizeUrl(value: unknown) {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return text.split("#")[0] || "";
  }
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePayload(payload: InboxConversationPayload): NormalizedInboxPayload {
  const content = safeString(payload.messageText) || safeString(payload.rawMessage) || safeString(payload.text);
  if (!content) throw new Error("messageText is required");
  const messageTime = safeString(payload.messageTime) || new Date().toISOString();
  const customerName = safeString(payload.customerName) || "unknown-customer";
  return {
    shopAlias: safeString(payload.shopAlias) || "default-shop",
    externalConversationId: safeString(payload.externalConversationId),
    platformThreadId: safeString(payload.platformThreadId),
    externalMessageId: safeString(payload.externalMessageId),
    itemTitle: safeString(payload.itemTitle),
    customerFolder: safeString(payload.customerFolder) || customerName,
    customerName,
    platform: safeString(payload.platform) || "未识别",
    sourceChannel: normalizeSourceChannel(payload.sourceChannel),
    businessType: normalizeBusinessType(payload.businessType),
    content,
    sourceUrl: normalizeUrl(payload.sourceUrl),
    role: normalizeRole(payload.direction),
    messageTime,
  };
}

export function buildConversationKey(payload: InboxConversationPayload) {
  const normalized = normalizePayload(payload);
  const platform = normalizeKeyPart(normalized.platform, "unknown-platform");
  const shopAlias = normalizeKeyPart(normalized.shopAlias, "default-shop");
  const providedKey = safeString(payload.conversationKey);
  if (providedKey) return `provided:${normalizeKeyPart(providedKey)}`;
  if (normalized.externalConversationId) return `${platform}:${shopAlias}:external:${normalizeKeyPart(normalized.externalConversationId)}`;
  if (normalized.platformThreadId) return `${platform}:${shopAlias}:thread:${normalizeKeyPart(normalized.platformThreadId)}`;
  if (normalized.sourceUrl) return `${platform}:${shopAlias}:url:${normalizeKeyPart(normalized.sourceUrl)}`;
  if (normalized.itemTitle) return `${platform}:${shopAlias}:item:${normalizeKeyPart(normalized.itemTitle)}`;
  if (normalized.customerFolder) return `${platform}:${shopAlias}:folder:${normalizeKeyPart(normalized.customerFolder)}`;
  return `${platform}:${shopAlias}:name:${normalizeKeyPart(normalized.customerName, "unknown-customer")}`;
}

export function buildMessageFingerprint(payload: InboxConversationPayload) {
  const normalized = normalizePayload(payload);
  if (normalized.externalMessageId) return `${normalizeKeyPart(normalized.platform, "unknown-platform")}:message:${normalizeKeyPart(normalized.externalMessageId)}`;
  return [
    buildConversationKey(payload),
    normalized.role,
    normalizeKeyPart(normalized.content),
    normalizeKeyPart(normalized.messageTime),
  ].join(":");
}

function messageFingerprint(message: InboxMessage, conversationKey: string) {
  if (message.externalMessageId) return `${normalizeKeyPart("") || "unknown-platform"}:message:${normalizeKeyPart(message.externalMessageId)}`;
  return [conversationKey, message.role, normalizeKeyPart(message.content), normalizeKeyPart(message.createdAt)].join(":");
}

export async function readInboxConversations() {
  try {
    const raw = await readFile(conversationsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InboxConversation[]) : [];
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : "";
    if (code === "ENOENT") return [];
    if (error instanceof SyntaxError) throw new Error("inbox-conversations.json is not valid JSON");
    return [];
  }
}

export async function writeInboxConversations(conversations: InboxConversation[]) {
  await mkdir(path.dirname(conversationsFilePath), { recursive: true });
  await writeFile(conversationsFilePath, JSON.stringify(conversations, null, 2), "utf8");
}

export async function upsertInboxConversationFromPayload(payload: InboxConversationPayload) {
  const normalized = normalizePayload(payload);
  const conversationKey = buildConversationKey(payload);
  const fingerprint = buildMessageFingerprint(payload);
  const conversations = await readInboxConversations();
  const existingIndex = conversations.findIndex((conversation) => conversation.conversationKey === conversationKey || (safeString(payload.conversationKey) && conversation.id === safeString(payload.conversationKey)));
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = conversations[existingIndex];
    const existingFingerprints = new Set(existing.messages.map((message) => messageFingerprint(message, existing.conversationKey)));
    const hasExternalDuplicate = normalized.externalMessageId && existing.messages.some((message) => message.externalMessageId === normalized.externalMessageId);
    if (hasExternalDuplicate || existingFingerprints.has(fingerprint)) {
      return { conversation: existing, conversationId: existing.id, duplicated: true };
    }
    const message: InboxMessage = {
      id: createId("inmsg"),
      conversationId: existing.id,
      externalMessageId: normalized.externalMessageId || undefined,
      role: normalized.role,
      content: normalized.content,
      sourceUrl: normalized.sourceUrl || undefined,
      createdAt: normalized.messageTime,
    };
    const updated: InboxConversation = {
      ...existing,
      platform: existing.platform || normalized.platform,
      shopAlias: existing.shopAlias || normalized.shopAlias,
      businessType: existing.businessType || normalized.businessType,
      customerName: existing.customerName === "unknown-customer" ? normalized.customerName : existing.customerName,
      customerFolder: existing.customerFolder || normalized.customerFolder,
      itemTitle: existing.itemTitle || normalized.itemTitle || undefined,
      sourceChannel: normalized.sourceChannel,
      sourceUrl: existing.sourceUrl || normalized.sourceUrl || undefined,
      externalConversationId: existing.externalConversationId || normalized.externalConversationId || normalized.platformThreadId || undefined,
      latestMessageText: normalized.content,
      latestMessageAt: normalized.messageTime,
      status: normalized.role === "customer" ? "未处理" : existing.status,
      unreadCount: normalized.role === "customer" ? existing.unreadCount + 1 : existing.unreadCount,
      isNew: normalized.role === "customer" ? true : existing.isNew,
      updatedAt: now,
      messages: [...existing.messages, message],
    };
    const next = [updated, ...conversations.filter((_, index) => index !== existingIndex)].slice(0, 1000);
    await writeInboxConversations(next);
    return { conversation: updated, conversationId: updated.id, duplicated: false };
  }

  const conversationId = createId("conv");
  const message: InboxMessage = {
    id: createId("inmsg"),
    conversationId,
    externalMessageId: normalized.externalMessageId || undefined,
    role: normalized.role,
    content: normalized.content,
    sourceUrl: normalized.sourceUrl || undefined,
    createdAt: normalized.messageTime,
  };
  const conversation: InboxConversation = {
    id: conversationId,
    conversationKey,
    platform: normalized.platform,
    shopAlias: normalized.shopAlias,
    businessType: normalized.businessType,
    customerName: normalized.customerName,
    customerFolder: normalized.customerFolder,
    itemTitle: normalized.itemTitle || undefined,
    sourceChannel: normalized.sourceChannel,
    sourceUrl: normalized.sourceUrl || undefined,
    externalConversationId: normalized.externalConversationId || normalized.platformThreadId || undefined,
    latestMessageText: normalized.content,
    latestMessageAt: normalized.messageTime,
    status: normalized.role === "customer" ? "未处理" : "已分析",
    unreadCount: normalized.role === "customer" ? 1 : 0,
    isNew: normalized.role === "customer",
    createdAt: normalized.messageTime,
    updatedAt: now,
    messages: [message],
  };
  await writeInboxConversations([conversation, ...conversations].slice(0, 1000));
  return { conversation, conversationId, duplicated: false };
}

export function convertLegacyMessagesToConversations(messages: CustomerMessage[]) {
  return messages.map((message) => {
    const payload: InboxConversationPayload = {
      customerName: message.customerName,
      customerFolder: message.customerFolder,
      platform: message.platform,
      shopAlias: "default-shop",
      sourceChannel: message.sourceChannel,
      businessType: message.businessType,
      rawMessage: message.rawMessage,
      sourceUrl: message.sourceUrl,
    };
    const conversationKey = buildConversationKey(payload);
    const turns = message.conversation?.length
      ? message.conversation
      : [{ id: `${message.id}_initial`, role: "customer" as const, content: message.rawMessage, createdAt: message.createdAt }];
    const inboxMessages: InboxMessage[] = turns.map((turn) => ({
      id: turn.id,
      conversationId: message.id,
      role: turn.role,
      content: turn.content,
      sourceUrl: message.sourceUrl,
      createdAt: turn.createdAt,
    }));
    return {
      id: message.id,
      conversationKey,
      platform: String(message.platform || "未识别"),
      shopAlias: "default-shop",
      businessType: message.businessType,
      customerName: message.customerName || "unknown-customer",
      customerFolder: message.customerFolder || message.customerName || "unknown-customer",
      sourceChannel: message.sourceChannel || "Webhook",
      sourceUrl: message.sourceUrl,
      latestMessageText: inboxMessages[inboxMessages.length - 1]?.content || message.rawMessage,
      latestMessageAt: inboxMessages[inboxMessages.length - 1]?.createdAt || message.updatedAt,
      status: message.status,
      unreadCount: message.isNew ? Math.max(1, inboxMessages.filter((turn) => turn.role === "customer").length) : 0,
      isNew: message.isNew,
      linkedOrderId: message.linkedOrderId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      messages: inboxMessages,
      legacyMessageId: message.id,
    } satisfies InboxConversation;
  });
}

export async function appendInboxConversationMessage(input: {
  conversationId: string;
  role: InboxMessage["role"];
  content: string;
  sourceUrl?: string;
  externalMessageId?: string;
  createdAt?: string;
}) {
  const conversations = await readInboxConversations();
  const index = conversations.findIndex((conversation) => conversation.id === input.conversationId);
  if (index < 0) throw new Error("Conversation not found");
  const existing = conversations[index];
  const content = safeString(input.content);
  if (!content) throw new Error("content is required");
  const createdAt = safeString(input.createdAt) || new Date().toISOString();
  const duplicate = existing.messages.some((message) =>
    (input.externalMessageId && message.externalMessageId === input.externalMessageId) ||
    (message.role === input.role && message.content === content && message.createdAt === createdAt),
  );
  if (duplicate) return { conversation: existing, duplicated: true };
  const message: InboxMessage = {
    id: createId("inmsg"),
    conversationId: existing.id,
    externalMessageId: safeString(input.externalMessageId) || undefined,
    role: input.role,
    content,
    sourceUrl: safeString(input.sourceUrl) || existing.sourceUrl,
    createdAt,
  };
  const updated: InboxConversation = {
    ...existing,
    latestMessageText: content,
    latestMessageAt: createdAt,
    status: input.role === "customer" ? "未处理" : existing.status === "未处理" ? "已分析" : existing.status,
    unreadCount: input.role === "customer" ? existing.unreadCount + 1 : existing.unreadCount,
    isNew: input.role === "customer" ? true : existing.isNew,
    updatedAt: new Date().toISOString(),
    messages: [...existing.messages, message],
  };
  await writeInboxConversations([updated, ...conversations.filter((_, itemIndex) => itemIndex !== index)].slice(0, 1000));
  return { conversation: updated, duplicated: false };
}
