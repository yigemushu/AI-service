const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost:3000",
  token: "",
  shopAlias: "default-shop",
  platform: "闲鱼",
  businessType: "xianyu",
  customerName: "",
  customerFolder: "",
  actionMode: "analyze",
  autoSyncEnabled: false,
  debugMode: false,
  outboundSyncEnabled: true,
  outboundMode: "fill",
};

const CONTEXT_MENU_ID = "send-to-ai-service";
const OUTBOX_ALARM_NAME = "aics-poll-outbox";
const HEARTBEAT_ALARM_NAME = "aics-plugin-heartbeat";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("网站地址不能为空");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("网站地址格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("网站地址格式不正确");
  return url.origin;
}

function buildUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function safeError(error, fallback) {
  if (error instanceof TypeError) return "网站不可访问，请检查网站地址";
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusError(status, data, fallback) {
  const message = typeof data?.error === "string" ? data.error : "";
  if (status === 401) return "Token 错误，请检查 Webhook Token";
  if (status === 503) return "服务端未配置 Token，请检查网站环境变量";
  return message || `${fallback}：HTTP ${status}`;
}

function classifyAutoSyncError(message) {
  const text = String(message || "");
  if (/Token|401/i.test(text)) return "Token 错误";
  if (/503|未配置 Token/i.test(text)) return "服务端未配置 Token";
  if (/inbox|HTTP|发送失败/i.test(text)) return "/api/inbox 失败";
  if (/网站不可访问|Failed to fetch|network/i.test(text)) return "网站不可访问";
  return text || "自动同步失败";
}

async function getSettings() {
  const [syncedSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get(DEFAULT_SETTINGS),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...syncedSettings, ...localSettings };
  return { ...DEFAULT_SETTINGS, ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl || DEFAULT_SETTINGS.baseUrl) };
}

function requireMessage(text) {
  const rawMessage = String(text || "").trim();
  if (!rawMessage) throw new Error("请先选中客户消息");
  return rawMessage;
}

async function notify(message, isError = false) {
  try {
    await chrome.notifications.create(`aics-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.svg",
      title: isError ? "AI 客服助手处理失败" : "AI 客服助手",
      message,
    });
  } catch {
    await chrome.action.setBadgeText({ text: isError ? "!" : "OK" });
    await chrome.action.setBadgeBackgroundColor({ color: isError ? "#be123c" : "#047857" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
  }
}

async function captureSelectionFromTab(tabId) {
  if (!tabId) return "";
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection()?.toString() || "",
  });
  return result?.result || "";
}

function buildInboxPayload(settings, rawMessage, sourceUrl = "") {
  const now = new Date().toISOString();
  const customerName = settings.customerName || "";
  const customerFolder = settings.customerFolder || settings.customerName || "";
  const externalMessageId = [settings.platform, settings.shopAlias || "default-shop", customerFolder || customerName || "unknown-customer", rawMessage, sourceUrl].join("|");
  return {
    customerName,
    customerFolder,
    platform: settings.platform,
    shopAlias: settings.shopAlias || "default-shop",
    sourceChannel: "浏览器插件",
    businessType: settings.businessType,
    text: rawMessage,
    rawMessage,
    messageText: rawMessage,
    messageTime: now,
    sourceUrl,
    direction: "inbound",
    externalConversationId: "",
    platformThreadId: sourceUrl,
    externalMessageId,
  };
}

chrome.notifications?.onClicked?.addListener(async (notificationId) => {
  if (!String(notificationId || "").startsWith("aics-")) return;
  try {
    const settings = await getSettings();
    await chrome.tabs.create({ url: `${settings.baseUrl}/messages` });
  } catch {}
});

function buildAutoInboxPayload(settings, payload) {
  const customerName = String(payload?.customerName || settings.customerName || "").trim();
  const rawMessage = String(payload?.rawMessage || payload?.text || "").trim();
  return {
    customerName,
    customerFolder: String(payload?.customerFolder || settings.customerFolder || customerName || "").trim(),
    platform: String(payload?.platform || settings.platform || "闲鱼").trim(),
    shopAlias: String(payload?.shopAlias || settings.shopAlias || "default-shop").trim(),
    sourceChannel: "浏览器插件",
    businessType: String(payload?.businessType || settings.businessType || "xianyu").trim(),
    text: rawMessage,
    rawMessage,
    messageText: rawMessage,
    messageTime: String(payload?.messageTime || new Date().toISOString()).trim(),
    sourceUrl: String(payload?.sourceUrl || "").trim(),
    direction: "inbound",
    itemTitle: String(payload?.itemTitle || "").trim(),
    externalConversationId: String(payload?.externalConversationId || "").trim(),
    platformThreadId: String(payload?.platformThreadId || payload?.sourceUrl || "").trim(),
    externalMessageId: String(payload?.externalMessageId || "").trim(),
  };
}

async function postInbox(settings, rawMessage, sourceUrl) {
  if (!settings.token) throw new Error("请先填写 Webhook Token");
  const response = await fetch(buildUrl(settings.baseUrl, "/api/inbox"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(buildInboxPayload(settings, rawMessage, sourceUrl)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "发送失败"));
  return data;
}

async function postAutoInbox(settings, payload) {
  if (!settings.autoSyncEnabled) throw new Error("自动同步未开启");
  if (!settings.token) throw new Error("请先填写 Webhook Token");
  const body = buildAutoInboxPayload(settings, payload);
  requireMessage(body.rawMessage);
  const requestUrl = buildUrl(settings.baseUrl, "/api/inbox");
  const existingStatus = await chrome.storage.local.get({ syncLinkStatus: {} });
  const previousSyncLinkStatus = existingStatus.syncLinkStatus || {};
  await chrome.storage.local.set({
    syncLinkStatus: {
      ...previousSyncLinkStatus,
      isXianyuPage: true,
      autoSyncEnabled: Boolean(settings.autoSyncEnabled),
      observerRunning: true,
      candidateCount: 1,
      filteredCount: 0,
      lastCapturedSummary: String(body.rawMessage || "").slice(0, 100),
      lastInboxAt: new Date().toISOString(),
      requestUrl,
      tokenPresent: Boolean(settings.token),
    },
  });
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  await chrome.storage.local.set({
    syncLinkStatus: {
      ...previousSyncLinkStatus,
      isXianyuPage: true,
      autoSyncEnabled: Boolean(settings.autoSyncEnabled),
      observerRunning: true,
      candidateCount: 1,
      filteredCount: 0,
      lastCapturedSummary: String(body.rawMessage || "").slice(0, 100),
      lastInboxAt: new Date().toISOString(),
      lastInboxStatus: response.status,
      requestUrl,
      tokenPresent: Boolean(settings.token),
      inboxOk: response.ok,
      conversationId: data.conversationId || "",
      duplicated: Boolean(data.duplicated),
      lastError: response.ok ? "" : data.error || `HTTP ${response.status}`,
    },
  });
  if (!response.ok) throw new Error(statusError(response.status, data, "自动同步失败"));
  data._httpStatus = response.status;
  return data;
}

async function updateOutboxStatus(settings, id, status, error = "") {
  if (!id || !settings.token) return;
  await fetch(buildUrl(settings.baseUrl, "/api/outbox"), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify({ id, status, error }),
  }).catch(() => undefined);
}

async function postPluginStatus(settings, payload) {
  if (!settings.token) return;
  await fetch(buildUrl(settings.baseUrl, "/api/plugin-status"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify({
      platform: "闲鱼",
      ...payload,
    }),
  }).catch(() => undefined);
}

async function postHeartbeat(settings, payload = {}) {
  if (!settings.token) return;
  const lastPayload = payload.lastPayload || {};
  const summary = String(
    payload.lastCapturedSummary
    || lastPayload.messageText
    || lastPayload.rawMessage
    || lastPayload.text
    || "",
  ).slice(0, 120);
  await fetch(buildUrl(settings.baseUrl, "/api/plugin/heartbeat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify({
      siteOrigin: settings.baseUrl,
      platform: settings.platform || "闲鱼",
      shopAlias: settings.shopAlias || "default-shop",
      pageStatus: payload.pageStatus || "not-detected",
      autoSyncEnabled: Boolean(settings.autoSyncEnabled),
      lastSyncAt: payload.lastSyncAt || "",
      lastCapturedSummary: summary,
      extensionVersion: chrome.runtime.getManifest?.().version || "",
    }),
  }).catch(() => undefined);
}

function buildConfigStatusPayload(settings) {
  const autoSyncEnabled = Boolean(settings.autoSyncEnabled);
  const outboundSyncEnabled = settings.outboundSyncEnabled !== false;
  const mode = settings.outboundMode === "send" ? "send" : "fill";
  return {
    kind: "config",
    ok: autoSyncEnabled && outboundSyncEnabled,
    mode,
    action: [
      autoSyncEnabled ? "自动同步已开启" : "自动同步未开启",
      outboundSyncEnabled ? "回闲鱼已开启" : "回闲鱼未开启",
      mode === "send" ? "代点击发送" : "只回填输入框",
    ].join(" / "),
    error: autoSyncEnabled && outboundSyncEnabled ? "" : "实机闭环前请开启自动同步和回闲鱼",
  };
}

async function postConfigStatus(settings) {
  await postPluginStatus(settings, buildConfigStatusPayload(settings));
  await postHeartbeat(settings);
}

function isXianyuUrl(url) {
  return /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(String(url || ""));
}

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || "").split("#")[0];
  }
}

async function findOrOpenPlatformTab(command) {
  const sourceUrl = String(command?.sourceUrl || "").trim();
  if (!sourceUrl) throw new Error("?????????????????");
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) throw new Error("?????????????????");
  if (!isXianyuUrl(active.url || "")) throw new Error("???????????");
  const sourceKey = normalizeComparableUrl(sourceUrl);
  const activeKey = normalizeComparableUrl(active.url || "");
  if (sourceKey && activeKey !== sourceKey) throw new Error("????????????????");
  return active;
}
async function waitForTabReady(tabId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function sendOutboundMessageToTab(tabId, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  throw lastError || new Error("闲鱼页面没有响应插件指令");
}

async function executeOutboundCommand(settings, command) {
  const mode = "fill";
  await updateOutboxStatus(settings, command.id, "processing");
  const tab = await findOrOpenPlatformTab(command);
  if (!tab?.id) throw new Error("没有找到可用的闲鱼聊天页");
  await waitForTabReady(tab.id);
  const response = await sendOutboundMessageToTab(tab.id, {
    type: "AICS_OUTBOUND_REPLY",
    command: { ...command, mode },
  });
  if (!response?.ok) throw new Error(response?.error || "闲鱼页面没有完成回填");
  await updateOutboxStatus(settings, command.id, "filled");
  await postPluginStatus(settings, {
    kind: "outbound",
    ok: true,
    commandId: command.id,
    sourceUrl: command.sourceUrl || "",
    mode,
    action: mode === "send" ? "已点击发送" : "已填入输入框",
  });
  await chrome.storage.local.set({
    outboundStatus: {
      ok: true,
      commandId: command.id,
      mode,
      updatedAt: Date.now(),
    },
  });
  await chrome.action.setBadgeText({ text: "FILL" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0369a1" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

let pollingOutbox = false;

async function pollOutbox() {
  if (pollingOutbox) return;
  pollingOutbox = true;
  try {
    const settings = await getSettings();
    await postConfigStatus(settings);
    if (!settings.outboundSyncEnabled || !settings.token) return;
    const response = await fetch(`${buildUrl(settings.baseUrl, "/api/outbox")}?status=pending&platform=${encodeURIComponent("\u95f2\u9c7c")}`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const commands = Array.isArray(data.commands) ? data.commands.slice(0, 5) : [];
    const latest = commands[0] || null;
    await chrome.storage.local.set({
      pendingOutboxCommands: commands,
      outboundStatus: latest
        ? {
            ok: true,
            commandId: latest.id || "",
            customerName: latest.customerName || "",
            sourceUrl: latest.sourceUrl || "",
            action: "Pending reply found. Open the target chat and click fill.",
            updatedAt: Date.now(),
          }
        : { ok: true, action: "No pending replies", updatedAt: Date.now() },
    });
    if (latest) {
      await postPluginStatus(settings, {
        kind: "outbound",
        ok: true,
        commandId: latest.id || "",
        sourceUrl: latest.sourceUrl || "",
        mode: "fill",
        action: "Pending reply found, waiting for manual fill",
      });
      await chrome.action.setBadgeText({ text: "WAIT" });
      await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    }
  } finally {
    pollingOutbox = false;
  }
}
async function syncOpenSiteStorage(settings, kind, record) {
  if (!record || !record.id) return;
  const tabs = await chrome.tabs.query({ url: `${settings.baseUrl}/*` }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [kind, record],
      func: (recordKind, nextRecord) => {
        const key = recordKind === "order" ? "ai-service.orders" : "ai-service.customer-messages";
        const eventName = recordKind === "order" ? "orders-updated" : "customer-messages-updated";
        function readList() {
          try {
            const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        const existing = readList();
        const withoutDuplicate = existing.filter((item) => item && item.id !== nextRecord.id);
        window.localStorage.setItem(key, JSON.stringify([nextRecord, ...withoutDuplicate].slice(0, 1000)));
        window.dispatchEvent(new Event(eventName));
      },
    }).catch(() => undefined);
  }));
}

async function postAnalyze(settings, rawMessage) {
  const response = await fetch(buildUrl(settings.baseUrl, "/api/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatText: rawMessage,
      businessType: settings.businessType,
      platform: settings.platform,
      sellerRules: "",
      systemPrompt: "",
      source: "browser-extension",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "AI 分析失败"));
  return data;
}

async function openPopup() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Some Chrome versions only allow openPopup from specific user gestures.
  }
}

async function handleMessage(text, tab) {
  const settings = await getSettings();
  const rawMessage = requireMessage(text);
  const sourceUrl = tab?.url || "";
  const baseResult = {
    rawMessage,
    sourceUrl,
    customerName: settings.customerName || "",
    mode: settings.actionMode,
    updatedAt: Date.now(),
  };

  if (settings.actionMode === "inbox") {
    const inbox = await postInbox(settings, rawMessage, sourceUrl);
    await syncOpenSiteStorage(settings, "message", inbox.message);
    await chrome.storage.local.set({ lastResult: { ...baseResult, inbox } });
      await notify("已发送到消息中心");
    return;
  }

  const analysis = await postAnalyze(settings, rawMessage);
  await chrome.storage.local.set({ lastResult: { ...baseResult, analysis } });
  await notify("回复草稿已生成，打开插件即可复制");
  await openPopup();
}

function installContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "发送到 AI 客服助手",
      contexts: ["selection"],
    });
  });
}

function installOutboxPolling() {
  chrome.alarms.create(OUTBOX_ALARM_NAME, { periodInMinutes: 0.5 });
  chrome.alarms.create(HEARTBEAT_ALARM_NAME, { periodInMinutes: 0.5 });
  pollOutbox().catch(() => undefined);
  getSettings().then((settings) => postHeartbeat(settings)).catch(() => undefined);
}

setInterval(() => {
  getSettings()
    .then((settings) => {
      if (settings.autoSyncEnabled) return postHeartbeat(settings);
      return undefined;
    })
    .catch(() => undefined);
}, 20_000);

chrome.runtime.onInstalled.addListener(() => {
  installContextMenu();
  installOutboxPolling();
});
chrome.runtime.onStartup.addListener(() => {
  installContextMenu();
  installOutboxPolling();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OUTBOX_ALARM_NAME) pollOutbox().catch(() => undefined);
  if (alarm.name === HEARTBEAT_ALARM_NAME) getSettings().then((settings) => postHeartbeat(settings)).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  handleMessage(info.selectionText || "", tab).catch(async (error) => {
    const message = safeError(error, "发送失败");
    await chrome.storage.local.set({ lastResult: { error: message, updatedAt: Date.now() } });
    await notify(message, true);
  });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "send-selected-message") return;
  try {
    const rawMessage = await captureSelectionFromTab(tab?.id);
    await handleMessage(rawMessage, tab);
  } catch (error) {
    const message = safeError(error, "发送失败");
    await chrome.storage.local.set({ lastResult: { error: message, updatedAt: Date.now() } });
    await notify(message, true);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AICS_POLL_OUTBOX_NOW") {
    pollOutbox().catch(() => undefined);
    getSettings().then((settings) => postHeartbeat(settings)).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "AICS_FILL_PENDING_OUTBOX") {
    (async () => {
      try {
        const settings = await getSettings();
        const stored = await chrome.storage.local.get({ pendingOutboxCommands: [] });
        const commands = Array.isArray(stored.pendingOutboxCommands) ? stored.pendingOutboxCommands : [];
        const command = commands[0];
        if (!command) throw new Error("暂无待填入回复");
        await executeOutboundCommand(settings, command);
        await pollOutbox();
        sendResponse({ ok: true, commandId: command.id || "" });
      } catch (error) {
        const messageText = safeError(error, "填入闲鱼输入框失败");
        await chrome.storage.local.set({ outboundStatus: { ok: false, error: messageText, updatedAt: Date.now() } });
        sendResponse({ ok: false, error: messageText });
      }
    })();
    return true;
  }
  if (message?.type === "AICS_PAGE_STATUS") {
    getSettings()
      .then((settings) => postHeartbeat(settings, {
        pageStatus: message.isXianyuPage ? "xianyu-detected" : "not-detected",
        lastPayload: message.latestPayload || null,
        lastCapturedSummary: message.latestPayload?.messageText || message.latestPayload?.rawMessage || "",
      }))
      .catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== "AICS_AUTO_INBOX_MESSAGE") return false;
  (async () => {
    try {
      const settings = await getSettings();
      await postConfigStatus(settings);
      const result = await postAutoInbox(settings, message.payload || {});
      await syncOpenSiteStorage(settings, "message", result.message);
      await postPluginStatus(settings, {
        kind: "autoSync",
        ok: true,
        messageId: result.message?.id || "",
        sourceUrl: sender?.tab?.url || message.payload?.sourceUrl || "",
        action: "自动监听",
      });
      await postHeartbeat(settings, {
        pageStatus: "xianyu-detected",
        lastSyncAt: new Date().toISOString(),
        lastPayload: message.payload || null,
      });
      if (!result.duplicated) {
        await notify(`收到闲鱼新咨询：${result.message?.customerName || message.payload?.customerName || "买家"} - ${String(message.payload?.rawMessage || message.payload?.messageText || "").slice(0, 36)}`);
      }
      await chrome.storage.local.set({
        lastCapturedInboxPayload: message.payload || null,
        autoSyncStatus: {
          ok: true,
          messageId: result.message?.id || "",
          conversationId: result.conversationId || "",
          duplicated: Boolean(result.duplicated),
          httpStatus: result._httpStatus || "",
          sourceUrl: sender?.tab?.url || message.payload?.sourceUrl || "",
          action: "自动监听",
          updatedAt: Date.now(),
        },
      });
      await chrome.action.setBadgeText({ text: "NEW" });
      await chrome.action.setBadgeBackgroundColor({ color: "#047857" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
      sendResponse({ ok: true, message: result.message });
    } catch (error) {
      const errorMessage = safeError(error, "自动同步失败");
      const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
      const reason = classifyAutoSyncError(errorMessage);
      await postPluginStatus(settings, {
        kind: "autoSync",
        ok: false,
        sourceUrl: sender?.tab?.url || message.payload?.sourceUrl || "",
        action: "自动监听",
        error: errorMessage,
      });
      await chrome.storage.local.set({
        lastCapturedInboxPayload: message.payload || null,
        autoSyncStatus: { ok: false, action: "自动监听", error: reason || errorMessage, updatedAt: Date.now() },
        syncLinkStatus: {
          isXianyuPage: true,
          autoSyncEnabled: true,
          observerRunning: true,
          lastCapturedSummary: String(message.payload?.rawMessage || message.payload?.messageText || "").slice(0, 100),
          lastInboxAt: new Date().toISOString(),
          tokenPresent: Boolean(settings.token),
          inboxOk: false,
          lastError: reason || errorMessage,
        },
      });
      sendResponse({ ok: false, error: errorMessage });
    }
  })();
  return true;
});
