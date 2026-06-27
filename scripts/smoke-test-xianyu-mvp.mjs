import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const outboxFilePath = path.join(process.cwd(), "data", "outbox-commands.json");
const pluginStatusFilePath = path.join(process.cwd(), "data", "browser-plugin-status.json");
const baseUrl = new URL(process.env.SITE_URL || process.env.BASE_URL || "http://127.0.0.1:3000").origin;

const checks = [
  ["lint", [process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"]],
  ["verification page route", async () => {
    const response = await fetch(`${baseUrl}/xianyu-mvp`, { cache: "no-store" });
    if (!response.ok) throw new Error(`/xianyu-mvp returned HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.length < 1000) throw new Error("/xianyu-mvp returned an unexpectedly small page");
  }],
  ["messages direct route", async () => {
    const response = await fetch(`${baseUrl}/messages?messageId=smoke_message_id`, { cache: "no-store" });
    if (!response.ok) throw new Error(`/messages?messageId=smoke_message_id returned HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.length < 1000) throw new Error("/messages direct route returned an unexpectedly small page");
  }],
  ["extension popup", [process.execPath, "scripts/smoke-test-extension-popup.mjs"]],
  ["extension content", [process.execPath, "scripts/smoke-test-extension-content.mjs"]],
  ["extension background", [process.execPath, "scripts/smoke-test-extension-background.mjs"]],
  ["plugin status", [process.execPath, "scripts/smoke-test-plugin-status.mjs"]],
  ["reply generation", [process.execPath, "scripts/smoke-test-reply-generation.mjs"]],
  ["xianyu validation", [process.execPath, "scripts/smoke-test-xianyu-validation.mjs"]],
  ["xianyu verification records", [process.execPath, "scripts/smoke-test-xianyu-verification-records.mjs"]],
  ["workbench persistence", [process.execPath, "scripts/smoke-test-workbench-closed-loop.mjs"]],
  ["xianyu loop", [process.execPath, "scripts/smoke-test-xianyu-loop.mjs"]],
  ["outbox queue", [process.execPath, "scripts/smoke-test-outbox.mjs"]],
];

function runCheck(label, command) {
  return new Promise((resolve, reject) => {
    console.log(`[xianyu-mvp-smoke] START ${label}`);
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[xianyu-mvp-smoke] PASS ${label}`);
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}`));
      }
    });
  });
}

async function cleanupOutboxSmokeFile() {
  await fs.rm(outboxFilePath, { force: true });
  await fs.rm(pluginStatusFilePath, { force: true });
}

async function main() {
  console.log("[xianyu-mvp-smoke] Running full Xianyu MVP verification");
  try {
    for (const [label, command] of checks) {
      if (typeof command === "function") {
        console.log(`[xianyu-mvp-smoke] START ${label}`);
        await command();
        console.log(`[xianyu-mvp-smoke] PASS ${label}`);
      } else {
        await runCheck(label, command);
      }
    }
    console.log("[xianyu-mvp-smoke] PASS");
  } finally {
    await cleanupOutboxSmokeFile();
  }
}

main().catch((error) => {
  console.error(`[xianyu-mvp-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
