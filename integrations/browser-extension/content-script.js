const AUTO_SYNC_SETTINGS = {
  autoSyncEnabled: false,
  platform: "闲鱼",
  businessType: "xianyu",
  customerName: "",
  customerFolder: "",
  myNickname: "",
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

let settings = { ...AUTO_SYNC_SETTINGS };
let observer = null;
let scanTimer = null;
let lastUrl = location.href;
let suppressUntil = 0;
const sentFingerprints = new Set();

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

function fingerprint(text, customerName) {
  return [normalizeComparableUrl(location.href), customerName || "", cleanText(text)].join("::").slice(0, 1200);
}

function remember(fingerprintValue) {
  sentFingerprints.add(fingerprintValue);
  if (sentFingerprints.size <= 300) return;
  const first = sentFingerprints.values().next().value;
  sentFingerprints.delete(first);
}

function buildPayload(element, text) {
  const customerName = inferCustomerName(element);
  return {
    text,
    rawMessage: text,
    customerName,
    customerFolder: settings.customerFolder || customerName || "",
    platform: settings.platform || "闲鱼",
    businessType: settings.businessType || "xianyu",
    sourceUrl: location.href,
  };
}

function sendCandidate(element, text) {
  if (!settings.autoSyncEnabled || shouldSkipText(text) || looksOutgoing(element)) return;
  if (Date.now() < suppressUntil) return;
  const payload = buildPayload(element, text);
  const key = fingerprint(payload.rawMessage, payload.customerName);
  if (sentFingerprints.has(key)) return;
  remember(key);
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

function getMessageCandidates(root = document) {
  const candidates = [];
  MESSAGE_SELECTORS.forEach((selector) => {
    root.querySelectorAll(selector).forEach((element) => {
      const text = textFromElement(element);
      if (shouldSkipText(text) || looksOutgoing(element)) return;
      const lines = text.split("\n").map(cleanText).filter(Boolean);
      const messageText = lines.length > 1 ? lines[lines.length - 1] : text;
      if (shouldSkipText(messageText)) return;
      candidates.push({
        element,
        text: messageText,
        rawText: text,
      });
    });
  });
  return candidates.filter((candidate, index, list) => {
    return list.findIndex((item) => item.element === candidate.element || item.text === candidate.text) === index;
  });
}

function getLatestMessagePayload() {
  const candidates = getMessageCandidates(document);
  const latest = candidates[candidates.length - 1];
  if (!latest) throw new Error("没有在当前闲鱼聊天页识别到买家消息");
  return buildPayload(latest.element, latest.text);
}

function getPageDiagnostics() {
  const input = findReplyInput();
  const sendButton = findSendButton();
  const messageCandidates = getMessageCandidates(document);
  const messageTexts = messageCandidates.map((candidate) => candidate.text);
  const uniqueMessages = Array.from(new Set(messageTexts)).slice(-5);
  return {
    ok: true,
    url: location.href,
    host: location.host || "",
    path: `${location.pathname || ""}${location.search || ""}`,
    title: document.title || "",
    readyState: document.readyState || "",
    isXianyuPage: /(^https?:\/\/([^/]+\.)?(goofish\.com|2\.taobao\.com)\/)/i.test(location.href),
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
  };
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
      const text = textFromElement(element);
      if (!text || text.length > 800) return;
      const lines = text.split("\n").map(cleanText).filter(Boolean);
      const messageText = lines.length > 1 ? lines[lines.length - 1] : text;
      sendCandidate(element, messageText);
    });
}

function scheduleScan(root = document.body) {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanElement(root), 300);
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
  if (!settings.autoSyncEnabled) return;
  lastUrl = location.href;
  suppressUntil = Date.now() + 1200;
  observer = new MutationObserver((mutations) => {
    handleLocationChange();
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => scheduleScan(node));
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScan(document.body);
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get(AUTO_SYNC_SETTINGS);
  settings = { ...AUTO_SYNC_SETTINGS, ...saved };
  startObserver();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  for (const [key, change] of Object.entries(changes)) {
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
