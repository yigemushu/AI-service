import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { BrowserPluginStatus, BrowserPluginStatusKind, SourcePlatform } from "./types";

const pluginStatusFilePath = path.join(process.cwd(), "data", "browser-plugin-status.json");

type PluginStatusPayload = {
  id?: unknown;
  kind?: unknown;
  ok?: unknown;
  platform?: unknown;
  sourceUrl?: unknown;
  commandId?: unknown;
  messageId?: unknown;
  mode?: unknown;
  action?: unknown;
  error?: unknown;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKind(value: unknown): BrowserPluginStatusKind {
  if (value === "config") return "config";
  if (value === "outbound") return "outbound";
  return "autoSync";
}

function createPluginStatusId() {
  return `plugin_status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readPluginStatusFile() {
  try {
    const raw = await readFile(pluginStatusFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BrowserPluginStatus[]) : [];
  } catch {
    return [];
  }
}

async function writePluginStatusFile(statuses: BrowserPluginStatus[]) {
  await mkdir(path.dirname(pluginStatusFilePath), { recursive: true });
  await writeFile(pluginStatusFilePath, JSON.stringify(statuses, null, 2), "utf8");
}

export async function getBrowserPluginStatuses(filters?: { kind?: BrowserPluginStatusKind; platform?: string }) {
  const statuses = await readPluginStatusFile();
  return statuses.filter((status) => {
    const kindMatches = !filters?.kind || status.kind === filters.kind;
    const platformMatches = !filters?.platform || String(status.platform || "").toLowerCase() === filters.platform.toLowerCase();
    return kindMatches && platformMatches;
  });
}

export async function addBrowserPluginStatus(payload: PluginStatusPayload) {
  const now = new Date().toISOString();
  const status: BrowserPluginStatus = {
    id: safeString(payload.id) || createPluginStatusId(),
    kind: normalizeKind(payload.kind),
    ok: payload.ok !== false,
    platform: (safeString(payload.platform) || "闲鱼") as SourcePlatform | string,
    sourceUrl: safeString(payload.sourceUrl),
    commandId: safeString(payload.commandId),
    messageId: safeString(payload.messageId),
    mode: safeString(payload.mode),
    action: safeString(payload.action),
    error: safeString(payload.error),
    createdAt: now,
    updatedAt: now,
  };

  const statuses = await readPluginStatusFile();
  const next = [status, ...statuses].slice(0, 200);
  await writePluginStatusFile(next);
  return status;
}
