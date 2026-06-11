import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { BusinessType, CustomerMessage, InboxSourceChannel } from "./types";

const inboxFilePath = path.join(process.cwd(), "data", "inbox-messages.json");

type InboxPayload = {
  customerFolder?: unknown;
  customerName?: unknown;
  platform?: unknown;
  sourceChannel?: unknown;
  businessType?: unknown;
  rawMessage?: unknown;
  text?: unknown;
  sourceUrl?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBusinessType(value: unknown): BusinessType {
  if (value === "sam" || value === "xianyu" || value === "virtual" || value === "local" || value === "trade") return value;
  return "xianyu";
}

function normalizeSourceChannel(value: unknown): InboxSourceChannel {
  const text = safeString(value);
  if (["网站手动", "浏览器插件", "安卓助手", "iPhone快捷入口", "官方接口", "Webhook", "其他"].includes(text)) return text as InboxSourceChannel;
  return "Webhook";
}

function createServerId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeUrl(value: string) {
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

function getContactKey(message: Pick<CustomerMessage, "customerName" | "platform" | "sourceUrl">) {
  const platform = normalizeKeyPart(String(message.platform || "未识别"));
  const customerName = normalizeKeyPart(message.customerName || "");
  if (isUsableCustomerName(message.customerName || "")) return `${platform}:name:${customerName}`;
  const sourceUrl = normalizeUrl(message.sourceUrl || "");
  if (sourceUrl) return `${platform}:url:${sourceUrl}`;
  return "";
}

function getFolderName(payload: InboxPayload, customerName: string) {
  const folder = safeString(payload.customerFolder);
  if (folder) return folder;
  return isUsableCustomerName(customerName) ? customerName : "待归类";
}

function getStoredFolderName(message: Pick<CustomerMessage, "customerFolder" | "customerName">) {
  return (message.customerFolder || (isUsableCustomerName(message.customerName || "") ? message.customerName : "待归类")).trim() || "待归类";
}

function appendRawMessage(previous: string, next: string, createdAt: string) {
  if (!previous.trim()) return next;
  if (previous.includes(next)) return previous;
  return `${previous}\n\n[客户新消息 ${new Date(createdAt).toLocaleString("zh-CN")}]\n${next}`;
}

async function readInboxFile() {
  try {
    const raw = await readFile(inboxFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomerMessage[]) : [];
  } catch {
    return [];
  }
}

async function writeInboxFile(messages: CustomerMessage[]) {
  await mkdir(path.dirname(inboxFilePath), { recursive: true });
  await writeFile(inboxFilePath, JSON.stringify(messages, null, 2), "utf8");
}

export async function getServerInboxMessages() {
  return readInboxFile();
}

export async function addServerInboxMessage(payload: InboxPayload) {
  const rawMessage = safeString(payload.rawMessage) || safeString(payload.text);
  if (!rawMessage) throw new Error("rawMessage is required");

  const now = new Date().toISOString();
  const customerName = safeString(payload.customerName) || "待识别客户";
  const message: CustomerMessage = {
    id: createServerId(),
    customerFolder: getFolderName(payload, customerName),
    customerName,
    platform: safeString(payload.platform) || "未识别",
    sourceChannel: normalizeSourceChannel(payload.sourceChannel),
    businessType: normalizeBusinessType(payload.businessType),
    rawMessage,
    sourceUrl: safeString(payload.sourceUrl),
    status: "未处理",
    isNew: true,
    createdAt: now,
    updatedAt: now,
    conversation: [{ id: `${createServerId()}_customer`, role: "customer", content: rawMessage, createdAt: now }],
  };

  const messages = await readInboxFile();
  const contactKey = message.customerFolder && message.customerFolder !== "待归类" ? `folder:${normalizeKeyPart(message.customerFolder)}` : getContactKey(message);
  const existingIndex = contactKey ? messages.findIndex((item) => getContactKey(item) === contactKey) : -1;
  const folderIndex = contactKey.startsWith("folder:") ? messages.findIndex((item) => `folder:${normalizeKeyPart(item.customerFolder || "")}` === contactKey) : -1;
  const matchIndex = folderIndex >= 0 ? folderIndex : existingIndex;
  if (matchIndex >= 0) {
    const existing = messages[matchIndex];
    const updated: CustomerMessage = {
      ...existing,
      customerFolder: existing.customerFolder || message.customerFolder,
      customerName: existing.customerName === "待识别客户" ? message.customerName : existing.customerName,
      platform: existing.platform || message.platform,
      sourceChannel: message.sourceChannel,
      businessType: existing.businessType || message.businessType,
      rawMessage: appendRawMessage(existing.rawMessage, rawMessage, now),
      sourceUrl: existing.sourceUrl || message.sourceUrl,
      status: "未处理",
      isNew: true,
      updatedAt: now,
      conversation: [
        ...(existing.conversation || [{ id: `${existing.id}_initial`, role: "customer", content: existing.rawMessage, createdAt: existing.createdAt }]),
        { id: `${createServerId()}_customer`, role: "customer", content: rawMessage, createdAt: now },
      ],
    };
    const next = [updated, ...messages.filter((_, index) => index !== matchIndex)].slice(0, 500);
    await writeInboxFile(next);
    return updated;
  }
  const next = [message, ...messages].slice(0, 500);
  await writeInboxFile(next);
  return message;
}

export async function deleteServerInboxCustomer(payload: InboxPayload) {
  const folder = safeString(payload.customerFolder);
  const customerName = safeString(payload.customerName);
  const platform = safeString(payload.platform);
  const messages = await readInboxFile();
  const next = messages.filter((message) => {
    const sameFolder = folder && normalizeKeyPart(getStoredFolderName(message)) === normalizeKeyPart(folder);
    const sameCustomer = customerName && normalizeKeyPart(message.customerName) === normalizeKeyPart(customerName);
    const samePlatform = !platform || normalizeKeyPart(String(message.platform || "")) === normalizeKeyPart(platform);
    return !(samePlatform && (sameFolder || sameCustomer));
  });
  await writeInboxFile(next);
  return { deleted: messages.length - next.length };
}
