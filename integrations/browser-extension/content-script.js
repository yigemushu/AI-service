const AUTO_SYNC_SETTINGS = {
  autoSyncEnabled: false,
  platform: "闲鱼",
  businessType: "xianyu",
  customerName: "",
  customerFolder: "",
  shopAlias: "default-shop",
  myNickname: "",
  debugMode: false,
};

const MESSAGE_SELECTORS = [
  '[class*="message"]',
  '[class*="Message"]',
  '[class*="msg"]',
  '[class*="Msg"]',
  '[class*="bubble"]',
  '[class*="Bubble"]',
  '[class*="chat"]',
  '[class*="Chat"]',
  '[role="listitem"]',
];

const OUTGOING_HINTS = /(^|[-_\s])(self|mine|me|right|send|sent|seller|owner|out|outgoing)([-_\s]|$)|自己|本人|卖家|已发送|我[:：]/i;
const SYSTEM_TEXT = /^(今天|昨天|星期.|周.|已读|未读|发送|按 Enter 发送|图片|表情|更多|系统消息|\d{1,2}:\d{2})$/;

const CONTROL_TEXT = /^(发送|清除未读|表情|图片|常用语|更多|订单|退款|联系卖家|输入消息|按 Enter 发送|请选择客户消息|Send)$/i;
const CONTROL_COMBO_TEXT = /(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)(\s*[-|/]\s*|\s+)+(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)/i;
const BUBBLE_HINTS = /(message|msg|bubble|chat|talk|im|dialog|conversation|item|cell|row|消息|气泡|聊天)/i;

let settings = { ...AUTO_SYNC_SETTINGS };
let observer = null;
let scanTimer = null;
let lastUrl = location.href;
let suppressUntil = 0;
let lastFilteredCandidate = null;
let syncLinkStatus = {
  isXianyuPage: /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(location.href),
  autoSyncEnabled: false,
  observerRunning: false,
  lastDomChangeAt: "",
  candidateCount: 0,
  filteredCount: 0,
  lastCapturedSummary: "",
  lastError: "",
};
const sentFingerprints = new Set();
const SENT_STORAGE_KEY = "aics.recentInboundFingerprints";

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function shouldSkipText(text) {
  const value = cleanText(text);
  if (!value || value.length < 2 || value.length > 800) return true;
  if (SYSTEM_TEXT.test(value)) return true;
  if (CONTROL_TEXT.test(value)) return true;
  if (CONTROL_COMBO_TEXT.test(value)) return true;
  if (/^(https?:\/\/|www\.)/i.test(value)) return true;
  if (/^(复制|删除|撤回|转发|举报|设为未读)$/.test(value)) return true;
  return false;
}

function textFromElement(element) {
  const text = cleanText(element?.innerText || element?.textContent || "");
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => cleanText(line))
    .filter((line) => line && !SYSTEM_TEXT.test(line))
    .join("\n");
}

function looksOutgoing(element) {
  let current = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const hints = [
      current.className,
      current.id,
      current.getAttribute?.("data-role"),
      current.getAttribute?.("aria-label"),
    ].join(" ");
    if (OUTGOING_HINTS.test(hints)) return true;
    current = current.parentElement;
  }
  return false;
}

function isLikelyMessageBubble(element) {
  let current = element;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const hints = [
      current.className,
      current.id,
      current.getAttribute?.("role"),
      current.getAttribute?.("data-role"),
      current.getAttribute?.("data-testid"),
      current.getAttribute?.("aria-label"),
    ].join(" ");
    if (BUBBLE_HINTS.test(hints)) return true;
    current = current.parentElement;
  }
  return false;
}

function cleanCustomerName(value) {
  const text = cleanText(value)
    .replace(/\s*[-_|｜].*$/, "")
    .replace(/的?\s*聊天.*$/, "")
    .trim();
  if (!text || text.length < 2 || text.length > 24) return "";
  if (/闲鱼|咸鱼|goofish|淘宝|消息|聊天|首页|登录|搜索|订单|商品|发布|通知|AI客服/.test(text)) return "";
  if (/^[0-9:：\-. ]+$/.test(text)) return "";
  if (settings.myNickname && normalizeName(text).includes(normalizeName(settings.myNickname))) return "";
  return text;
}

function inferCustomerName(element) {
  if (settings.customerName) return settings.customerName;
  const candidates = [];
  function push(value) {
    const name = cleanCustomerName(value);
    if (name && !candidates.includes(name)) candidates.push(name);
  }

  let current = element;
  for (let depth = 0; current && depth < 7; depth += 1) {
    push(current.getAttribute?.("data-nick"));
    push(current.getAttribute?.("data-name"));
    push(current.getAttribute?.("data-username"));
    push(current.getAttribute?.("aria-label"));
    push(current.getAttribute?.("title"));
    push(current.previousElementSibling?.textContent);
    current.querySelectorAll?.("img[alt], [title], [aria-label]").forEach((item) => {
      push(item.getAttribute("alt"));
      push(item.getAttribute("title"));
      push(item.getAttribute("aria-label"));
    });
    current = current.parentElement;
  }
  (document.title || "").split(/[-_|｜]/).forEach(push);
  return candidates[0] || "";
}

function fingerprintPayload(payload) {
  return [
    payload.externalMessageId || "",
    payload.platform || "闲鱼",
    payload.shopAlias || "default-shop",
    payload.customerName || "",
    payload.itemTitle || "",
    payload.messageText || payload.rawMessage || "",
    payload.messageTime || payload.sourceUrl || "",
  ].join("::").slice(0, 1600);
}

async function loadRememberedFingerprints() {
  try {
    const data = await chrome.storage.local.get({ [SENT_STORAGE_KEY]: [] });
    const values = Array.isArray(data[SENT_STORAGE_KEY]) ? data[SENT_STORAGE_KEY] : [];
    values.slice(-300).forEach((value) => sentFingerprints.add(value));
  } catch {}
}

async function remember(fingerprintValue) {
  sentFingerprints.add(fingerprintValue);
  while (sentFingerprints.size > 300) {
    const first = sentFingerprints.values().next().value;
    sentFingerprints.delete(first);
  }
  try {
    await chrome.storage.local.set({ [SENT_STORAGE_KEY]: [...sentFingerprints].slice(-300) });
  } catch {}
}

function buildPayload(element, text) {
  const adapter = window.AICS_XIANYU_ADAPTER;
  if (adapter?.isXianyuPage?.()) {
    try {
      return adapter.extractMessage(element, text, settings);
    } catch (error) {
      if (!/likely message bubble|message bubble|control text/i.test(String(error?.message || ""))) throw error;
    }
  }
  const customerName = inferCustomerName(element);
  const messageTime = new Date().toISOString();
  return {
    text,
    rawMessage: text,
    messageText: text,
    messageTime,
    direction: "inbound",
    customerName,
    customerFolder: settings.customerFolder || customerName || "",
    platform: settings.platform || "闲鱼",
    shopAlias: settings.shopAlias || "default-shop",
    businessType: settings.businessType || "xianyu",
    sourceUrl: location.href,
    platformThreadId: normalizeComparableUrl(location.href),
    externalConversationId: normalizeComparableUrl(location.href),
    externalMessageId: "",
  };
}

function recordFiltered(text, reason) {
  const value = cleanText(text);
  if (!value) return;
  syncLinkStatus.filteredCount = Number(syncLinkStatus.filteredCount || 0) + 1;
  syncLinkStatus.lastFilteredText = value.slice(0, 120);
  syncLinkStatus.lastFilteredReason = reason;
  lastFilteredCandidate = {
    text: value.slice(0, 120),
    reason,
    at: new Date().toISOString(),
  };
  persistSyncLinkStatus();
}

function persistSyncLinkStatus(extra = {}) {
  syncLinkStatus = {
    ...syncLinkStatus,
    ...extra,
    isXianyuPage: /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(location.href),
    autoSyncEnabled: Boolean(settings.autoSyncEnabled),
    updatedAt: new Date().toISOString(),
  };
  try {
    chrome.storage.local.set({ syncLinkStatus }).catch(() => undefined);
  } catch {}
}

async function sendCandidate(element, text) {
  if (!settings.autoSyncEnabled) return;
  if (shouldSkipText(text)) {
    recordFiltered(text, "filtered_text");
    return;
  }
  if (looksOutgoing(element)) {
    recordFiltered(text, "outgoing_or_seller_message");
    return;
  }
  if (Date.now() < suppressUntil) return;
  const payload = buildPayload(element, text);
  persistSyncLinkStatus({
    candidateCount: Number(syncLinkStatus.candidateCount || 0) + 1,
    lastCapturedSummary: String(payload.messageText || payload.rawMessage || text || "").slice(0, 100),
    lastError: "",
  });
  const key = fingerprintPayload(payload);
  if (sentFingerprints.has(key)) return;
  await remember(key);
  const result = chrome.runtime.sendMessage({ type: "AICS_AUTO_INBOX_MESSAGE", payload });
  if (result?.catch) result.catch(() => {
    sentFingerprints.delete(key);
  });
}

function isVisible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isEditableElement(element) {
  if (!element || !isVisible(element)) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = String(element.getAttribute("type") || "text").toLowerCase();
    return ["text", "search", "url", "tel", "email", ""].includes(type);
  }
  return element.getAttribute?.("contenteditable") === "true" || element.isContentEditable;
}

function findReplyInput() {
  if (isEditableElement(document.activeElement)) return document.activeElement;
  const selectors = [
    "textarea",
    'input[type="text"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[class*="input"]',
    '[class*="Input"]',
    '[class*="editor"]',
    '[class*="Editor"]',
  ];
  const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(isEditableElement);
  candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  return candidates[0] || null;
}

function setReplyInputValue(input, value) {
  input.focus();
  const tag = input.tagName?.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
  } else {
    input.textContent = value;
  }
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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

function assertCommandMatchesCurrentPage(command) {
  const sourceUrl = cleanText(command?.sourceUrl || "");
  if (!sourceUrl) throw new Error("发送任务缺少闲鱼聊天链接");
  if (normalizeComparableUrl(sourceUrl) !== normalizeComparableUrl(location.href)) {
    throw new Error("当前闲鱼页面和发送任务链接不一致，已阻止回填以避免发错客户");
  }
}

function findSendButton() {
  const candidates = [...document.querySelectorAll("button, [role='button'], a")]
    .filter(isVisible)
    .filter((element) => {
      const text = cleanText(element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "");
      return /^(发送|Send)$/i.test(text) || /发送|send/i.test(text);
    });
  return candidates.find((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true") || null;
}

function elementTextSnippet(element, limit = 80) {
  const text = cleanText(element?.innerText || element?.textContent || element?.getAttribute?.("aria-label") || element?.getAttribute?.("title") || "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function describeElement(element) {
  if (!element) return "";
  const tag = element.tagName?.toLowerCase() || "";
  const id = element.id ? `#${element.id}` : "";
  const className = String(element.className || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(".");
  const classPart = className ? `.${className}` : "";
  return `${tag}${id}${classPart}`;
}

function describeElementCandidate(element) {
  const rect = element?.getBoundingClientRect?.();
  return {
    element: describeElement(element),
    text: elementTextSnippet(element),
    bottom: Math.round(Number(rect?.bottom || 0)),
    disabled: Boolean(element?.disabled || element?.getAttribute?.("aria-disabled") === "true"),
  };
}

function getReplyInputCandidates() {
  const selectors = [
    "textarea",
    'input[type="text"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[class*="input"]',
    '[class*="Input"]',
    '[class*="editor"]',
    '[class*="Editor"]',
  ];
  const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((element, index, list) => list.indexOf(element) === index)
    .filter(isEditableElement)
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  return candidates.map(describeElementCandidate).slice(0, 6);
}

function getSendButtonCandidates() {
  return [...document.querySelectorAll("button, [role='button'], a")]
    .filter(isVisible)
    .map(describeElementCandidate)
    .filter((candidate) => candidate.text || /button|a/.test(candidate.element))
    .slice(0, 8);
}

function getMessageSelectorCounts() {
  return MESSAGE_SELECTORS.map((selector) => ({
    selector,
    count: document.querySelectorAll(selector).length,
  })).filter((item) => item.count > 0);
}

function elementPath(element) {
  if (!element) return "";
  const parts = [];
  let current = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const tag = current.tagName?.toLowerCase() || "";
    const id = current.id ? `#${current.id}` : "";
    const className = String(current.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(".");
    parts.unshift(`${tag}${id}${className ? `.${className}` : ""}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function isInteractiveContainer(element) {
  return Boolean(element?.closest?.("button,a,input,textarea,select,[role='button'],[role='textbox'],[contenteditable='true']"));
}

function isLikelyLeftConversationList(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return false;
  return rect.right < Math.max(260, window.innerWidth * 0.24);
}

function splitCandidateLines(text) {
  return cleanText(text)
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}

function shouldRejectCandidateText(text) {
  if (shouldSkipText(text)) return "filtered_text";
  if (/^(发送|清除未读|表情|图片|常用语|更多|订单|退款|联系卖家|输入消息|按 Enter 发送|请选择客户消息|Send)$/i.test(text)) {
    return "control_text";
  }
  if (/(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)(\s*[-|/]\s*|\s+)+(清除未读|表情|图片|常用语|更多|订单|退款|发送|Send)/i.test(text)) {
    return "control_combo_text";
  }
  if (/^(复制|删除|撤回|转发|举报|设为未读|已读|未读)$/.test(text)) return "control_action";
  return "";
}

function messagePriority(text, element, source) {
  const rect = element?.getBoundingClientRect?.();
  let score = 0;
  if (/实机测试\s*XY-[A-Z0-9-]+/i.test(text)) score += 100;
  if (/还在吗|发货|可以发货|多少钱|包邮|库存|今天|明天|想要|我要|拍下|下单/.test(text)) score += 30;
  if (source === "selector") score += 15;
  if (isLikelyMessageBubble(element)) score += 20;
  if (rect && rect.left > window.innerWidth * 0.25) score += 10;
  if (rect) score += Math.min(30, Math.max(0, rect.bottom / Math.max(1, window.innerHeight)) * 30);
  return score;
}

function pushCandidateDebug(debug, item) {
  debug.push({
    text: String(item.text || "").slice(0, 140),
    filtered: Boolean(item.filtered),
    reason: item.reason || "",
    source: item.source || "",
    element: item.element ? elementPath(item.element) : "",
  });
  if (debug.length > 24) debug.shift();
}

function collectVisibleMessageCandidates(root = document, options = {}) {
  const manual = Boolean(options.manual);
  const elements = [];
  let checkedCount = 0;
  MESSAGE_SELECTORS.forEach((selector) => {
    root.querySelectorAll?.(selector).forEach((element) => elements.push({ element, source: "selector" }));
  });
  if (manual || elements.length === 0) {
    root.querySelectorAll?.("div,span,p,li,[role='listitem']").forEach((element) => {
      elements.push({ element, source: "visible_text" });
    });
  }

  const debug = [];
  const candidates = [];
  const seen = new Set();
  elements.forEach(({ element, source }) => {
    if (!element || seen.has(element) || !isVisible(element)) return;
    seen.add(element);
    checkedCount += 1;
    const rawText = textFromElement(element);
    const lines = splitCandidateLines(rawText);
    if (!lines.length) return;
    const rect = element.getBoundingClientRect();
    const isSelectorCandidate = source === "selector";
    const looksBubble = isLikelyMessageBubble(element);
    const fromLeftList = isLikelyLeftConversationList(element);
    const isInteractive = isInteractiveContainer(element);

    lines.forEach((line) => {
      const rejectReason = shouldRejectCandidateText(line);
      if (rejectReason) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: rejectReason, source });
        recordFiltered(line, rejectReason);
        return;
      }
      if (isInteractive) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: "interactive_control", source });
        recordFiltered(line, "interactive_control");
        return;
      }
      if (fromLeftList && !/实机测试\s*XY-[A-Z0-9-]+/i.test(line)) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: "left_conversation_list", source });
        recordFiltered(line, "left_conversation_list");
        return;
      }
      if (looksOutgoing(element)) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: "outgoing_or_seller_message", source });
        recordFiltered(line, "outgoing_or_seller_message");
        return;
      }
      if (!manual && !looksBubble && !isSelectorCandidate) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: "not_message_bubble", source });
        return;
      }
      if (rawText.length > line.length * 3 && !/实机测试\s*XY-[A-Z0-9-]+/i.test(line)) {
        pushCandidateDebug(debug, { element, text: line, filtered: true, reason: "container_text", source });
        return;
      }
      candidates.push({
        element,
        text: line,
        rawText,
        source,
        bottom: rect.bottom,
        priority: messagePriority(line, element, source),
      });
      pushCandidateDebug(debug, { element, text: line, filtered: false, source });
    });
  });

  const uniqueCandidates = candidates.filter((candidate, index, list) => {
    return list.findIndex((item) => item.text === candidate.text) === index;
  }).sort((a, b) => {
    if (manual && b.priority !== a.priority) return b.priority - a.priority;
    return a.bottom - b.bottom;
  });

  persistSyncLinkStatus({
    observerRunning: Boolean(observer),
    candidateCount: uniqueCandidates.length,
    checkedNodeCount: checkedCount,
    candidateDetails: debug.slice(-8),
    lastError: checkedCount ? (uniqueCandidates.length ? "" : "发现页面文本，但没有可同步的买家消息候选") : "未找到聊天消息区域",
  });
  return uniqueCandidates;
}

function getMessageCandidates(root = document, options = {}) {
  const visibleCandidates = collectVisibleMessageCandidates(root, options);
  if (visibleCandidates.length || options.manual) return visibleCandidates;
  const candidates = [];
  let checkedCount = 0;
  MESSAGE_SELECTORS.forEach((selector) => {
    root.querySelectorAll(selector).forEach((element) => {
      checkedCount += 1;
      if (!isLikelyMessageBubble(element)) {
        recordFiltered(textFromElement(element), "not_message_bubble");
        return;
      }
      const text = textFromElement(element);
      if (shouldSkipText(text)) {
        recordFiltered(text, "filtered_text");
        return;
      }
      if (looksOutgoing(element)) {
        recordFiltered(text, "outgoing_or_seller_message");
        return;
      }
      const lines = text.split("\n").map(cleanText).filter(Boolean);
      const messageText = lines.length > 1 ? lines[lines.length - 1] : text;
      if (shouldSkipText(messageText)) {
        recordFiltered(messageText, "filtered_message_text");
        return;
      }
      candidates.push({
        element,
        text: messageText,
        rawText: text,
      });
    });
  });
  const uniqueCandidates = candidates.filter((candidate, index, list) => {
    return list.findIndex((item) => item.element === candidate.element || item.text === candidate.text) === index;
  });
  persistSyncLinkStatus({
    observerRunning: Boolean(observer),
    candidateCount: uniqueCandidates.length,
    checkedNodeCount: checkedCount,
    lastError: checkedCount ? "" : "未找到聊天消息区域",
  });
  return uniqueCandidates;
}

function getLatestMessagePayload() {
  const candidates = getMessageCandidates(document, { manual: true });
  const latest = candidates[0] || candidates[candidates.length - 1];
  if (!latest) throw new Error("没有在当前闲鱼聊天页识别到买家消息");
  persistSyncLinkStatus({
    lastChosenCandidate: latest.text.slice(0, 140),
    lastCapturedSummary: latest.text.slice(0, 100),
    lastError: "",
  });
  return buildPayload(latest.element, latest.text);
}

function getPageDiagnostics() {
  const input = findReplyInput();
  const sendButton = findSendButton();
  const messageCandidates = getMessageCandidates(document, { manual: true });
  const messageTexts = messageCandidates.map((candidate) => candidate.text);
  const uniqueMessages = Array.from(new Set(messageTexts)).slice(-5);
  const isXianyuPage = /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(location.href);
  const latest = messageCandidates[0] || messageCandidates[messageCandidates.length - 1] || null;
  let latestPayload = null;
  if (latest) {
    try {
      latestPayload = buildPayload(latest.element, latest.text);
    } catch {}
  }
  const failureReasons = [];
  if (!isXianyuPage) failureReasons.push("未识别闲鱼页面");
  if (!messageCandidates.length) failureReasons.push("未找到聊天消息区域");
  if (latestPayload && !latestPayload.customerName) failureReasons.push("未提取到客户昵称");
  if (!latestPayload?.messageText) failureReasons.push("未提取到消息文本");
  return {
    ok: true,
    url: location.href,
    host: location.host || "",
    path: `${location.pathname || ""}${location.search || ""}`,
    title: document.title || "",
    readyState: document.readyState || "",
    isXianyuPage,
    hasReplyInput: Boolean(input),
    replyInput: describeElement(input),
    replyInputCandidates: getReplyInputCandidates(),
    hasSendButton: Boolean(sendButton),
    sendButton: describeElement(sendButton),
    sendButtonCandidates: getSendButtonCandidates(),
    inferredCustomerName: inferCustomerName(input || document.body),
    messageSelectorCounts: getMessageSelectorCounts(),
    messageCandidateCount: messageCandidates.length,
    recentMessages: uniqueMessages,
    latestPayload,
    lastFilteredCandidate,
    candidateDetails: syncLinkStatus.candidateDetails || [],
    lastChosenCandidate: syncLinkStatus.lastChosenCandidate || "",
    failureReasons,
  };
}

function postPageHeartbeat() {
  try {
    const diagnostics = getPageDiagnostics();
    chrome.runtime.sendMessage({
      type: "AICS_PAGE_STATUS",
      isXianyuPage: diagnostics.isXianyuPage,
      latestPayload: diagnostics.latestPayload || null,
      lastFilteredCandidate: diagnostics.lastFilteredCandidate || null,
    }).catch(() => undefined);
  } catch {}
}

async function executeOutboundReply(command) {
  const reply = cleanText(command?.reply || "");
  if (!reply) throw new Error("回复内容为空");
  assertCommandMatchesCurrentPage(command);
  const input = findReplyInput();
  if (!input) throw new Error("没有找到闲鱼聊天输入框，请先打开对应聊天窗口");
  setReplyInputValue(input, reply);
  suppressUntil = Date.now() + 1800;
  if (command.mode === "send") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const sendButton = findSendButton();
    if (!sendButton) throw new Error("已回填，但没有找到发送按钮");
    sendButton.click();
    suppressUntil = Date.now() + 2500;
  }
  return { ok: true };
}

function scanElement(root) {
  if (!settings.autoSyncEnabled || !root) return;
  const latestCandidates = getMessageCandidates(root, { manual: true });
  if (latestCandidates.length) {
    latestCandidates.slice(0, 1).forEach((candidate) => {
      sendCandidate(candidate.element, candidate.text);
    });
    persistSyncLinkStatus({
      observerRunning: Boolean(observer),
      candidateCount: latestCandidates.length,
      lastError: "",
    });
    return;
  }
  const candidates = [];
  if (root.nodeType === Node.ELEMENT_NODE) {
    const element = root;
    if (MESSAGE_SELECTORS.some((selector) => element.matches?.(selector))) candidates.push(element);
    MESSAGE_SELECTORS.forEach((selector) => {
      element.querySelectorAll?.(selector).forEach((item) => candidates.push(item));
    });
  }

  candidates
    .filter((element, index, list) => list.indexOf(element) === index)
    .forEach((element) => {
      if (!isLikelyMessageBubble(element)) return;
      const text = textFromElement(element);
      if (!text || text.length > 800) return;
      const lines = text.split("\n").map(cleanText).filter(Boolean);
      const messageText = lines.length > 1 ? lines[lines.length - 1] : text;
      sendCandidate(element, messageText);
    });
  persistSyncLinkStatus({
    observerRunning: Boolean(observer),
    candidateCount: candidates.length,
    lastError: candidates.length ? "" : "页面变化已检测，但未找到消息气泡候选",
  });
}

function scheduleScan(root = document.body) {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanElement(root), 500);
}

function handleLocationChange() {
  if (location.href === lastUrl) return false;
  lastUrl = location.href;
  sentFingerprints.clear();
  suppressUntil = Date.now() + 1800;
  window.setTimeout(() => scheduleScan(document.body), 800);
  return true;
}

function startObserver() {
  if (observer) observer.disconnect();
  if (!settings.autoSyncEnabled) {
    observer = null;
    persistSyncLinkStatus({ observerRunning: false, lastError: "自动同步未开启" });
    return;
  }
  lastUrl = location.href;
  suppressUntil = Date.now() + 1200;
  observer = new MutationObserver((mutations) => {
    handleLocationChange();
    persistSyncLinkStatus({
      observerRunning: true,
      lastDomChangeAt: new Date().toISOString(),
      mutationCount: mutations.length,
    });
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => scheduleScan(node));
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  persistSyncLinkStatus({ observerRunning: true, lastError: "" });
  scheduleScan(document.body);
  postPageHeartbeat();
}

async function loadSettings() {
  const [syncedSaved, localSaved] = await Promise.all([
    chrome.storage.sync.get(AUTO_SYNC_SETTINGS),
    chrome.storage.local.get(AUTO_SYNC_SETTINGS),
  ]);
  settings = { ...AUTO_SYNC_SETTINGS, ...syncedSaved, ...localSaved };
  await loadRememberedFingerprints();
  startObserver();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" && areaName !== "local") return;
  for (const [key, change] of Object.entries(changes)) {
    if (!(key in AUTO_SYNC_SETTINGS)) continue;
    settings[key] = change.newValue;
  }
  startObserver();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AICS_PAGE_DIAGNOSTICS") {
    try {
      sendResponse(getPageDiagnostics());
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "页面诊断失败" });
    }
    return false;
  }
  if (message?.type === "AICS_CAPTURE_LATEST_MESSAGE") {
    try {
      sendResponse({ ok: true, payload: getLatestMessagePayload() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "同步当前页最新消息失败" });
    }
    return false;
  }
  if (message?.type !== "AICS_OUTBOUND_REPLY") return false;
  executeOutboundReply(message.command || {})
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "发送回闲鱼失败" }));
  return true;
});

loadSettings();
window.setInterval(postPageHeartbeat, 20000);
