const DEFAULT_SETTINGS = {
  baseUrl: "http://localhost:3000",
  token: "",
  myNickname: "",
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

const fields = {
  connectionCode: document.getElementById("connectionCode"),
  dailyConnection: document.getElementById("dailyConnection"),
  dailyPage: document.getElementById("dailyPage"),
  dailyAutoSyncEnabled: document.getElementById("dailyAutoSyncEnabled"),
  dailyRecent: document.getElementById("dailyRecent"),
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  myNickname: document.getElementById("myNickname"),
  shopAlias: document.getElementById("shopAlias"),
  platform: document.getElementById("platform"),
  businessType: document.getElementById("businessType"),
  customerName: document.getElementById("customerName"),
  customerFolder: document.getElementById("customerFolder"),
  actionMode: document.getElementById("actionMode"),
  autoSyncEnabled: document.getElementById("autoSyncEnabled"),
  debugMode: document.getElementById("debugMode"),
  outboundSyncEnabled: document.getElementById("outboundSyncEnabled"),
  outboundMode: document.getElementById("outboundMode"),
  rawMessage: document.getElementById("rawMessage"),
  status: document.getElementById("status"),
  resultPanel: document.getElementById("resultPanel"),
  summary: document.getElementById("summary"),
  missingInfo: document.getElementById("missingInfo"),
  riskFlags: document.getElementById("riskFlags"),
  reply: document.getElementById("reply"),
  diagnosticsPanel: document.getElementById("diagnosticsPanel"),
  copyDiagnostics: document.getElementById("copyDiagnostics"),
  pageStatusPanel: document.getElementById("pageStatusPanel"),
  latestFieldsPanel: document.getElementById("latestFieldsPanel"),
  autoSyncStatusPanel: document.getElementById("autoSyncStatusPanel"),
  outboundStatusPanel: document.getElementById("outboundStatusPanel"),
  syncLinkStatusPanel: document.getElementById("syncLinkStatusPanel"),
};

let latestContext = { rawMessage: "", sourceUrl: "", analysis: null };
let latestDiagnostics = null;

function setStatus(text, isError = false) {
  fields.status.textContent = text;
  fields.status.style.color = isError ? "#be123c" : "#047857";
}

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

function getTrimmedValue(name) {
  return String(fields[name]?.value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function humanError(error, fallback = "操作失败，请重试") {
  if (error instanceof TypeError) return "网络失败或网站不可访问，请检查网站地址";
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusError(status, data, fallback) {
  const message = typeof data?.error === "string" ? data.error : "";
  if (status === 401) return "网站可访问，但 Token 错误，请检查 Webhook Token";
  if (status === 503) return "网站可访问，但服务端未配置 Token";
  return message || `${fallback}：HTTP ${status}`;
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeBusinessTypeValue(value) {
  const text = String(value || "").trim();
  const map = {
    xianyu: "xianyu",
    virtual: "virtual",
    sam: "sam",
    local: "local",
    trade: "trade",
    闲鱼卖货: "xianyu",
    虚拟服务: "virtual",
    山姆代下单: "sam",
    本地服务: "local",
    外贸询盘: "trade",
  };
  return map[text] || "";
}

function validateBaseConfig() {
  const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
  const platform = getTrimmedValue("platform");
  const businessType = getTrimmedValue("businessType");
  if (!platform) throw new Error("请选择平台");
  if (!businessType) throw new Error("请选择业务类型");
  return { baseUrl, platform, businessType };
}

function validateInboxConfig() {
  const config = validateBaseConfig();
  const token = getTrimmedValue("token");
  if (!token) throw new Error("请先填写 Webhook Token");
  return { ...config, token };
}

function validateMessage(rawMessage) {
  const text = String(rawMessage || "").trim();
  if (!text) throw new Error("请先选中客户消息，或手动输入客户消息");
  return text;
}

function buildConfigStatusPayload(autoSyncEnabled, outboundSyncEnabled, outboundMode) {
  const mode = outboundMode === "send" ? "send" : "fill";
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

async function loadSettings() {
  const [syncedSaved, localSaved] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get(DEFAULT_SETTINGS),
  ]);
  const saved = { ...DEFAULT_SETTINGS, ...syncedSaved, ...localSaved };
  fields.baseUrl.value = saved.baseUrl || DEFAULT_SETTINGS.baseUrl;
  fields.token.value = saved.token || "";
  fields.myNickname.value = saved.myNickname || "";
  fields.shopAlias.value = saved.shopAlias || DEFAULT_SETTINGS.shopAlias;
  fields.platform.value = saved.platform || DEFAULT_SETTINGS.platform;
  fields.businessType.value = saved.businessType || DEFAULT_SETTINGS.businessType;
  fields.customerName.value = saved.customerName || "";
  fields.customerFolder.value = saved.customerFolder || "";
  fields.actionMode.value = saved.actionMode || DEFAULT_SETTINGS.actionMode;
  fields.autoSyncEnabled.checked = Boolean(saved.autoSyncEnabled);
  if (fields.dailyAutoSyncEnabled) fields.dailyAutoSyncEnabled.checked = Boolean(saved.autoSyncEnabled);
  fields.debugMode.checked = Boolean(saved.debugMode);
  fields.outboundSyncEnabled.checked = saved.outboundSyncEnabled !== false;
  fields.outboundMode.value = saved.outboundMode || DEFAULT_SETTINGS.outboundMode;
  renderDailyConnection(saved);
}

async function saveSettings() {
  const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
  const token = getTrimmedValue("token");
  const autoSyncEnabled = fields.autoSyncEnabled.checked;
  const outboundSyncEnabled = fields.outboundSyncEnabled.checked;
  const outboundMode = fields.outboundMode.value;
  const nextSettings = {
    baseUrl,
    token,
    myNickname: getTrimmedValue("myNickname"),
    shopAlias: getTrimmedValue("shopAlias") || DEFAULT_SETTINGS.shopAlias,
    platform: fields.platform.value,
    businessType: fields.businessType.value,
    customerName: getTrimmedValue("customerName"),
    customerFolder: getTrimmedValue("customerFolder"),
    actionMode: fields.actionMode.value,
    autoSyncEnabled,
    debugMode: fields.debugMode.checked,
    outboundSyncEnabled,
    outboundMode,
  };
  await Promise.all([
    chrome.storage.local.set(nextSettings),
    chrome.storage.sync.set(nextSettings),
  ]);
  chrome.runtime.sendMessage({ type: "AICS_POLL_OUTBOX_NOW" }).catch(() => undefined);
  fields.baseUrl.value = baseUrl;
  if (token) {
    await postPluginStatusFromPopup(buildConfigStatusPayload(autoSyncEnabled, outboundSyncEnabled, outboundMode));
  }
  renderDailyConnection({ baseUrl, token });
}

function parseConnectionCode(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code.startsWith("aics_")) throw new Error("连接码格式不正确");
  const json = decodeBase64Url(code.slice(5));
  const config = JSON.parse(json);
  if (!config || typeof config !== "object") throw new Error("连接码内容无效");
  if (!config.siteOrigin) throw new Error("连接码缺少网站地址");
  if (!config.webhookToken) throw new Error("连接码缺少 Webhook Token");
  const businessType = normalizeBusinessTypeValue(config.businessType);
  if (!businessType) throw new Error("连接码里的业务类型不支持");
  return {
    baseUrl: normalizeBaseUrl(config.siteOrigin),
    token: String(config.webhookToken || "").trim(),
    platform: String(config.platform || "闲鱼").trim() || "闲鱼",
    businessType,
    shopAlias: String(config.shopAlias || "default-shop").trim() || "default-shop",
  };
}

async function applyConnectionCode(rawCode) {
  const config = parseConnectionCode(rawCode);
  fields.baseUrl.value = config.baseUrl;
  fields.token.value = config.token;
  fields.platform.value = config.platform;
  fields.businessType.value = config.businessType;
  fields.shopAlias.value = config.shopAlias;
  fields.autoSyncEnabled.checked = true;
  fields.outboundSyncEnabled.checked = true;
  fields.outboundMode.value = fields.outboundMode.value || DEFAULT_SETTINGS.outboundMode;
  await saveSettings();
  return config;
}

async function testConnectionWith(baseUrl, token) {
  let healthResponse;
  try {
    healthResponse = await fetch(buildUrl(baseUrl, "/api/health"), { method: "GET" });
  } catch {
    throw new Error("网站不可访问，请检查网站地址");
  }
  if (!healthResponse.ok) throw new Error(`网站不可访问：HTTP ${healthResponse.status}`);

  const response = await fetch(buildUrl(baseUrl, "/api/inbox/test"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    },
    body: JSON.stringify({ webhookToken: token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "测试连接失败"));
  return data;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureSelection() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("没有找到当前网页");
  const excludedName = fields.myNickname.value.trim();
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [excludedName],
    func: (myNickname) => {
      function normalizeName(value) {
        return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
      }
      function cleanName(value) {
        const text = String(value || "")
          .replace(/\s+/g, " ")
          .replace(/^\s*(和|与|跟)\s*/, "")
          .replace(/\s*[-_|｜].*$/, "")
          .replace(/的?\s*聊天.*$/, "")
          .trim();
        if (!text || text.length < 2 || text.length > 16) return "";
        if (/https?:|www\.|localhost|搜索|消息|聊天|闲鱼|咸鱼|goofish|淘宝|首页|登录|客服接单|AI客服|订单|店铺|商品|发布|通知/.test(text)) return "";
        if (/^[0-9:：\-. ]+$/.test(text)) return "";
        if (normalizeName(text) === normalizeName(myNickname)) return "";
        if (myNickname && normalizeName(text).includes(normalizeName(myNickname))) return "";
        return text;
      }
      function textFromElement(element) {
        if (!element) return "";
        const ownText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        return ownText || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      }
      function pushCandidate(list, value) {
        const cleaned = cleanName(value);
        if (cleaned && !list.includes(cleaned)) list.push(cleaned);
      }
      function inferCustomerName() {
        const candidates = [];
        const selection = window.getSelection();
        const anchorElement = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement;
        let current = anchorElement;
        for (let depth = 0; current && depth < 7; depth += 1) {
          pushCandidate(candidates, current.getAttribute("data-nick"));
          pushCandidate(candidates, current.getAttribute("data-name"));
          pushCandidate(candidates, current.getAttribute("data-username"));
          pushCandidate(candidates, current.getAttribute("aria-label"));
          pushCandidate(candidates, current.getAttribute("title"));
          pushCandidate(candidates, textFromElement(current.previousElementSibling));
          current.querySelectorAll?.("img[alt], [title], [aria-label]").forEach((item) => {
            pushCandidate(candidates, item.getAttribute("alt"));
            pushCandidate(candidates, item.getAttribute("title"));
            pushCandidate(candidates, item.getAttribute("aria-label"));
          });
          current = current.parentElement;
        }
        (document.title || "").split(/[-_|｜]/).forEach((part) => pushCandidate(candidates, part));
        return candidates[0] || "";
      }
      return {
        selectedText: window.getSelection()?.toString() || "",
        title: document.title || "",
        url: location.href || "",
        customerName: inferCustomerName(),
      };
    },
  });
  return result?.result || { selectedText: "", title: "", url: "", customerName: "" };
}

function renderDiagnostics(data) {
  latestDiagnostics = data || null;
  fields.copyDiagnostics.disabled = !latestDiagnostics;
  fields.diagnosticsPanel.classList.remove("hidden");
  renderPageStatus(data);
  renderLatestExtractedFields(data?.latestPayload || data?.payload || null, data?.failureReasons || [], data?.lastFilteredCandidate || null);
  if (!data?.ok) {
    fields.diagnosticsPanel.innerHTML = `<strong>诊断失败</strong><br>${escapeHtml(data?.error || "当前页面没有响应插件诊断")}`;
    return;
  }
  const recent = safeArray(data.recentMessages).slice(-3);
  const selectorCounts = safeArray(data.messageSelectorCounts).slice(0, 6);
  const inputCandidates = safeArray(data.replyInputCandidates).slice(0, 4);
  const buttonCandidates = safeArray(data.sendButtonCandidates).slice(0, 4);
  fields.diagnosticsPanel.innerHTML = [
    `<strong>${data.isXianyuPage ? "闲鱼页面已识别" : "当前不是受支持的闲鱼页面"}</strong>`,
    `<div>页面状态：${escapeHtml(data.readyState || "未知")} / ${escapeHtml(data.host || "")}</div>`,
    `<div>输入框：${data.hasReplyInput ? `已找到 ${escapeHtml(data.replyInput)}` : "未找到"}</div>`,
    `<div>发送按钮：${data.hasSendButton ? `已找到 ${escapeHtml(data.sendButton)}` : "未找到"}</div>`,
    `<div>客户名猜测：${escapeHtml(data.inferredCustomerName || "未识别")}</div>`,
    `<div>消息候选：${Number(data.messageCandidateCount || 0)} 条</div>`,
    `<div class="muted">${escapeHtml(data.url || "")}</div>`,
    selectorCounts.length
      ? `<div>选择器命中：${selectorCounts.map((item) => `${escapeHtml(item.selector)}=${Number(item.count || 0)}`).join("，")}</div>`
      : "",
    inputCandidates.length
      ? `<div>输入框候选：${inputCandidates.map((item) => escapeHtml(item.element || item.text || "")).filter(Boolean).join("，")}</div>`
      : "",
    buttonCandidates.length
      ? `<div>按钮候选：${buttonCandidates.map((item) => escapeHtml(item.text || item.element || "")).filter(Boolean).join("，")}</div>`
      : "",
    recent.length ? `<ul>${recent.map((item) => `<li>${escapeHtml(String(item).slice(0, 80))}</li>`).join("")}</ul>` : "",
  ].join("");
}

function renderPageStatus(data) {
  if (!fields.pageStatusPanel) return;
  if (!data) {
    fields.pageStatusPanel.className = "status-card muted";
    fields.pageStatusPanel.textContent = "页面识别：未检查";
    return;
  }
  if (!data.ok) {
    fields.pageStatusPanel.className = "status-card error";
    fields.pageStatusPanel.textContent = `页面识别失败：${data.error || "未知错误"}`;
    return;
  }
  const reasons = safeArray(data.failureReasons).filter(Boolean);
  const isOk = Boolean(data.isXianyuPage) && reasons.length === 0;
  fields.pageStatusPanel.className = `status-card ${isOk ? "ok" : "error"}`;
  fields.pageStatusPanel.innerHTML = [
    `<strong>页面识别：${data.isXianyuPage ? "闲鱼" : "未识别"}</strong>`,
    `消息候选：${Number(data.messageCandidateCount || 0)} 条`,
    `客户昵称：${escapeHtml(data.latestPayload?.customerName || data.inferredCustomerName || "") || "未提取"}`,
    reasons.length ? `原因：${reasons.map(escapeHtml).join(" / ")}` : "",
  ].filter(Boolean).join("<br>");
  renderDailyPage(data);
}

function renderLatestExtractedFields(payload, failureReasons = [], lastFilteredCandidate = null) {
  if (!fields.latestFieldsPanel) return;
  const reasons = safeArray(failureReasons).filter(Boolean);
  const filteredText = lastFilteredCandidate?.text ? String(lastFilteredCandidate.text) : "";
  const filteredReason = lastFilteredCandidate?.reason ? String(lastFilteredCandidate.reason) : "";
  const filteredLine = filteredText
    ? `最近被过滤：${escapeHtml(filteredText)}${filteredReason ? `（原因：${escapeHtml(filteredReason)}）` : ""}`
    : "";
  if (!payload) {
    fields.latestFieldsPanel.className = "diagnostics muted";
    fields.latestFieldsPanel.innerHTML = [
      "<strong>最近捕获字段</strong>",
      "暂无捕获到的买家消息。",
      reasons.length ? `原因：${reasons.map(escapeHtml).join(" / ")}` : "",
      filteredLine,
      "识别失败时，请截图这个面板发回来；不要发送 Cookie、Token、密码。",
    ].filter(Boolean).join("<br>");
    renderDailyRecent(null, reasons);
    return;
  }
  const rows = [
    ["customerName", payload.customerName],
    ["itemTitle", payload.itemTitle],
    ["messageText", payload.messageText || payload.rawMessage || payload.text],
    ["messageTime", payload.messageTime],
    ["sourceUrl", payload.sourceUrl],
    ["externalConversationId", payload.externalConversationId],
    ["platformThreadId", payload.platformThreadId],
    ["externalMessageId", payload.externalMessageId],
  ];
  fields.latestFieldsPanel.className = "diagnostics";
  fields.latestFieldsPanel.innerHTML = [
    "<strong>最近捕获字段</strong>",
    ...rows.map(([label, value]) => `${label}: ${escapeHtml(value || "") || "未提取"}`),
    reasons.length ? `原因：${reasons.map(escapeHtml).join(" / ")}` : "",
    filteredLine,
    "调试信息只在插件本地展示，不会上传 Cookie、Token、密码。",
  ].filter(Boolean).join("<br>");
  renderDailyRecent(payload, reasons);
}

function renderDailyConnection(settings = {}) {
  if (!fields.dailyConnection) return;
  const baseUrl = String(settings.baseUrl || fields.baseUrl?.value || "").trim();
  const token = String(settings.token || fields.token?.value || "").trim();
  const connected = Boolean(baseUrl && token);
  fields.dailyConnection.className = `status-card ${connected ? "ok" : "error"}`;
  fields.dailyConnection.textContent = connected ? `连接状态：已连接 ${baseUrl}` : "连接状态：未连接，请先导入连接码";
}

function renderDailyPage(data) {
  if (!fields.dailyPage) return;
  if (!data?.ok) {
    fields.dailyPage.className = "status-card error";
    fields.dailyPage.textContent = "当前页面：未检测，请打开闲鱼聊天页后刷新插件";
    return;
  }
  const ok = Boolean(data.isXianyuPage);
  fields.dailyPage.className = `status-card ${ok ? "ok" : "error"}`;
  fields.dailyPage.textContent = ok ? "当前页面：已识别闲鱼" : "当前页面：未识别为闲鱼聊天页";
}

function renderDailyRecent(payload, reasons = []) {
  if (!fields.dailyRecent) return;
  if (!payload) {
    fields.dailyRecent.className = "status-card muted";
    fields.dailyRecent.textContent = reasons.length ? `最近同步：暂无，${reasons[0]}` : "最近同步：暂无";
    return;
  }
  const customer = payload.customerName || payload.customerFolder || "客户";
  const text = String(payload.messageText || payload.rawMessage || payload.text || "").slice(0, 44);
  fields.dailyRecent.className = "status-card ok";
  fields.dailyRecent.textContent = `最近同步：${customer} - ${text || "已捕获消息"}`;
}

function formatDiagnosticsForCopy(data) {
  if (!data) throw new Error("暂无诊断结果");
  if (!data.ok) {
    return [
      "闲鱼页面诊断失败",
      `错误：${data.error || "当前页面没有响应插件诊断"}`,
      `时间：${new Date().toLocaleString()}`,
    ].join("\n");
  }
  const recent = safeArray(data.recentMessages).slice(-5);
  const selectorCounts = safeArray(data.messageSelectorCounts);
  const inputCandidates = safeArray(data.replyInputCandidates);
  const buttonCandidates = safeArray(data.sendButtonCandidates);
  return [
    "闲鱼页面诊断结果",
    `时间：${new Date().toLocaleString()}`,
    `URL：${data.url || ""}`,
    `标题：${data.title || ""}`,
    `Host：${data.host || ""}`,
    `Path：${data.path || ""}`,
    `页面状态：${data.readyState || ""}`,
    `是否闲鱼页面：${data.isXianyuPage ? "是" : "否"}`,
    `聊天输入框：${data.hasReplyInput ? `已找到 ${data.replyInput || ""}` : "未找到"}`,
    `发送按钮：${data.hasSendButton ? `已找到 ${data.sendButton || ""}` : "未找到"}`,
    `客户名猜测：${data.inferredCustomerName || "未识别"}`,
    `消息候选数量：${Number(data.messageCandidateCount || 0)}`,
    "消息选择器命中：",
    ...(selectorCounts.length ? selectorCounts.map((item) => `- ${item.selector}: ${Number(item.count || 0)}`) : ["无"]),
    "输入框候选：",
    ...(inputCandidates.length ? inputCandidates.map((item) => `- ${item.element || ""} ${item.text || ""}`.trim()) : ["无"]),
    "发送按钮候选：",
    ...(buttonCandidates.length ? buttonCandidates.map((item) => `- ${item.element || ""} ${item.text || ""}`.trim()) : ["无"]),
    "最近消息候选：",
    ...(recent.length ? recent.map((item, index) => `${index + 1}. ${String(item).slice(0, 200)}`) : ["无"]),
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatStatusTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function outboundModeLabel(mode) {
  if (mode === "send") return "已点击发送";
  if (mode === "fill") return "已填入输入框";
  return mode || "已处理";
}

function renderStatusCard(element, title, status, emptyText, detailRows) {
  if (!element) return;
  if (!status) {
    element.className = "status-card muted";
    element.textContent = emptyText;
    return;
  }
  const isOk = status.ok !== false;
  element.className = `status-card ${isOk ? "ok" : "error"}`;
  const rows = [
    `<strong>${escapeHtml(title)}：${isOk ? "成功" : "失败"}</strong>`,
    ...detailRows(status),
  ];
  if (status.error) rows.push(`原因：${escapeHtml(status.error)}`);
  const updatedAt = formatStatusTime(status.updatedAt);
  if (updatedAt) rows.push(`时间：${escapeHtml(updatedAt)}`);
  element.innerHTML = rows.filter(Boolean).join("<br>");
}

function renderAutoSyncStatus(status) {
  renderStatusCard(
    fields.autoSyncStatusPanel,
    "自动同步",
    status,
    "自动同步：暂无记录",
    (record) => [
      record.action ? `方式：${escapeHtml(record.action)}` : "",
      record.messageId ? `消息：${escapeHtml(record.messageId)}` : "",
      record.sourceUrl ? `页面：${escapeHtml(record.sourceUrl)}` : "",
    ],
  );
}

function renderOutboundStatus(status) {
  renderStatusCard(
    fields.outboundStatusPanel,
    "回闲鱼",
    status,
    "回闲鱼：暂无记录",
    (record) => [
      record.commandId ? `任务：${escapeHtml(record.commandId)}` : "",
      record.mode ? `动作：${escapeHtml(outboundModeLabel(record.mode))}` : "",
    ],
  );
}

function renderSyncLinkStatus(status) {
  if (!fields.syncLinkStatusPanel) return;
  if (!status) {
    fields.syncLinkStatusPanel.className = "status-card muted";
    fields.syncLinkStatusPanel.innerHTML = "<strong>同步链路</strong><br>等待检测当前闲鱼页面。";
    return;
  }
  const ok = Boolean(status.inboxOk || status.lastInboxStatus === 200 || status.lastInboxStatus === 201);
  const error = status.lastError || status.error || "";
  fields.syncLinkStatusPanel.className = `status-card ${ok ? "ok" : error ? "error" : "muted"}`;
  fields.syncLinkStatusPanel.innerHTML = [
    "<strong>同步链路状态</strong>",
    `页面：${status.isXianyuPage ? "已识别闲鱼" : "未识别闲鱼"}`,
    `自动同步：${status.autoSyncEnabled ? "开" : "关"}`,
    `监听器：${status.observerRunning ? "运行中" : "未运行"}`,
    status.lastDomChangeAt ? `DOM 变化：${escapeHtml(status.lastDomChangeAt)}` : "DOM 变化：暂无",
    `候选消息：${Number(status.candidateCount || 0)}`,
    `过滤消息：${Number(status.filteredCount || 0)}`,
    status.lastCapturedSummary ? `最近捕获：${escapeHtml(status.lastCapturedSummary)}` : "最近捕获：暂无",
    status.lastInboxAt ? `发送 /api/inbox：${escapeHtml(status.lastInboxAt)}` : "发送 /api/inbox：暂无",
    status.lastInboxStatus ? `响应状态：HTTP ${Number(status.lastInboxStatus)}${status.duplicated ? "（重复）" : ""}` : "响应状态：暂无",
    status.conversationId ? `conversationId：${escapeHtml(status.conversationId)}` : "",
    status.requestUrl ? `请求：${escapeHtml(status.requestUrl)}` : "",
    status.tokenPresent === false ? "Token：未填写" : status.tokenPresent === true ? "Token：已携带" : "",
    error ? `错误：${escapeHtml(error)}` : "",
    status.lastFilteredText ? `最近过滤：${escapeHtml(status.lastFilteredText)}${status.lastFilteredReason ? `（${escapeHtml(status.lastFilteredReason)}）` : ""}` : "",
  ].filter(Boolean).join("<br>");
  const candidateDetails = Array.isArray(status.candidateDetails) ? status.candidateDetails.slice(-5) : [];
  if (status.lastChosenCandidate || candidateDetails.length) {
    fields.syncLinkStatusPanel.insertAdjacentHTML("beforeend", [
      status.lastChosenCandidate ? `<br>最终选择：${escapeHtml(status.lastChosenCandidate)}` : "",
      candidateDetails.length
        ? `<br><details><summary>最近候选消息</summary>${candidateDetails.map((item) => `${item.filtered ? "过滤" : "候选"}：${escapeHtml(item.text || "")}${item.reason ? `（${escapeHtml(item.reason)}）` : ""}`).join("<br>")}</details>`
        : "",
    ].filter(Boolean).join(""));
  }
}

async function loadRuntimeStatuses() {
  const { autoSyncStatus, outboundStatus, lastCapturedInboxPayload, lastPageDiagnostics, syncLinkStatus } = await chrome.storage.local.get({
    autoSyncStatus: null,
    outboundStatus: null,
    lastCapturedInboxPayload: null,
    lastPageDiagnostics: null,
    syncLinkStatus: null,
  });
  renderAutoSyncStatus(autoSyncStatus);
  renderOutboundStatus(outboundStatus);
  renderSyncLinkStatus(syncLinkStatus);
  renderPageStatus(lastPageDiagnostics);
  renderLatestExtractedFields(lastCapturedInboxPayload || lastPageDiagnostics?.latestPayload || null, lastPageDiagnostics?.failureReasons || []);
}

async function diagnoseCurrentPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("没有找到当前网页");
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "AICS_PAGE_DIAGNOSTICS" });
  } catch {
    throw new Error("当前页面没有加载插件脚本。请确认打开的是闲鱼聊天页，并刷新页面后重试");
  }
  renderDiagnostics(response);
  await chrome.storage.local.set({
    lastPageDiagnostics: response,
    lastCapturedInboxPayload: response?.latestPayload || response?.payload || null,
  });
  await postHeartbeatFromPopup({
    pageStatus: response?.isXianyuPage ? "xianyu-detected" : "not-detected",
    lastCapturedSummary: response?.latestPayload?.messageText || response?.latestPayload?.rawMessage || "",
  }).catch(() => undefined);
  return response;
}

async function captureLatestMessageFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("没有找到当前网页");
  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "AICS_CAPTURE_LATEST_MESSAGE" });
  } catch {
    throw new Error("当前页面没有加载插件脚本。请确认打开的是闲鱼聊天页，并刷新页面后重试");
  }
  if (!response?.ok) throw new Error(response?.error || "同步当前页最新消息失败");
  renderLatestExtractedFields(response.payload || null, []);
  await chrome.storage.local.set({ lastCapturedInboxPayload: response.payload || null });
  return response.payload;
}

function buildInboxPayload(rawMessage, sourceUrl = "") {
  const now = new Date().toISOString();
  const customerName = getTrimmedValue("customerName");
  const customerFolder = getTrimmedValue("customerFolder") || customerName;
  const externalMessageId = [
    fields.platform.value,
    getTrimmedValue("shopAlias") || DEFAULT_SETTINGS.shopAlias,
    customerFolder || customerName || "unknown-customer",
    rawMessage,
    sourceUrl,
  ].join("|");
  return {
    customerName,
    customerFolder,
    platform: fields.platform.value,
    shopAlias: getTrimmedValue("shopAlias") || DEFAULT_SETTINGS.shopAlias,
    sourceChannel: "浏览器插件",
    businessType: fields.businessType.value,
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

function buildInboxPayloadFromPage(pagePayload) {
  const rawMessage = validateMessage(pagePayload?.rawMessage || pagePayload?.text);
  const customerName = getTrimmedValue("customerName") || String(pagePayload?.customerName || "").trim();
  const customerFolder = getTrimmedValue("customerFolder") || String(pagePayload?.customerFolder || "").trim() || customerName;
  return {
    customerName,
    customerFolder,
    platform: fields.platform.value || pagePayload?.platform || DEFAULT_SETTINGS.platform,
    shopAlias: getTrimmedValue("shopAlias") || String(pagePayload?.shopAlias || DEFAULT_SETTINGS.shopAlias).trim(),
    sourceChannel: "浏览器插件",
    businessType: fields.businessType.value || pagePayload?.businessType || DEFAULT_SETTINGS.businessType,
    text: rawMessage,
    rawMessage,
    messageText: rawMessage,
    messageTime: String(pagePayload?.messageTime || new Date().toISOString()).trim(),
    sourceUrl: String(pagePayload?.sourceUrl || "").trim(),
    direction: "inbound",
    itemTitle: String(pagePayload?.itemTitle || "").trim(),
    externalConversationId: String(pagePayload?.externalConversationId || "").trim(),
    platformThreadId: String(pagePayload?.platformThreadId || pagePayload?.sourceUrl || "").trim(),
    externalMessageId: String(pagePayload?.externalMessageId || "").trim(),
  };
}

function buildOrderPayload(rawMessage) {
  const analysis = latestContext.analysis || {};
  return {
    source: "browser-extension",
    platform: fields.platform.value,
    businessType: fields.businessType.value,
    customerNickname: getTrimmedValue("customerName"),
    customerFolder: getTrimmedValue("customerFolder") || getTrimmedValue("customerName"),
    originalMessage: rawMessage,
    sourceUrl: latestContext.sourceUrl,
    analysisResult: analysis,
    suggestedReply: analysis.reply || fields.reply.value,
    missingInfo: analysis.missing_info || [],
    riskFlags: analysis.risk_flags || [],
    items: analysis.items || [],
    createdAt: new Date().toISOString(),
  };
}

async function sendToInbox(rawMessage, sourceUrl = "") {
  const { baseUrl, token } = validateInboxConfig();
  const text = validateMessage(rawMessage);
  const response = await fetch(buildUrl(baseUrl, "/api/inbox"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildInboxPayload(text, sourceUrl)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "发送失败"));
  return data;
}

async function sendPagePayloadToInbox(pagePayload) {
  const { baseUrl, token } = validateInboxConfig();
  const inboxPayload = buildInboxPayloadFromPage(pagePayload);
  const requestUrl = buildUrl(baseUrl, "/api/inbox");
  const existingStatus = await chrome.storage.local.get({ syncLinkStatus: {} });
  const previousSyncLinkStatus = existingStatus.syncLinkStatus || {};
  await chrome.storage.local.set({
    syncLinkStatus: {
      ...previousSyncLinkStatus,
      isXianyuPage: true,
      autoSyncEnabled: fields.autoSyncEnabled.checked,
      observerRunning: true,
      candidateCount: 1,
      filteredCount: 0,
      lastCapturedSummary: String(inboxPayload.rawMessage || "").slice(0, 80),
      lastInboxAt: new Date().toISOString(),
      requestUrl,
      tokenPresent: Boolean(token),
    },
  });
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(inboxPayload),
  });
  const data = await response.json().catch(() => ({}));
  await chrome.storage.local.set({
    syncLinkStatus: {
      ...previousSyncLinkStatus,
      isXianyuPage: true,
      autoSyncEnabled: fields.autoSyncEnabled.checked,
      observerRunning: true,
      candidateCount: 1,
      filteredCount: 0,
      lastCapturedSummary: String(inboxPayload.rawMessage || "").slice(0, 80),
      lastInboxAt: new Date().toISOString(),
      lastInboxStatus: response.status,
      requestUrl,
      tokenPresent: Boolean(token),
      inboxOk: response.ok,
      conversationId: data.conversationId || "",
      duplicated: Boolean(data.duplicated),
      lastError: response.ok ? "" : data.error || `HTTP ${response.status}`,
    },
  });
  if (!response.ok) throw new Error(statusError(response.status, data, "发送失败"));
  fields.rawMessage.value = inboxPayload.rawMessage;
  if (!fields.customerName.value && inboxPayload.customerName) fields.customerName.value = inboxPayload.customerName;
  if (!fields.customerFolder.value && inboxPayload.customerFolder) fields.customerFolder.value = inboxPayload.customerFolder;
  latestContext = {
    rawMessage: inboxPayload.rawMessage,
    sourceUrl: inboxPayload.sourceUrl,
    analysis: null,
  };
  await chrome.storage.local.set({
    lastResult: {
      rawMessage: inboxPayload.rawMessage,
      sourceUrl: inboxPayload.sourceUrl,
      customerName: inboxPayload.customerName,
      updatedAt: Date.now(),
    },
  });
  return data;
}

async function postPluginStatusFromPopup(payload) {
  const { baseUrl, token } = validateInboxConfig();
  await fetch(buildUrl(baseUrl, "/api/plugin-status"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      platform: fields.platform.value || DEFAULT_SETTINGS.platform,
      ...payload,
    }),
  }).catch(() => undefined);
}

async function postHeartbeatFromPopup(extra = {}) {
  const { baseUrl, token } = validateInboxConfig();
  const latestPayload = latestDiagnostics?.latestPayload || null;
  await fetch(buildUrl(baseUrl, "/api/plugin/heartbeat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      siteOrigin: baseUrl,
      platform: fields.platform.value,
      shopAlias: getTrimmedValue("shopAlias") || DEFAULT_SETTINGS.shopAlias,
      pageStatus: latestDiagnostics?.isXianyuPage ? "xianyu-detected" : "not-detected",
      autoSyncEnabled: fields.autoSyncEnabled.checked,
      lastSyncAt: "",
      lastCapturedSummary: latestPayload?.messageText || latestPayload?.rawMessage || "",
      extensionVersion: chrome.runtime.getManifest?.().version || "",
      ...extra,
    }),
  }).catch(() => undefined);
}

async function postCurrentConfigStatusFromPopup() {
  if (!getTrimmedValue("token")) return;
  await postPluginStatusFromPopup(buildConfigStatusPayload(
    fields.autoSyncEnabled.checked,
    fields.outboundSyncEnabled.checked,
    fields.outboundMode.value,
  ));
  await postHeartbeatFromPopup();
}

async function syncOpenSiteStorage(kind, record) {
  if (!record || !record.id) return;
  const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
  const tabs = await chrome.tabs.query({ url: `${baseUrl}/*` }).catch(() => []);
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
        const withoutDuplicate = readList().filter((item) => item && item.id !== nextRecord.id);
        window.localStorage.setItem(key, JSON.stringify([nextRecord, ...withoutDuplicate].slice(0, 1000)));
        window.dispatchEvent(new Event(eventName));
      },
    }).catch(() => undefined);
  }));
}

async function saveOrder(rawMessage) {
  const { baseUrl, token } = validateInboxConfig();
  const text = validateMessage(rawMessage);
  if (!latestContext.analysis) throw new Error("请先直接生成回复，再保存订单");
  const response = await fetch(buildUrl(baseUrl, "/api/orders"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildOrderPayload(text)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "订单保存失败"));
  return data;
}

async function analyzeMessage(rawMessage) {
  const { baseUrl, platform, businessType } = validateBaseConfig();
  const text = validateMessage(rawMessage);
  const response = await fetch(buildUrl(baseUrl, "/api/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatText: text,
      businessType,
      platform,
      sellerRules: "",
      systemPrompt: "",
      source: "browser-extension",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(statusError(response.status, data, "AI 分析失败"));
  return data;
}

function renderList(element, items, emptyText) {
  element.innerHTML = "";
  const values = safeArray(items).length ? safeArray(items) : [emptyText];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = String(item || "");
    element.appendChild(li);
  });
}

function renderAnalysis(analysis, rawMessage = "") {
  latestContext = { ...latestContext, rawMessage, analysis };
  fields.resultPanel.classList.remove("hidden");
  fields.summary.textContent = analysis?.summary || analysis?.customer_intent || "暂无摘要";
  renderList(fields.missingInfo, analysis?.missing_info, "暂无明显缺失");
  renderList(fields.riskFlags, analysis?.risk_flags, "暂无明显风险");
  fields.reply.value = analysis?.reply || "";
}

async function copyText(text) {
  const value = String(text || "");
  if (!value.trim()) throw new Error("暂无可复制内容");
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("复制失败，请手动复制");
    return true;
  }
}

async function loadLastResult() {
  const { lastResult } = await chrome.storage.local.get({ lastResult: null });
  if (!lastResult) return;
  if (lastResult.rawMessage) fields.rawMessage.value = lastResult.rawMessage;
  if (lastResult.customerName && !fields.customerName.value) fields.customerName.value = lastResult.customerName;
  latestContext = {
    rawMessage: lastResult.rawMessage || "",
    sourceUrl: lastResult.sourceUrl || "",
    analysis: lastResult.analysis || null,
  };
  if (lastResult.analysis) renderAnalysis(lastResult.analysis, lastResult.rawMessage || "");
  if (lastResult.error) setStatus(lastResult.error, true);
}

async function captureIntoField() {
  const captured = await captureSelection();
  if (captured.selectedText) fields.rawMessage.value = captured.selectedText;
  if (!fields.customerName.value && captured.customerName) fields.customerName.value = captured.customerName;
  if (!fields.customerFolder.value && (captured.customerName || fields.customerName.value)) {
    fields.customerFolder.value = captured.customerName || fields.customerName.value;
  }
  latestContext = { ...latestContext, rawMessage: captured.selectedText || fields.rawMessage.value, sourceUrl: captured.url || "" };
  return captured;
}

document.getElementById("importConnectionCode").addEventListener("click", async () => {
  try {
    setStatus("正在导入配置...");
    const { baseUrl, token } = await applyConnectionCode(fields.connectionCode.value);
    await testConnectionWith(baseUrl, token);
    await postHeartbeatFromPopup();
    setStatus("配置已导入并保存。自动同步和回闲鱼已开启，可打开闲鱼闭环验证开始实机测试");
  } catch (error) {
    setStatus(humanError(error, "导入连接码失败"), true);
  }
});

document.getElementById("dailyAutoSyncEnabled")?.addEventListener("change", async (event) => {
  fields.autoSyncEnabled.checked = Boolean(event.target.checked);
  try {
    await saveSettings();
    await postHeartbeatFromPopup();
    setStatus(fields.autoSyncEnabled.checked ? "已开始监听闲鱼新消息" : "已暂停监听");
  } catch (error) {
    setStatus(humanError(error, "保存监听开关失败"), true);
  }
});

document.getElementById("capture").addEventListener("click", async () => {
  try {
    const captured = await captureIntoField();
    setStatus(captured.selectedText ? "已读取选中文本" : "没有检测到选中文本，可以手动粘贴", !captured.selectedText);
  } catch (error) {
    setStatus(humanError(error, "读取失败"), true);
  }
});

document.getElementById("saveConfig").addEventListener("click", async () => {
  try {
    await saveSettings();
    setStatus("配置已保存");
  } catch (error) {
    setStatus(humanError(error, "保存失败，请重试"), true);
  }
});

document.getElementById("testConnection").addEventListener("click", async () => {
  try {
    const { baseUrl, token } = validateInboxConfig();
    await testConnectionWith(baseUrl, token);
    await postHeartbeatFromPopup();
    setStatus("网站可访问，Token 正确");
  } catch (error) {
    setStatus(humanError(error, "测试连接失败"), true);
  }
});

document.getElementById("diagnosePage").addEventListener("click", async () => {
  try {
    setStatus("正在诊断当前页面...");
    const result = await diagnoseCurrentPage();
    if (!result?.ok) throw new Error(result?.error || "诊断失败");
    if (!result.isXianyuPage) {
      setStatus("当前不是受支持的闲鱼页面", true);
    } else if (!result.hasReplyInput) {
      setStatus("已识别闲鱼页面，但没有找到聊天输入框", true);
    } else {
      setStatus(result.hasSendButton ? "闲鱼页面诊断通过" : "已找到输入框，但没有找到发送按钮");
    }
  } catch (error) {
    renderDiagnostics({ ok: false, error: humanError(error, "页面诊断失败") });
    setStatus(humanError(error, "页面诊断失败"), true);
  }
});

document.getElementById("copyDiagnostics").addEventListener("click", async () => {
  try {
    await copyText(formatDiagnosticsForCopy(latestDiagnostics));
    setStatus("已复制诊断结果");
  } catch (error) {
    setStatus(humanError(error, "复制诊断结果失败"), true);
  }
});

document.getElementById("syncLatestPageMessage").addEventListener("click", async () => {
  try {
    await saveSettings();
    setStatus("正在同步当前页最新消息...");
    const pagePayload = await captureLatestMessageFromPage();
    renderLatestExtractedFields(pagePayload, []);
    const preview = [
      `客户：${pagePayload.customerName || "未提取"}`,
      `商品：${pagePayload.itemTitle || "未提取"}`,
      `消息：${String(pagePayload.messageText || pagePayload.rawMessage || "").slice(0, 120)}`,
      `页面：${pagePayload.sourceUrl || ""}`,
    ].join("\n");
    if (!window.confirm(`确认同步这条客户消息到消息中心吗？\n\n${preview}`)) {
      setStatus("已取消同步");
      return;
    }
    const result = await sendPagePayloadToInbox(pagePayload);
    await syncOpenSiteStorage("message", result.message);
    await postPluginStatusFromPopup({
      kind: "autoSync",
      ok: true,
      messageId: result.message?.id || "",
      sourceUrl: pagePayload?.sourceUrl || "",
      action: "手动同步",
    });
    await chrome.storage.local.set({
      autoSyncStatus: {
        ok: true,
        messageId: result.message?.id || "",
        sourceUrl: pagePayload?.sourceUrl || "",
        action: "手动同步",
        updatedAt: Date.now(),
      },
    });
    setStatus(`当前页最新消息已同步：${result.conversationId || "已写入"}${result.duplicated ? "（重复消息）" : ""}`);
  } catch (error) {
    const message = humanError(error, "同步当前页最新消息失败");
    await postPluginStatusFromPopup({ kind: "autoSync", ok: false, action: "手动同步", error: message }).catch(() => undefined);
    await chrome.storage.local.set({ autoSyncStatus: { ok: false, action: "手动同步", error: message, updatedAt: Date.now() } });
    setStatus(message, true);
  }
});

document.getElementById("send").addEventListener("click", async () => {
  try {
    await saveSettings();
    let rawMessage = fields.rawMessage.value.trim();
    if (!rawMessage) {
      const captured = await captureIntoField();
      rawMessage = captured.selectedText?.trim() || "";
    }
    setStatus("发送中...");
    const result = await sendToInbox(rawMessage, latestContext.sourceUrl);
    await syncOpenSiteStorage("message", result.message);
    setStatus("已发送到消息中心");
  } catch (error) {
    setStatus(humanError(error, "发送失败"), true);
  }
});

document.getElementById("analyze").addEventListener("click", async () => {
  try {
    await saveSettings();
    let rawMessage = fields.rawMessage.value.trim();
    if (!rawMessage) {
      const captured = await captureIntoField();
      rawMessage = captured.selectedText?.trim() || "";
    }
    setStatus("AI 正在生成回复草稿...");
    const analysis = await analyzeMessage(rawMessage);
    renderAnalysis(analysis, rawMessage);
    await chrome.storage.local.set({ lastResult: { rawMessage, sourceUrl: latestContext.sourceUrl, analysis, updatedAt: Date.now() } });
    setStatus("回复草稿已生成");
  } catch (error) {
    setStatus(humanError(error, "AI 分析失败"), true);
  }
});

document.getElementById("copyReply").addEventListener("click", async () => {
  try {
    await copyText(fields.reply.value);
    setStatus("已复制回复");
  } catch (error) {
    setStatus(humanError(error, "复制失败，请手动复制"), true);
  }
});

document.getElementById("saveOrder").addEventListener("click", async () => {
  try {
    const rawMessage = validateMessage(latestContext.rawMessage || fields.rawMessage.value);
    setStatus("保存中...");
    const result = await saveOrder(rawMessage);
    await syncOpenSiteStorage("order", result.order);
    setStatus(result.duplicate ? "可能是重复订单，已保留原订单" : "订单已保存");
  } catch (error) {
    setStatus(humanError(error, "订单保存失败"), true);
  }
});

document.getElementById("openMessages").addEventListener("click", async () => {
  try {
    const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
    await chrome.tabs.create({ url: `${baseUrl}/messages` });
  } catch (error) {
    setStatus(humanError(error, "打开消息中心失败"), true);
  }
});

document.getElementById("openXianyuMvp").addEventListener("click", async () => {
  try {
    const baseUrl = normalizeBaseUrl(fields.baseUrl.value);
    await chrome.tabs.create({ url: `${baseUrl}/xianyu-mvp` });
  } catch (error) {
    setStatus(humanError(error, "打开闲鱼闭环验证失败"), true);
  }
});

document.getElementById("dailyGenerateReply")?.addEventListener("click", () => {
  document.getElementById("analyze")?.click();
});

document.getElementById("dailySyncLatestPageMessage")?.addEventListener("click", () => {
  document.getElementById("syncLatestPageMessage")?.click();
});

document.getElementById("dailyFillPendingReply")?.addEventListener("click", async () => {
  try {
    setStatus("正在填入闲鱼输入框...");
    const result = await chrome.runtime.sendMessage({ type: "AICS_FILL_PENDING_OUTBOX" });
    if (!result?.ok) throw new Error(result?.error || "填入失败");
    await loadRuntimeStatuses();
    setStatus("已填入闲鱼输入框，请确认内容后手动发送");
  } catch (error) {
    setStatus(humanError(error, "填入闲鱼输入框失败"), true);
  }
});

document.getElementById("dailyCopyReply")?.addEventListener("click", () => {
  document.getElementById("copyReply")?.click();
});

document.getElementById("dailySaveOrder")?.addEventListener("click", () => {
  document.getElementById("saveOrder")?.click();
});

document.getElementById("dailyOpenMessages")?.addEventListener("click", () => {
  document.getElementById("openMessages")?.click();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.autoSyncStatus) renderAutoSyncStatus(changes.autoSyncStatus.newValue || null);
  if (changes.syncLinkStatus) renderSyncLinkStatus(changes.syncLinkStatus.newValue || null);
  if (changes.outboundStatus) renderOutboundStatus(changes.outboundStatus.newValue || null);
  if (changes.lastCapturedInboxPayload) renderLatestExtractedFields(changes.lastCapturedInboxPayload.newValue || null, []);
  if (changes.lastPageDiagnostics) renderDiagnostics(changes.lastPageDiagnostics.newValue || null);
});

loadSettings().then(async () => {
  await Promise.all([loadLastResult(), loadRuntimeStatuses()]);
  await postCurrentConfigStatusFromPopup().catch(() => undefined);
  await diagnoseCurrentPage().catch((error) => {
    renderDiagnostics({ ok: false, error: humanError(error, "当前页面未加载诊断脚本") });
  });
});

window.setInterval(() => {
  if (fields.autoSyncEnabled?.checked) postHeartbeatFromPopup().catch(() => undefined);
}, 20_000);
