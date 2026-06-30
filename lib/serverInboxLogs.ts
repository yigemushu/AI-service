import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type InboxLogEntry = {
  id: string;
  receivedAt: string;
  platform: string;
  customerName: string;
  messageSummary: string;
  conversationId: string;
  duplicated: boolean;
  status: "success" | "failed";
  httpStatus: number;
  error?: string;
};

const dataDir = path.join(process.cwd(), "data");
const logPath = path.join(dataDir, "inbox-logs.json");

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function readInboxLogs() {
  try {
    const raw = await readFile(logPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InboxLogEntry[]) : [];
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return [];
    throw error;
  }
}

export async function appendInboxLog(entry: Omit<InboxLogEntry, "id" | "receivedAt">) {
  await ensureDataDir();
  const logs = await readInboxLogs().catch(() => []);
  const next: InboxLogEntry = {
    id: `inbox_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date().toISOString(),
    platform: safeString(entry.platform),
    customerName: safeString(entry.customerName),
    messageSummary: safeString(entry.messageSummary).slice(0, 120),
    conversationId: safeString(entry.conversationId),
    duplicated: Boolean(entry.duplicated),
    status: entry.status,
    httpStatus: entry.httpStatus,
    error: safeString(entry.error),
  };
  await writeFile(logPath, JSON.stringify([next, ...logs].slice(0, 100), null, 2), "utf8");
  return next;
}
