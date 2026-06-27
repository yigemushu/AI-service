import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = path.join(process.cwd(), "lib/xianyuMvpValidation.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
});

const sandbox = {
  exports: {},
  module: { exports: {} },
  require(specifier) {
    if (specifier === "./types") return {};
    throw new Error(`Unexpected require: ${specifier}`);
  },
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });

const {
  analyzeXianyuDiagnostics,
  buildXianyuAcceptanceItems,
  buildXianyuTestEvidenceItems,
  isDiagnosticReady,
  isXianyuCommand,
  isXianyuMvpAccepted,
  isXianyuMessage,
  isXianyuOrder,
  isXianyuPluginStatus,
  normalizePlatformUrl,
} = sandbox.module.exports;

const successfulDiagnostics = [
  "闲鱼页面诊断结果",
  "URL：https://www.goofish.com/im/chat?peer=buyer-001",
  "是否闲鱼页面：是",
  "聊天输入框：已找到 textarea.reply-input",
  "发送按钮：已找到 button",
  "消息候选数量：3",
  "消息选择器命中：",
  "- [class*=\"message\"]: 4",
  "输入框候选：",
  "- textarea.reply-input",
  "发送按钮候选：",
  "- button 发送",
].join("\n");

const successfulItems = analyzeXianyuDiagnostics(successfulDiagnostics);
assert.equal(successfulItems.length, 5, "should produce five diagnostic checks");
assert.equal(isDiagnosticReady(successfulItems), true, "successful diagnostics should be ready for real-page testing");
assert.equal(successfulItems.every((item) => item.ok), true, "all successful diagnostics checks should pass");

const partialDiagnostics = [
  "闲鱼页面诊断结果",
  "是否闲鱼页面：是",
  "聊天输入框：未找到",
  "发送按钮：未找到",
  "消息候选数量：0",
  "消息选择器命中：",
  "无",
].join("\n");
const partialItems = analyzeXianyuDiagnostics(partialDiagnostics);
assert.equal(isDiagnosticReady(partialItems), false, "missing input and message candidates should block real-page testing");
assert.equal(partialItems.find((item) => item.label === "闲鱼页面")?.ok, true);
assert.equal(partialItems.find((item) => item.label === "聊天输入框")?.ok, false);
assert.equal(partialItems.find((item) => item.label === "买家消息候选")?.ok, false);

assert.equal(isXianyuMessage({ platform: "闲鱼", sourceUrl: "", sourceChannel: "浏览器插件" }), true);
assert.equal(isXianyuMessage({ platform: "其他", sourceUrl: "https://www.goofish.com/im/chat?peer=1", sourceChannel: "" }), true);
assert.equal(isXianyuMessage({ platform: "Facebook", sourceUrl: "https://facebook.com/messages", sourceChannel: "" }), false);
assert.equal(isXianyuOrder({ platform: "闲鱼", sourceUrl: "" }), true);
assert.equal(isXianyuOrder({ platform: "其他", sourceUrl: "https://2.taobao.com/item.htm?id=1" }), true);
assert.equal(isXianyuOrder({ platform: "微信", sourceUrl: "https://example.com/order" }), false);
assert.equal(isXianyuCommand({ platform: "闲鱼", sourceUrl: "" }), true);
assert.equal(isXianyuCommand({ platform: "其他", sourceUrl: "https://www.goofish.com/im/chat?peer=1" }), true);
assert.equal(isXianyuCommand({ platform: "Facebook", sourceUrl: "https://facebook.com/messages/t/1" }), false);
assert.equal(isXianyuPluginStatus({ platform: "闲鱼", sourceUrl: "" }), true);
assert.equal(isXianyuPluginStatus({ platform: "其他", sourceUrl: "https://www.goofish.com/im/chat?peer=1" }), true);
assert.equal(isXianyuPluginStatus({ platform: "Facebook", sourceUrl: "https://facebook.com/messages/t/1" }), false);
assert.equal(normalizePlatformUrl("https://www.goofish.com/im/chat?peer=1#latest"), "https://www.goofish.com/im/chat?peer=1");

function readyConfigStatus(sourceUrl = "https://www.goofish.com/im/chat?peer=buyer-001") {
  return {
    kind: "config",
    ok: true,
    action: "自动同步已开启 / 回闲鱼已开启 / 只回填输入框",
    platform: "闲鱼",
    sourceUrl,
  };
}

const acceptedItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的，我先帮您确认。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      analysis: { reply: "您好，可以的，我先帮您确认。" },
    },
  ],
  commands: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      reply: "您好，可以的，我先帮您确认。",
      status: "filled",
    },
  ],
  pluginStatuses: [
    readyConfigStatus(),
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(acceptedItems.length, 8, "acceptance gate should cover config, the real-page precheck, five MVP requirements, and same-link proof");
assert.equal(isXianyuMvpAccepted(acceptedItems), true, "complete evidence should pass the MVP acceptance gate");

const pluginStatusAcceptedItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的，我先帮您确认。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      analysis: { reply: "您好，可以的，我先帮您确认。" },
    },
  ],
  commands: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      reply: "您好，可以的，我先帮您确认。",
      status: "processing",
    },
  ],
  pluginStatuses: [
    readyConfigStatus(),
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
    {
      kind: "outbound",
      ok: true,
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(pluginStatusAcceptedItems), true, "plugin success status should satisfy sync evidence when linked to the same Xianyu chat");

const manualOnlyItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  commands: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      reply: "您好，可以的。",
      status: "filled",
    },
  ],
  pluginStatuses: [
    readyConfigStatus(),
    {
      kind: "autoSync",
      ok: true,
      action: "手动同步",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(manualOnlyItems), false, "manual latest-message sync should not satisfy automatic inbox evidence");
assert.equal(manualOnlyItems.find((item) => item.label === "闲鱼新消息进入工作台")?.ok, false);

const incompleteItems = buildXianyuAcceptanceItems({
  diagnosticReady: false,
  messages: [],
  orders: [],
  commands: [],
  pluginStatuses: [
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(incompleteItems), false, "missing real-page evidence should not pass the MVP acceptance gate");
assert.equal(incompleteItems.filter((item) => !item.ok).length, 8, "missing evidence should leave every acceptance item pending");

const noConfirmationItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  commands: [],
  pluginStatuses: [
    readyConfigStatus(),
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(noConfirmationItems), false, "generated replies alone should not pass without merchant confirmation and plugin sync");
assert.equal(noConfirmationItems.find((item) => item.label === "工作台已生成可发送回复")?.ok, true);
assert.equal(noConfirmationItems.find((item) => item.label === "商家已在工作台确认发送")?.ok, false);

const wrongPlatformCommandItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  commands: [
    {
      platform: "Facebook",
      sourceUrl: "https://facebook.com/messages/t/1",
      reply: "This should not satisfy Xianyu.",
      status: "sent",
    },
  ],
  pluginStatuses: [
    readyConfigStatus(),
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-001",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(wrongPlatformCommandItems), false, "non-Xianyu outbound tasks should not satisfy Xianyu confirmation or sync");
assert.equal(wrongPlatformCommandItems.find((item) => item.label === "商家已在工作台确认发送")?.ok, false);
assert.equal(wrongPlatformCommandItems.find((item) => item.label === "插件已同步回闲鱼")?.ok, false);

const mismatchedUrlItems = buildXianyuAcceptanceItems({
  diagnosticReady: true,
  messages: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-a",
      sourceChannel: "浏览器插件",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  orders: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-b",
      analysis: { reply: "您好，可以的。" },
    },
  ],
  commands: [
    {
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-c",
      reply: "您好，可以的。",
      status: "filled",
    },
  ],
  pluginStatuses: [
    readyConfigStatus("https://www.goofish.com/im/chat?peer=buyer-a"),
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=buyer-a",
    },
  ],
});
assert.equal(isXianyuMvpAccepted(mismatchedUrlItems), false, "evidence from different Xianyu chats should not pass the closed-loop gate");
assert.equal(mismatchedUrlItems.find((item) => item.label === "同一闲鱼链接完成闭环")?.ok, false);

const trackedMessage = {
  id: "msg_tracked",
  customerName: "测试买家",
  customerFolder: "测试买家",
  platform: "闲鱼",
  sourceChannel: "浏览器插件",
  businessType: "xianyu",
  rawMessage: "实机测试 XY-TEST-OK：还在吗？今天可以发货吗？",
  sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
  status: "已分析",
  isNew: false,
  createdAt: "2026-06-26T10:00:00.000Z",
  updatedAt: "2026-06-26T10:00:10.000Z",
  linkedOrderId: "order_tracked",
};
const trackedEvidenceItems = buildXianyuTestEvidenceItems({
  testCode: "XY-TEST-OK",
  messages: [trackedMessage],
  orders: [
    {
      id: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      customerName: "测试买家",
      customerFolder: "测试买家",
      orderTitle: "测试订单",
      status: "待跟进",
      updatedAt: "2026-06-26T10:03:00.000Z",
    },
  ],
  commands: [
    {
      id: "out_tracked",
      messageId: "msg_tracked",
      orderId: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      reply: "您好，可以发货。",
      status: "filled",
      createdAt: "2026-06-26T10:02:00.000Z",
      updatedAt: "2026-06-26T10:02:30.000Z",
    },
  ],
  pluginStatuses: [
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      messageId: "msg_tracked",
      updatedAt: "2026-06-26T10:00:20.000Z",
    },
    {
      kind: "outbound",
      ok: true,
      action: "已填入输入框",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      commandId: "out_tracked",
      updatedAt: "2026-06-26T10:02:40.000Z",
    },
  ],
});
assert.equal(trackedEvidenceItems.every((item) => item.ok), true, "tracked real-test evidence should pass when message/order/task/status IDs line up");

const staleEvidenceItems = buildXianyuTestEvidenceItems({
  testCode: "XY-TEST-STALE",
  messages: [
    {
      ...trackedMessage,
      id: "msg_new",
      linkedOrderId: "",
      rawMessage: "实机测试 XY-TEST-STALE：还在吗？今天可以发货吗？",
      createdAt: "2026-06-26T11:00:00.000Z",
      updatedAt: "2026-06-26T11:00:10.000Z",
    },
  ],
  orders: [
    {
      id: "order_old",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      customerName: "测试买家",
      status: "待跟进",
      updatedAt: "2026-06-26T10:20:00.000Z",
    },
  ],
  commands: [
    {
      id: "out_old",
      messageId: "msg_old",
      orderId: "order_old",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      reply: "旧回复不应该算本次。",
      status: "filled",
      createdAt: "2026-06-26T10:10:00.000Z",
      updatedAt: "2026-06-26T10:10:30.000Z",
    },
  ],
  pluginStatuses: [
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      messageId: "msg_old",
      updatedAt: "2026-06-26T10:00:20.000Z",
    },
  ],
});
assert.equal(staleEvidenceItems.find((item) => item.label === "测试码消息进入工作台")?.ok, true);
assert.equal(staleEvidenceItems.find((item) => item.label === "本次回复任务已创建")?.ok, false, "old same-link command should not satisfy current test evidence");
assert.equal(staleEvidenceItems.find((item) => item.label === "本次客户与订单已沉淀")?.ok, false, "old same-link order should not satisfy current test evidence");

const sendModeFilledOnlyItems = buildXianyuTestEvidenceItems({
  testCode: "XY-TEST-SEND",
  messages: [
    {
      ...trackedMessage,
      rawMessage: "实机测试 XY-TEST-SEND：还在吗？今天可以发货吗？",
    },
  ],
  orders: [
    {
      id: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      customerName: "测试买家",
      status: "待跟进",
      updatedAt: "2026-06-26T10:03:00.000Z",
    },
  ],
  commands: [
    {
      id: "out_send_mode",
      messageId: "msg_tracked",
      orderId: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      reply: "您好，可以发货。",
      status: "filled",
      createdAt: "2026-06-26T10:02:00.000Z",
      updatedAt: "2026-06-26T10:02:30.000Z",
    },
  ],
  pluginStatuses: [
    {
      kind: "config",
      ok: true,
      action: "自动同步已开启 / 回闲鱼已开启 / 代点击发送",
      platform: "闲鱼",
      updatedAt: "2026-06-26T10:00:00.000Z",
    },
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      messageId: "msg_tracked",
      updatedAt: "2026-06-26T10:00:20.000Z",
    },
  ],
});
assert.equal(sendModeFilledOnlyItems.find((item) => item.label === "本次回复已同步回闲鱼")?.ok, false, "send-click mode should not accept fill-only evidence as complete sync");

const sendModeSentItems = buildXianyuTestEvidenceItems({
  testCode: "XY-TEST-OK",
  messages: [trackedMessage],
  orders: [
    {
      id: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      customerName: "测试买家",
      status: "待跟进",
      updatedAt: "2026-06-26T10:03:00.000Z",
    },
  ],
  commands: [
    {
      id: "out_send_mode_sent",
      messageId: "msg_tracked",
      orderId: "order_tracked",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      reply: "您好，可以发货。",
      status: "sent",
      createdAt: "2026-06-26T10:02:00.000Z",
      updatedAt: "2026-06-26T10:02:30.000Z",
    },
  ],
  pluginStatuses: [
    {
      kind: "config",
      ok: true,
      action: "自动同步已开启 / 回闲鱼已开启 / 代点击发送",
      platform: "闲鱼",
      updatedAt: "2026-06-26T10:00:00.000Z",
    },
    {
      kind: "autoSync",
      ok: true,
      action: "自动监听",
      platform: "闲鱼",
      sourceUrl: "https://www.goofish.com/im/chat?peer=tracked",
      messageId: "msg_tracked",
      updatedAt: "2026-06-26T10:00:20.000Z",
    },
  ],
});
assert.equal(sendModeSentItems.find((item) => item.label === "本次回复已同步回闲鱼")?.ok, true, "send-click mode should accept sent task evidence");

console.log("[xianyu-validation-smoke] diagnostics parser ok");
console.log("[xianyu-validation-smoke] source filters ok");
console.log("[xianyu-validation-smoke] acceptance gate ok");
console.log("[xianyu-validation-smoke] tracked test evidence ok");
console.log("[xianyu-validation-smoke] PASS");
