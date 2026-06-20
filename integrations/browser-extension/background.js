const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost:3000",
  token: "",
  platform: "闲鱼",
  businessType: "xianyu",
  customerName: "",
  customerFolder: "",
  actionMode: "analyze",
};

const CONTEXT_MENU_ID = "send-to-ai-service";

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

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings, baseUrl: normalizeBaseUrl(settings.baseUrl || DEFAULT_SETTINGS.baseUrl) };
}

function requireMessage(text) {
  const rawMessage = String(text || "").trim();
  if (!rawMessage) throw new Error("请先选中客户消息");
  return rawMessage;
}

async function notify(message, isError = false) {
  try {
    await chrome.notifications.create({
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
  return {
    customerName: settings.customerName || "",
    customerFolder: settings.customerFolder || settings.customerName || "",
    platform: settings.platform,
    sourceChannel: "浏览器插件",
    businessType: settings.businessType,
    text: rawMessage,
    rawMessage,
    sourceUrl,
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

chrome.runtime.onInstalled.addListener(installContextMenu);
chrome.runtime.onStartup.addListener(installContextMenu);

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
