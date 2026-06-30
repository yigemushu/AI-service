import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const pluginHeartbeatFilePath = path.join(process.cwd(), "data", "plugin-status.json");

export type PluginPageStatus = "xianyu-detected" | "not-detected";

export type PluginHeartbeat = {
  id: string;
  siteOrigin: string;
  platform: string;
  shopAlias: string;
  pageStatus: PluginPageStatus;
  autoSyncEnabled: boolean;
  lastSyncAt: string;
  lastCapturedSummary: string;
  extensionVersion: string;
  createdAt: string;
  updatedAt: string;
};

type PluginHeartbeatPayload = {
  siteOrigin?: unknown;
  platform?: unknown;
  shopAlias?: unknown;
  pageStatus?: unknown;
  autoSyncEnabled?: unknown;
  lastSyncAt?: unknown;
  lastCapturedSummary?: unknown;
  extensionVersion?: unknown;
};

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function safeBoolean(value: unknown) {
  return value === true;
}

function normalizePageStatus(value: unknown): PluginPageStatus {
  return value === "xianyu-detected" ? "xianyu-detected" : "not-detected";
}

function normalizeHeartbeat(payload: PluginHeartbeatPayload, existing?: PluginHeartbeat): PluginHeartbeat {
  const now = new Date().toISOString();
  return {
    id: existing?.id || "latest",
    siteOrigin: safeString(payload.siteOrigin, existing?.siteOrigin || ""),
    platform: safeString(payload.platform, existing?.platform || "闲鱼"),
    shopAlias: safeString(payload.shopAlias, existing?.shopAlias || "default-shop"),
    pageStatus: normalizePageStatus(payload.pageStatus ?? existing?.pageStatus),
    autoSyncEnabled: safeBoolean(payload.autoSyncEnabled),
    lastSyncAt: safeString(payload.lastSyncAt, existing?.lastSyncAt || ""),
    lastCapturedSummary: safeString(payload.lastCapturedSummary, existing?.lastCapturedSummary || "").slice(0, 160),
    extensionVersion: safeString(payload.extensionVersion, existing?.extensionVersion || ""),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function isPluginOnline(status: PluginHeartbeat | null, ttlMs = 120_000) {
  if (!status?.updatedAt) return false;
  const updatedAt = new Date(status.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= ttlMs;
}

export async function readPluginHeartbeat() {
  try {
    const raw = await readFile(pluginHeartbeatFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PluginHeartbeat) : null;
  } catch {
    return null;
  }
}

export async function writePluginHeartbeat(payload: PluginHeartbeatPayload) {
  const existing = await readPluginHeartbeat();
  const status = normalizeHeartbeat(payload, existing || undefined);
  await mkdir(path.dirname(pluginHeartbeatFilePath), { recursive: true });
  await writeFile(pluginHeartbeatFilePath, JSON.stringify(status, null, 2), "utf8");
  return status;
}
