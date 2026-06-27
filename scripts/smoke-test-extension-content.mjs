import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scriptPath = path.join(process.cwd(), "integrations/browser-extension/content-script.js");
const source = fs.readFileSync(scriptPath, "utf8");
const pageUrl = "https://www.goofish.com/im/chat?peer=buyer-001";

class FakeElement {
  constructor(tagName, attrs = {}, text = "", children = []) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attrs).map(([key, value]) => [key.toLowerCase(), String(value)]));
    this.className = this.attributes.get("class") || "";
    this.id = this.attributes.get("id") || "";
    this.innerText = text;
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.previousElementSibling = null;
    this.value = "";
    this.disabled = false;
    this.clicked = false;
    this.events = [];
    this.ownerDocument = null;
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    const previous = this.children[this.children.length - 1] || null;
    child.parentElement = this;
    child.previousElementSibling = previous;
    if (this.ownerDocument) assignOwnerDocument(child, this.ownerDocument);
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  matches(selector) {
    return splitSelectors(selector).some((part) => matchesSimpleSelector(this, part));
  }

  querySelectorAll(selector) {
    const results = [];
    walk(this, (element) => {
      if (element !== this && element.matches(selector)) results.push(element);
    });
    return results;
  }

  getBoundingClientRect() {
    return {
      width: this.getAttribute("data-hidden") === "true" ? 0 : 120,
      height: this.getAttribute("data-hidden") === "true" ? 0 : 24,
      bottom: Number(this.getAttribute("data-bottom") || 100),
    };
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  click() {
    this.clicked = true;
  }
}

class FakeDocument {
  constructor(title, body) {
    this.title = title;
    this.body = body;
    this.activeElement = body;
    this.readyState = "complete";
    assignOwnerDocument(body, this);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function splitSelectors(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesSimpleSelector(element, selector) {
  const tagAndAttr = selector.match(/^([a-z]+)?\[([^=\]*]+)([*]?=)?["']?([^"'\]]*)["']?\]$/i);
  if (tagAndAttr) {
    const [, tag, attrName, operator, expected] = tagAndAttr;
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    return matchesAttribute(element, attrName, operator, expected);
  }

  const attrOnly = selector.match(/^\[([^=\]*]+)([*]?=)?["']?([^"'\]]*)["']?\]$/);
  if (attrOnly) {
    const [, attrName, operator, expected] = attrOnly;
    return matchesAttribute(element, attrName, operator, expected);
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function matchesAttribute(element, attrName, operator, expected) {
  const value = attrName.toLowerCase() === "class"
    ? element.className
    : element.getAttribute(attrName);
  if (operator === "*=") return String(value || "").includes(expected);
  if (operator === "=") return String(value || "") === expected;
  return value !== null && value !== undefined;
}

function walk(element, visit) {
  visit(element);
  element.children.forEach((child) => walk(child, visit));
}

function assignOwnerDocument(element, document) {
  element.ownerDocument = document;
  element.children.forEach((child) => assignOwnerDocument(child, document));
}

function createFixtureDocument() {
  const latestBuyerMessage = new FakeElement("div", { class: "bubble buyer", "data-name": "买家阿明" }, "可以包邮吗？");
  const body = new FakeElement("main", {}, "", [
    new FakeElement("section", { class: "conversation-panel" }, "", [
      new FakeElement("div", { class: "message buyer", "data-name": "买家阿明" }, "今天\n这个还在吗？"),
      new FakeElement("div", { class: "message self", "data-role": "self" }, "在的"),
      latestBuyerMessage,
      new FakeElement("textarea", { class: "reply-input", "data-bottom": "900" }),
      new FakeElement("button", {}, "发送"),
    ]),
  ]);
  return new FakeDocument("买家阿明 - 闲鱼聊天", body);
}

function createSandbox(document, options = {}) {
  let messageListener = null;
  let storageChangeListener = null;
  let mutationObserverCallback = null;
  const runtimeMessages = [];
  const timerQueue = [];
  let now = 1000;
  const immediateTimers = options.immediateTimers !== false;
  const timeout = (callback) => {
    if (immediateTimers) queueMicrotask(callback);
    else timerQueue.push(callback);
    return 1;
  };

  const sandbox = {
    console,
    document,
    location: new URL(pageUrl),
    Date: { now: () => now },
    Node: { ELEMENT_NODE: 1 },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    InputEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.inputType = init.inputType;
        this.data = init.data;
      }
    },
    MutationObserver: class {
      constructor(callback) {
        mutationObserverCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
    setTimeout: timeout,
    clearTimeout() {},
    window: {
      setTimeout: timeout,
      clearTimeout() {},
      getComputedStyle() {
        return { visibility: "visible", display: "block" };
      },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          runtimeMessages.push(message);
          return Promise.resolve({ ok: true });
        },
      },
      storage: {
        sync: {
          async get(defaults) {
            return { ...defaults, ...(options.savedSettings || {}) };
          },
        },
        onChanged: {
          addListener(listener) {
            storageChangeListener = listener;
          },
        },
      },
    },
  };

  return {
    sandbox,
    runtimeMessages,
    advanceTime(ms) {
      now += ms;
    },
    flushTimers() {
      while (timerQueue.length) {
        const callback = timerQueue.shift();
        callback();
      }
    },
    triggerMutation(node) {
      if (!mutationObserverCallback) throw new Error("MutationObserver callback was not registered");
      mutationObserverCallback([{ addedNodes: [node] }]);
    },
    triggerStorageChange(changes) {
      if (!storageChangeListener) throw new Error("storage change listener was not registered");
      storageChangeListener(changes, "sync");
    },
    getMessageListener() {
      return messageListener;
    },
  };
}

async function sendContentMessage(listener, message) {
  return await new Promise((resolve) => {
    const returned = listener(message, {}, resolve);
    if (returned === false) return;
  });
}

function findFirst(root, predicate) {
  let match = null;
  walk(root, (element) => {
    if (!match && predicate(element)) match = element;
  });
  return match;
}

async function waitForAsyncSetup() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const document = createFixtureDocument();
const harness = createSandbox(document);
vm.runInNewContext(source, harness.sandbox, { filename: scriptPath });

const listener = harness.getMessageListener();
assert.equal(typeof listener, "function", "content script should register a message listener");

const diagnostics = await sendContentMessage(listener, { type: "AICS_PAGE_DIAGNOSTICS" });
assert.equal(diagnostics.ok, true, "diagnostics should succeed");
assert.equal(diagnostics.isXianyuPage, true, "diagnostics should recognize Goofish/Xianyu URL");
assert.equal(diagnostics.hasReplyInput, true, "diagnostics should find reply input");
assert.equal(diagnostics.hasSendButton, true, "diagnostics should find send button");
assert.ok(diagnostics.recentMessages.includes("可以包邮吗？"), "diagnostics should include latest buyer message");
assert.equal(diagnostics.host, "www.goofish.com", "diagnostics should include host");
assert.equal(diagnostics.readyState, "complete", "diagnostics should include page ready state");
assert.ok(diagnostics.messageSelectorCounts.some((item) => item.selector.includes("message") && item.count >= 2), "diagnostics should include selector counts");
assert.ok(diagnostics.replyInputCandidates.some((item) => item.element.includes("textarea")), "diagnostics should include reply input candidates");
assert.ok(diagnostics.sendButtonCandidates.some((item) => item.text === "发送"), "diagnostics should include send button candidates");

const capture = await sendContentMessage(listener, { type: "AICS_CAPTURE_LATEST_MESSAGE" });
assert.equal(capture.ok, true, "manual latest-message capture should succeed");
assert.equal(capture.payload.rawMessage, "可以包邮吗？");
assert.equal(capture.payload.customerName, "买家阿明");
assert.equal(capture.payload.platform, "闲鱼");
assert.equal(capture.payload.sourceUrl, pageUrl);

const input = findFirst(document.body, (element) => element.tagName === "TEXTAREA");
const sendButton = findFirst(document.body, (element) => element.tagName === "BUTTON");

const fillResult = await sendContentMessage(listener, {
  type: "AICS_OUTBOUND_REPLY",
  command: {
    sourceUrl: `${pageUrl}#ignored-hash`,
    reply: "您好，可以包邮。",
    mode: "fill",
  },
});
assert.equal(fillResult.ok, true, "outbound fill should succeed");
assert.equal(input.value, "您好，可以包邮。");
assert.deepEqual(input.events.slice(-2), ["input", "change"], "fill should dispatch input/change events");
assert.equal(sendButton.clicked, false, "fill mode should not click send");

input.value = "";
const mismatchResult = await sendContentMessage(listener, {
  type: "AICS_OUTBOUND_REPLY",
  command: {
    sourceUrl: "https://www.goofish.com/im/chat?peer=wrong-buyer",
    reply: "这条不应该填入",
    mode: "fill",
  },
});
assert.equal(mismatchResult.ok, false, "URL mismatch should be rejected");
assert.equal(input.value, "", "URL mismatch should not modify input");

const sendResult = await sendContentMessage(listener, {
  type: "AICS_OUTBOUND_REPLY",
  command: {
    sourceUrl: pageUrl,
    reply: "我这边帮您确认一下。",
    mode: "send",
  },
});
assert.equal(sendResult.ok, true, "send mode should succeed");
assert.equal(input.value, "我这边帮您确认一下。");
assert.equal(sendButton.clicked, true, "send mode should click send button");

const autoDocument = createFixtureDocument();
const autoHarness = createSandbox(autoDocument, {
  immediateTimers: false,
  savedSettings: {
    autoSyncEnabled: true,
    platform: "闲鱼",
    businessType: "xianyu",
  },
});
vm.runInNewContext(source, autoHarness.sandbox, { filename: `${scriptPath}?auto-sync` });
await waitForAsyncSetup();
autoHarness.flushTimers();
assert.equal(autoHarness.runtimeMessages.length, 0, "initial historical messages should not auto-sync during suppression window");

autoHarness.advanceTime(1300);
const conversationPanel = findFirst(autoDocument.body, (element) => element.getAttribute("class") === "conversation-panel");
const autoBuyerMessage = new FakeElement("div", { class: "message buyer", "data-name": "买家阿明" }, "这条新消息要自动同步");
conversationPanel.appendChild(autoBuyerMessage);
autoHarness.triggerMutation(autoBuyerMessage);
autoHarness.flushTimers();
await Promise.resolve();

const autoInboxMessages = autoHarness.runtimeMessages.filter((message) => message.type === "AICS_AUTO_INBOX_MESSAGE");
assert.equal(autoInboxMessages.length, 1, "new buyer message should auto-sync once");
assert.equal(autoInboxMessages[0].payload.rawMessage, "这条新消息要自动同步");
assert.equal(autoInboxMessages[0].payload.customerName, "买家阿明");
assert.equal(autoInboxMessages[0].payload.platform, "闲鱼");
assert.equal(autoInboxMessages[0].payload.sourceUrl, pageUrl);

autoHarness.triggerMutation(autoBuyerMessage);
autoHarness.flushTimers();
await Promise.resolve();
assert.equal(autoHarness.runtimeMessages.filter((message) => message.type === "AICS_AUTO_INBOX_MESSAGE").length, 1, "duplicate scans should not auto-sync the same buyer message twice");

autoHarness.sandbox.location.href = "https://www.goofish.com/im/chat?peer=buyer-002";
autoHarness.triggerMutation(conversationPanel);
autoHarness.flushTimers();
await Promise.resolve();
autoHarness.advanceTime(1900);
const switchedBuyerMessage = new FakeElement("div", { class: "message buyer", "data-name": "买家阿明" }, "这条新消息要自动同步");
conversationPanel.appendChild(switchedBuyerMessage);
autoHarness.triggerMutation(switchedBuyerMessage);
autoHarness.flushTimers();
await Promise.resolve();
const afterSwitchMessages = autoHarness.runtimeMessages.filter((message) => message.type === "AICS_AUTO_INBOX_MESSAGE");
assert.equal(afterSwitchMessages.length, 2, "same text in a different Xianyu chat should sync after route change");
assert.equal(afterSwitchMessages[1].payload.sourceUrl, "https://www.goofish.com/im/chat?peer=buyer-002");

const autoListener = autoHarness.getMessageListener();
const autoInput = findFirst(autoDocument.body, (element) => element.tagName === "TEXTAREA");
const autoSendButton = findFirst(autoDocument.body, (element) => element.tagName === "BUTTON");
const outboundDuringAutoSyncPromise = new Promise((resolve) => {
  const returned = autoListener({
    type: "AICS_OUTBOUND_REPLY",
    command: {
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-002",
      reply: "这条是商家回复，不应该同步成客户消息",
      mode: "send",
    },
  }, {}, resolve);
  assert.equal(returned, true, "send mode should use async response path");
});
autoHarness.flushTimers();
const outboundDuringAutoSync = await outboundDuringAutoSyncPromise;
assert.equal(outboundDuringAutoSync.ok, true, "outbound reply should still work while auto-sync is enabled");
assert.equal(autoInput.value, "这条是商家回复，不应该同步成客户消息");
assert.equal(autoSendButton.clicked, true, "outbound send should click send in auto-sync harness");

const sellerEcho = new FakeElement("div", { class: "message buyer", "data-name": "买家阿明" }, "这条是商家回复，不应该同步成客户消息");
conversationPanel.appendChild(sellerEcho);
autoHarness.triggerMutation(sellerEcho);
autoHarness.flushTimers();
await Promise.resolve();
assert.equal(autoHarness.runtimeMessages.filter((message) => message.type === "AICS_AUTO_INBOX_MESSAGE").length, 2, "outbound reply echo should be suppressed from auto-sync");

autoHarness.advanceTime(2600);
const nextBuyerMessage = new FakeElement("div", { class: "message buyer", "data-name": "买家阿明" }, "抑制结束后的真正新消息");
conversationPanel.appendChild(nextBuyerMessage);
autoHarness.triggerMutation(nextBuyerMessage);
autoHarness.flushTimers();
await Promise.resolve();
const afterSuppressMessages = autoHarness.runtimeMessages.filter((message) => message.type === "AICS_AUTO_INBOX_MESSAGE");
assert.equal(afterSuppressMessages.length, 3, "new buyer message should sync after outbound suppression window");
assert.equal(afterSuppressMessages[2].payload.rawMessage, "抑制结束后的真正新消息");

console.log("[extension-content-smoke] diagnostics ok");
console.log("[extension-content-smoke] latest-message capture ok");
console.log("[extension-content-smoke] auto inbox sync ok");
console.log("[extension-content-smoke] outbound fill ok");
console.log("[extension-content-smoke] URL mismatch guard ok");
console.log("[extension-content-smoke] outbound send click ok");
console.log("[extension-content-smoke] outbound auto-sync suppression ok");
console.log("[extension-content-smoke] PASS");
