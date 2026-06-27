import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scriptPath = path.join(process.cwd(), "integrations/browser-extension/background.js");
const source = fs.readFileSync(scriptPath, "utf8");
const baseUrl = "http://localhost:3000";
const token = "background-smoke-token";
const successCommand = {
  id: "out_success",
  messageId: "msg_success",
  orderId: "order_success",
  customerFolder: "后台烟测客户",
  customerName: "后台烟测买家",
  platform: "闲鱼",
  sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
  reply: "您好，我这边帮您确认一下。",
  mode: "fill",
  status: "pending",
};
const failedCommand = {
  id: "out_failed",
  customerFolder: "后台烟测客户",
  customerName: "后台烟测买家",
  platform: "闲鱼",
  sourceUrl: "https://example.com/not-xianyu",
  reply: "这条不应该发送。",
  mode: "fill",
  status: "pending",
};

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
  };
}

function createEvent() {
  let listener = null;
  return {
    addListener(next) {
      listener = next;
    },
    trigger(...args) {
      if (!listener) throw new Error("listener was not registered");
      return listener(...args);
    },
    hasListener() {
      return Boolean(listener);
    },
  };
}

function createSandbox() {
  const runtimeOnMessage = createEvent();
  const alarmsOnAlarm = createEvent();
  const onInstalled = createEvent();
  const onStartup = createEvent();
  const contextMenusOnClicked = createEvent();
  const commandsOnCommand = createEvent();
  const patches = [];
  const sentMessages = [];
  const storageLocalWrites = [];
  const badgeTexts = [];
  const fetches = [];
  const pluginStatusPosts = [];
  const settings = {
    baseUrl,
    token,
    platform: "闲鱼",
    businessType: "xianyu",
    autoSyncEnabled: true,
    outboundSyncEnabled: true,
    outboundMode: "fill",
  };
  const tabs = [
    {
      id: 101,
      url: successCommand.sourceUrl,
      status: "complete",
    },
  ];

  const sandbox = {
    console,
    URL,
    encodeURIComponent,
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    fetch: async (url, init = {}) => {
      fetches.push({ url: String(url), init });
      if (String(url).includes("/api/outbox") && (!init.method || init.method === "GET")) {
        return jsonResponse({ commands: [successCommand, failedCommand] });
      }
      if (String(url).endsWith("/api/outbox") && init.method === "PATCH") {
        const body = JSON.parse(String(init.body || "{}"));
        patches.push(body);
        return jsonResponse({
          ok: true,
          command: {
            ...(body.id === successCommand.id ? successCommand : failedCommand),
            status: body.status,
            error: body.error || "",
          },
        });
      }
      if (String(url).endsWith("/api/plugin-status") && init.method === "POST") {
        const body = JSON.parse(String(init.body || "{}"));
        pluginStatusPosts.push(body);
        return jsonResponse({ ok: true, status: body }, true, 201);
      }
      if (String(url).endsWith("/api/inbox") && init.method === "POST") {
        const body = JSON.parse(String(init.body || "{}"));
        return jsonResponse({
          ok: true,
          message: {
            id: "msg_auto_sync_success",
            customerName: body.customerName || "自动同步买家",
            platform: body.platform || "闲鱼",
            sourceUrl: body.sourceUrl || "",
            rawMessage: body.rawMessage || body.text || "",
          },
        }, true, 201);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    chrome: {
      storage: {
        sync: {
          async get(defaults) {
            return { ...defaults, ...settings };
          },
        },
        local: {
          async set(value) {
            storageLocalWrites.push(value);
          },
        },
      },
      tabs: {
        async query(queryInfo = {}) {
          if (queryInfo.url) return [];
          return tabs;
        },
        async create({ url }) {
          const tab = { id: 200 + tabs.length, url, status: "complete" };
          tabs.push(tab);
          return tab;
        },
        async get(tabId) {
          return tabs.find((tab) => tab.id === tabId) || null;
        },
        async sendMessage(tabId, payload) {
          sentMessages.push({ tabId, payload });
          return { ok: true };
        },
      },
      action: {
        async setBadgeText(value) {
          badgeTexts.push(value);
        },
        async setBadgeBackgroundColor() {},
        async openPopup() {},
      },
      alarms: {
        create() {},
        onAlarm: alarmsOnAlarm,
      },
      runtime: {
        onInstalled,
        onStartup,
        onMessage: runtimeOnMessage,
      },
      contextMenus: {
        removeAll(callback) {
          if (callback) callback();
        },
        create() {},
        onClicked: contextMenusOnClicked,
      },
      commands: {
        onCommand: commandsOnCommand,
      },
      notifications: {
        async create() {},
      },
      scripting: {
        async executeScript() {
          return [{ result: "" }];
        },
      },
    },
  };

  return {
    sandbox,
    patches,
    sentMessages,
    storageLocalWrites,
    badgeTexts,
    fetches,
    pluginStatusPosts,
    runtimeOnMessage,
    alarmsOnAlarm,
  };
}

async function waitForMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

const harness = createSandbox();
vm.runInNewContext(source, harness.sandbox, { filename: scriptPath });
assert.equal(harness.runtimeOnMessage.hasListener(), true, "background should register runtime message listener");
assert.equal(harness.alarmsOnAlarm.hasListener(), true, "background should register alarm listener");

let immediateResponse = null;
harness.runtimeOnMessage.trigger({ type: "AICS_POLL_OUTBOX_NOW" }, {}, (response) => {
  immediateResponse = response;
});
assert.equal(immediateResponse?.ok, true, "manual poll message should respond immediately");

await waitForMicrotasks();

const successPatches = harness.patches.filter((patch) => patch.id === successCommand.id);
assert.deepEqual(successPatches.map((patch) => patch.status), ["processing", "filled"], "success command should move processing -> filled");
assert.equal(harness.sentMessages.length, 1, "success command should be sent to one tab");
assert.equal(harness.sentMessages[0].tabId, 101, "success command should target exact sourceUrl tab");
assert.equal(harness.sentMessages[0].payload.type, "AICS_OUTBOUND_REPLY");
assert.equal(harness.sentMessages[0].payload.command.id, successCommand.id);
assert.equal(harness.sentMessages[0].payload.command.mode, "fill");

const failurePatches = harness.patches.filter((patch) => patch.id === failedCommand.id);
assert.deepEqual(failurePatches.map((patch) => patch.status), ["processing", "failed"], "unsupported command should move processing -> failed");
assert.match(failurePatches.at(-1)?.error || "", /不是受支持的闲鱼页面|原平台链接不是受支持/);

assert.ok(
  harness.storageLocalWrites.some((write) => write.outboundStatus?.ok === true && write.outboundStatus?.commandId === successCommand.id),
  "success status should be written to local storage",
);
assert.ok(
  harness.storageLocalWrites.some((write) => write.outboundStatus?.ok === false && write.outboundStatus?.commandId === failedCommand.id),
  "failure status should be written to local storage",
);
assert.ok(
  harness.fetches.some((entry) => String(entry.url).includes("/api/outbox?status=pending")),
  "background should poll pending outbox queue",
);
assert.ok(
  harness.pluginStatusPosts.some((post) => post.kind === "outbound" && post.ok === true && post.commandId === successCommand.id),
  "success outbound status should be posted to workbench",
);
assert.ok(
  harness.pluginStatusPosts.some((post) => post.kind === "outbound" && post.ok === false && post.commandId === failedCommand.id && post.error),
  "failure outbound status should be posted to workbench",
);
assert.ok(
  harness.pluginStatusPosts.some((post) => post.kind === "config" && post.ok === true && post.mode === "fill" && post.action === "自动同步已开启 / 回闲鱼已开启 / 只回填输入框"),
  "config ready status should be posted to workbench during polling",
);

let autoSyncResponse = null;
harness.runtimeOnMessage.trigger(
  {
    type: "AICS_AUTO_INBOX_MESSAGE",
    payload: {
      customerName: "自动同步买家",
      rawMessage: "这个还在吗？",
      platform: "闲鱼",
      businessType: "xianyu",
      sourceUrl: "https://www.goofish.com/im/chat?peer=auto-sync",
    },
  },
  { tab: { url: "https://www.goofish.com/im/chat?peer=auto-sync" } },
  (response) => {
    autoSyncResponse = response;
  },
);
await waitForMicrotasks();

assert.equal(autoSyncResponse?.ok, true, "auto sync message should succeed");
assert.ok(
  harness.pluginStatusPosts.some((post) => post.kind === "autoSync" && post.ok === true && post.action === "自动监听" && post.messageId === "msg_auto_sync_success"),
  "auto sync success status should be posted to workbench",
);
assert.ok(
  harness.storageLocalWrites.some((write) => write.autoSyncStatus?.ok === true && write.autoSyncStatus?.action === "自动监听" && write.autoSyncStatus?.messageId === "msg_auto_sync_success"),
  "auto sync status should be written to local storage",
);

console.log("[extension-background-smoke] poll queue ok");
console.log("[extension-background-smoke] success dispatch ok");
console.log("[extension-background-smoke] failure status ok");
console.log("[extension-background-smoke] workbench status post ok");
console.log("[extension-background-smoke] auto sync status post ok");
console.log("[extension-background-smoke] config status post ok");
console.log("[extension-background-smoke] PASS");
