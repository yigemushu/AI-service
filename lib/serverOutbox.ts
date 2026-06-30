import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { OutboundReplyCommand, OutboundReplyStatus, SourcePlatform } from "./types";

const outboxFilePath = path.join(process.cwd(), "data", "outbox-commands.json");

type OutboxPayload = {
  id?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  orderId?: unknown;
  customerFolder?: unknown;
  customerName?: unknown;
  platform?: unknown;
  itemTitle?: unknown;
  platformThreadId?: unknown;
  externalConversationId?: unknown;
  sourceUrl?: unknown;
  reply?: unknown;
  mode?: unknown;
  status?: unknown;
  error?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMode(value: unknown): OutboundReplyCommand["mode"] {
  if (value === "fill" || value === "send" || value === "plugin-default") return value;
  return "plugin-default";
}

function normalizeStatus(value: unknown): OutboundReplyStatus | "" {
  if (value === "pending" || value === "processing" || value === "filled" || value === "sent" || value === "failed" || value === "cancelled") return value;
  return "";
}

function createOutboxId() {
  return `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readOutboxFile() {
  try {
    const raw = await readFile(outboxFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboundReplyCommand[]) : [];
  } catch {
    return [];
  }
}

async function writeOutboxFile(commands: OutboundReplyCommand[]) {
  await mkdir(path.dirname(outboxFilePath), { recursive: true });
  await writeFile(outboxFilePath, JSON.stringify(commands, null, 2), "utf8");
}

export async function getOutboxCommands(filters?: { status?: OutboundReplyStatus; platform?: string }) {
  const commands = await readOutboxFile();
  return commands.filter((command) => {
    const statusMatches = !filters?.status || command.status === filters.status;
    const platformMatches = !filters?.platform || String(command.platform || "").toLowerCase() === filters.platform.toLowerCase();
    return statusMatches && platformMatches;
  });
}

export async function addOutboxCommand(payload: OutboxPayload) {
  const reply = safeString(payload.reply);
  if (!reply) throw new Error("reply is required");
  const sourceUrl = safeString(payload.sourceUrl);
  if (!sourceUrl) throw new Error("sourceUrl is required");

  const now = new Date().toISOString();
  const command: OutboundReplyCommand = {
    id: createOutboxId(),
    conversationId: safeString(payload.conversationId),
    messageId: safeString(payload.messageId),
    orderId: safeString(payload.orderId),
    customerFolder: safeString(payload.customerFolder) || safeString(payload.customerName) || "待归类",
    customerName: safeString(payload.customerName) || "待识别客户",
    platform: (safeString(payload.platform) || "闲鱼") as SourcePlatform | string,
    itemTitle: safeString(payload.itemTitle),
    platformThreadId: safeString(payload.platformThreadId),
    externalConversationId: safeString(payload.externalConversationId),
    sourceUrl,
    reply,
    mode: normalizeMode(payload.mode),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const commands = await readOutboxFile();
  const next = [command, ...commands].slice(0, 500);
  await writeOutboxFile(next);
  return command;
}

export async function updateOutboxCommand(payload: OutboxPayload) {
  const id = safeString(payload.id);
  if (!id) throw new Error("id is required");
  const nextStatus = normalizeStatus(payload.status);
  if (!nextStatus) throw new Error("status is required");

  const commands = await readOutboxFile();
  const index = commands.findIndex((command) => command.id === id);
  if (index < 0) throw new Error("outbox command not found");
  const now = new Date().toISOString();
  const error = nextStatus === "pending" || nextStatus === "processing" ? "" : safeString(payload.error);
  const updated: OutboundReplyCommand = {
    ...commands[index],
    status: nextStatus,
    error,
    updatedAt: now,
  };
  const next = commands.map((command, commandIndex) => (commandIndex === index ? updated : command));
  await writeOutboxFile(next);
  return updated;
}
