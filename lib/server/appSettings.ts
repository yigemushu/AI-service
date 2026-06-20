import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type TokenSource = "env" | "settings" | "none";

export type AppSettings = {
  inboxWebhookToken: string;
  updatedAt?: string;
};

const dataDir = path.join(process.cwd(), "data");
const settingsPath = path.join(dataDir, "app-settings.json");

function cleanToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function readStoredAppSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      inboxWebhookToken: cleanToken(parsed.inboxWebhookToken),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : "";
    if (code === "ENOENT") return { inboxWebhookToken: "" };
    if (error instanceof SyntaxError) {
      throw new Error("app-settings.json is not valid JSON");
    }
    return { inboxWebhookToken: "" };
  }
}

export async function saveStoredAppSettings(settings: Partial<AppSettings>) {
  const token = cleanToken(settings.inboxWebhookToken);
  await mkdir(dataDir, { recursive: true });
  const next: AppSettings = {
    inboxWebhookToken: token,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function getEffectiveInboxWebhookToken(): Promise<{ token: string; tokenSource: TokenSource; hasSettingsToken: boolean }> {
  const envToken = cleanToken(process.env.INBOX_WEBHOOK_TOKEN);
  if (envToken) {
    const settings = await readStoredAppSettings().catch(() => ({ inboxWebhookToken: "" }));
    return { token: envToken, tokenSource: "env", hasSettingsToken: Boolean(settings.inboxWebhookToken) };
  }

  const settings = await readStoredAppSettings();
  if (settings.inboxWebhookToken) {
    return { token: settings.inboxWebhookToken, tokenSource: "settings", hasSettingsToken: true };
  }

  return { token: "", tokenSource: "none", hasSettingsToken: false };
}
