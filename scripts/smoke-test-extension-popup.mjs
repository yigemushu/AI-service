import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scriptPath = path.join(process.cwd(), "integrations/browser-extension/popup.js");
const source = fs.readFileSync(scriptPath, "utf8");
const elements = new Map();
const listeners = new Map();
const storageSyncWrites = [];
const pluginStatusPosts = [];
const createdTabs = [];

function connectionCode(payload) {
  const raw = JSON.stringify(payload);
  const encoded = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `aics_${encoded}`;
}

function fakeElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      value: "",
      checked: false,
      disabled: false,
      textContent: "",
      innerHTML: "",
      style: {},
      classList: {
        add() {},
        remove() {},
      },
      addEventListener(type, callback) {
        listeners.set(`${id}:${type}`, callback);
      },
      appendChild() {},
    });
  }
  return elements.get(id);
}

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
  };
}

const sandbox = {
  console,
  URL,
  TextDecoder,
  Uint8Array,
  Date,
  setTimeout(callback) {
    queueMicrotask(callback);
    return 1;
  },
  atob(value) {
    return Buffer.from(value, "base64").toString("binary");
  },
  fetch: async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith("/api/health")) return jsonResponse({ ok: true });
    if (value.endsWith("/api/inbox/test")) return jsonResponse({ ok: true });
    if (value.endsWith("/api/plugin-status")) {
      pluginStatusPosts.push(JSON.parse(String(init.body || "{}")));
      return jsonResponse({ ok: true, status: pluginStatusPosts.at(-1) }, true, 201);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  },
  document: {
    getElementById: fakeElement,
    createElement: fakeElement,
    body: { appendChild() {} },
  },
  navigator: {
    clipboard: {
      async writeText() {},
    },
  },
  chrome: {
    storage: {
      sync: {
        async get(defaults) {
          return { ...defaults };
        },
        async set(value) {
          storageSyncWrites.push(value);
        },
      },
      local: {
        async get(defaults) {
          return { ...defaults };
        },
        async set() {},
      },
      onChanged: {
        addListener() {},
      },
    },
    runtime: {
      sendMessage() {
        return Promise.resolve({ ok: true });
      },
    },
    tabs: {
      async query() {
        return [];
      },
      async create(tab) {
        createdTabs.push(tab);
        return { id: 1, ...tab };
      },
    },
    scripting: {
      async executeScript() {
        return [];
      },
    },
  },
};

vm.runInNewContext(source, sandbox, { filename: scriptPath });

for (let index = 0; index < 8; index += 1) {
  await Promise.resolve();
}

fakeElement("connectionCode").value = connectionCode({
  siteOrigin: "http://127.0.0.1:3000",
  webhookToken: "popup-smoke-token",
  platform: "闲鱼",
  businessType: "闲鱼卖货",
});

const importHandler = listeners.get("importConnectionCode:click");
assert.equal(typeof importHandler, "function", "import connection code button should register a click handler");
await importHandler();
await Promise.resolve();

const savedSettings = storageSyncWrites.at(-1);
assert.equal(savedSettings?.baseUrl, "http://127.0.0.1:3000", "connection code should save normalized baseUrl");
assert.equal(savedSettings?.token, "popup-smoke-token", "connection code should save token");
assert.equal(savedSettings?.platform, "闲鱼", "connection code should save platform");
assert.equal(savedSettings?.businessType, "xianyu", "connection code should normalize business type");
assert.equal(savedSettings?.autoSyncEnabled, true, "connection code import should enable auto sync for MVP testing");
assert.equal(savedSettings?.outboundSyncEnabled, true, "connection code import should enable outbound sync for MVP testing");
assert.equal(savedSettings?.outboundMode, "fill", "connection code import should keep the safer fill-only mode by default");
assert.match(
  fakeElement("status").textContent,
  /自动同步和回闲鱼已开启.*闲鱼闭环验证/,
  "connection code import should tell merchant the plugin is ready for Xianyu MVP verification",
);
assert.ok(
  pluginStatusPosts.some((post) => post.kind === "config" && post.ok === true && post.mode === "fill" && post.action === "自动同步已开启 / 回闲鱼已开启 / 只回填输入框"),
  `connection code import should post ready config status to workbench: ${JSON.stringify(pluginStatusPosts)}`,
);

const openMvpHandler = listeners.get("openXianyuMvp:click");
assert.equal(typeof openMvpHandler, "function", "Xianyu MVP button should register a click handler");
await openMvpHandler();
assert.ok(
  createdTabs.some((tab) => tab.url === "http://127.0.0.1:3000/xianyu-mvp"),
  `Xianyu MVP button should open validation page: ${JSON.stringify(createdTabs)}`,
);

console.log("[extension-popup-smoke] connection code import enables MVP switches ok");
console.log("[extension-popup-smoke] validation page shortcut ok");
console.log("[extension-popup-smoke] PASS");
