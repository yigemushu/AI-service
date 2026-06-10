import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { BusinessType, CustomerMessage, InboxSourceChannel } from "./types";

const inboxFilePath = path.join(process.cwd(), "data", "inbox-messages.json");

type InboxPayload = {
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
  if (!rawMessage) throw new Error("text is required");

  const now = new Date().toISOString();
  const message: CustomerMessage = {
    id: createServerId(),
    customerName: safeString(payload.customerName) || "待识别客户",
    platform: safeString(payload.platform) || "未识别",
    sourceChannel: normalizeSourceChannel(payload.sourceChannel),
    businessType: normalizeBusinessType(payload.businessType),
    rawMessage,
    sourceUrl: safeString(payload.sourceUrl),
    status: "未处理",
    isNew: true,
    createdAt: now,
    updatedAt: now,
  };

  const messages = await readInboxFile();
  const next = [message, ...messages].slice(0, 500);
  await writeInboxFile(next);
  return message;
}
