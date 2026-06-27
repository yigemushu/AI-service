import type { BrowserPluginStatus, CustomerMessage, Order, OutboundReplyCommand } from "./types";

export type DiagnosticItem = {
  label: string;
  ok: boolean;
  detail: string;
};

export type AcceptanceItem = {
  label: string;
  ok: boolean;
  detail: string;
};

const outboundStatusLabels: Record<string, string> = {
  pending: "待插件处理",
  processing: "插件处理中",
  filled: "已回填输入框",
  sent: "已发送",
  failed: "发送失败",
  cancelled: "已取消",
};

export function isXianyuSource(value: string | undefined | null) {
  return /goofish|2\.taobao|闲鱼|咸鱼/i.test(String(value || ""));
}

function timestamp(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function happenedAfter(value: string | undefined, baseline: string | undefined) {
  const valueTime = timestamp(value);
  const baselineTime = timestamp(baseline);
  return valueTime > 0 && baselineTime > 0 && valueTime >= baselineTime;
}

function configOutboundMode(status: BrowserPluginStatus | undefined) {
  const value = `${status?.action || ""} ${status?.mode || ""}`;
  if (/代点击发送|send|已点击发送/.test(value)) return "send";
  if (/只回填输入框|fill|已填入输入框/.test(value)) return "fill";
  return "";
}

export function normalizePlatformUrl(value: string | undefined | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return raw.split("#")[0];
  }
}

export function isXianyuMessage(message: Pick<CustomerMessage, "platform" | "sourceUrl" | "sourceChannel">) {
  return message.platform === "闲鱼" || isXianyuSource(`${message.sourceUrl} ${message.sourceChannel || ""}`);
}

export function isXianyuOrder(order: Pick<Order, "platform" | "sourceUrl">) {
  return order.platform === "闲鱼" || isXianyuSource(order.sourceUrl || "");
}

export function isXianyuCommand(command: Pick<OutboundReplyCommand, "platform" | "sourceUrl">) {
  return command.platform === "闲鱼" || isXianyuSource(command.sourceUrl || "");
}

export function isXianyuPluginStatus(status: Pick<BrowserPluginStatus, "platform" | "sourceUrl">) {
  return status.platform === "闲鱼" || isXianyuSource(status.sourceUrl || "");
}

function extractLine(text: string, label: string) {
  const line = text.split(/\r?\n/).find((item) => item.trim().startsWith(label));
  return line?.replace(label, "").replace(/^[:：]\s*/, "").trim() || "";
}

function parseNumberFromLine(text: string, label: string) {
  const value = extractLine(text, label);
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function analyzeXianyuDiagnostics(text: string): DiagnosticItem[] {
  const value = text.trim();
  if (!value) return [];
  const isXianyu = /是否闲鱼页面[:：]\s*是|闲鱼页面已识别/.test(value);
  const hasInput = /聊天输入框[:：]\s*已找到|输入框[:：]\s*已找到/.test(value);
  const hasSendButton = /发送按钮[:：]\s*已找到|发送按钮[:：]\s*已找到/.test(value);
  const messageCount = parseNumberFromLine(value, "消息候选数量") || parseNumberFromLine(value, "消息候选");
  const selectorHit = /消息选择器命中[:：][\s\S]*-\s.*:\s*[1-9]\d*|选择器命中[:：].*=\s*[1-9]\d*/.test(value);
  const inputCandidates = extractLine(value, "输入框候选");
  const buttonCandidates = extractLine(value, "发送按钮候选") || extractLine(value, "按钮候选");

  return [
    { label: "闲鱼页面", ok: isXianyu, detail: isXianyu ? "已识别为闲鱼页面" : "没有识别到闲鱼页面标记" },
    { label: "聊天输入框", ok: hasInput, detail: hasInput ? "已找到可回填输入框" : inputCandidates || "没有找到输入框" },
    { label: "发送按钮", ok: hasSendButton, detail: hasSendButton ? "已找到发送按钮" : buttonCandidates || "没有找到发送按钮；只回填模式仍可继续测" },
    { label: "买家消息候选", ok: messageCount > 0, detail: messageCount > 0 ? `${messageCount} 条候选消息` : "没有识别到消息候选" },
    { label: "选择器命中", ok: selectorHit, detail: selectorHit ? "页面结构有可用消息选择器命中" : "没有明显选择器命中，可能需要适配页面结构" },
  ];
}

export function isDiagnosticReady(items: DiagnosticItem[]) {
  return items.length > 0 && items.filter((item) => item.ok).length >= 4;
}

export function buildXianyuTestEvidenceItems(input: {
  testCode?: string;
  messages: CustomerMessage[];
  orders: Order[];
  commands: OutboundReplyCommand[];
  pluginStatuses?: BrowserPluginStatus[];
}): AcceptanceItem[] {
  const testCode = String(input.testCode || "").trim();
  const xianyuMessages = input.messages.filter(isXianyuMessage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const xianyuOrders = input.orders.filter(isXianyuOrder).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const xianyuCommands = input.commands.filter(isXianyuCommand).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const xianyuPluginStatuses = (input.pluginStatuses || []).filter(isXianyuPluginStatus).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const readyConfigStatus = xianyuPluginStatuses.find((status) => status.kind === "config" && status.ok);
  const requiresSendClick = configOutboundMode(readyConfigStatus) === "send";
  const trackedMessage = testCode ? xianyuMessages.find((message) => (message.rawMessage || "").includes(testCode)) : undefined;
  const trackedUrl = normalizePlatformUrl(trackedMessage?.sourceUrl);
  const trackedAutoSyncStatus = trackedMessage
    ? xianyuPluginStatuses.find((status) => (
      status.kind === "autoSync"
      && status.ok
      && (
        status.messageId === trackedMessage.id
        || (trackedUrl && normalizePlatformUrl(status.sourceUrl) === trackedUrl && happenedAfter(status.updatedAt, trackedMessage.createdAt))
      )
    ))
    : undefined;
  const trackedCommand = trackedMessage
    ? xianyuCommands.find((command) => (
      command.reply.trim()
      && (
        command.messageId === trackedMessage.id
        || (trackedUrl && normalizePlatformUrl(command.sourceUrl) === trackedUrl && happenedAfter(command.createdAt, trackedMessage.createdAt))
      )
    ))
    : undefined;
  const trackedOutboundStatus = trackedCommand
    ? xianyuPluginStatuses.find((status) => (
      status.kind === "outbound"
      && status.ok
      && (
        status.commandId === trackedCommand.id
        || (trackedUrl && normalizePlatformUrl(status.sourceUrl) === trackedUrl && happenedAfter(status.updatedAt, trackedCommand.createdAt))
      )
    ))
    : undefined;
  const trackedCommandSynced = trackedCommand
    ? requiresSendClick
      ? trackedCommand.status === "sent"
      : trackedCommand.status === "filled" || trackedCommand.status === "sent"
    : false;
  const trackedOutboundSynced = trackedOutboundStatus
    ? requiresSendClick
      ? configOutboundMode(trackedOutboundStatus) === "send"
      : true
    : false;
  const trackedOrder = trackedMessage || trackedCommand
    ? xianyuOrders.find((order) => (
      Boolean(trackedMessage?.linkedOrderId && order.id === trackedMessage.linkedOrderId)
      || Boolean(trackedCommand?.orderId && order.id === trackedCommand.orderId)
      || Boolean(trackedUrl && normalizePlatformUrl(order.sourceUrl) === trackedUrl && happenedAfter(order.updatedAt, trackedMessage?.createdAt))
    ))
    : undefined;

  return [
    {
      label: "测试码消息进入工作台",
      ok: Boolean(trackedMessage),
      detail: trackedMessage ? `${trackedMessage.customerFolder || trackedMessage.customerName || "待识别客户"} / ${trackedMessage.rawMessage.slice(0, 80)}` : "还没有看到带本次测试码的闲鱼消息",
    },
    {
      label: "自动同步匹配同一链接",
      ok: Boolean(trackedAutoSyncStatus),
      detail: trackedAutoSyncStatus
        ? trackedAutoSyncStatus.messageId === trackedMessage?.id ? "插件自动同步状态已匹配本次消息 ID" : trackedAutoSyncStatus.action || "插件自动同步成功"
        : trackedUrl ? "还缺本次消息 ID 或同链接同时间段的自动同步状态" : "等待测试码消息的原平台链接",
    },
    {
      label: "本次回复任务已创建",
      ok: Boolean(trackedCommand),
      detail: trackedCommand
        ? `${trackedCommand.messageId === trackedMessage?.id ? "已匹配本次消息 ID" : "已匹配同链接同时间段"} / ${outboundStatusLabels[trackedCommand.status] || trackedCommand.status} / ${trackedCommand.reply.slice(0, 80)}`
        : "还没有看到本次消息对应的回闲鱼任务",
    },
    {
      label: "本次回复已同步回闲鱼",
      ok: Boolean(trackedCommandSynced || trackedOutboundSynced),
      detail: trackedCommandSynced && trackedCommand
        ? outboundStatusLabels[trackedCommand.status] || trackedCommand.status
        : trackedOutboundSynced && trackedOutboundStatus
          ? trackedOutboundStatus.action || "插件显示已同步"
          : requiresSendClick
            ? "当前是代点击发送模式，还没有看到本次任务已发送或插件已点击发送"
            : "还没有看到同一链接的回填/发送成功状态",
    },
    {
      label: "本次客户与订单已沉淀",
      ok: Boolean(trackedOrder),
      detail: trackedOrder ? `${trackedOrder.orderTitle || trackedOrder.customerFolder || trackedOrder.customerName} / ${trackedOrder.status}` : "还没有看到同一链接的客户或订单记录",
    },
  ];
}

export function buildXianyuAcceptanceItems(input: {
  diagnosticReady: boolean;
  messages: CustomerMessage[];
  orders: Order[];
  commands: OutboundReplyCommand[];
  pluginStatuses?: BrowserPluginStatus[];
}): AcceptanceItem[] {
  const xianyuMessages = input.messages.filter(isXianyuMessage);
  const messagesWithSourceUrl = xianyuMessages.filter((message) => Boolean(message.sourceUrl));
  const messagesWithGeneratedReply = xianyuMessages.filter((message) => Boolean(message.analysis?.reply?.trim()));
  const ordersWithGeneratedReply = input.orders.filter((order) => isXianyuOrder(order) && Boolean(order.analysis?.reply?.trim()));
  const xianyuCommands = input.commands.filter(isXianyuCommand);
  const xianyuPluginStatuses = (input.pluginStatuses || []).filter(isXianyuPluginStatus);
  const readyConfigStatuses = xianyuPluginStatuses.filter((status) => status.kind === "config" && status.ok);
  const successfulAutoSyncStatuses = xianyuPluginStatuses.filter((status) => status.kind === "autoSync" && status.ok && status.action !== "手动同步");
  const commandsWithReply = xianyuCommands.filter((command) => command.reply.trim());
  const successfulCommands = xianyuCommands.filter((command) => command.status === "filled" || command.status === "sent");
  const successfulPluginOutboundStatuses = xianyuPluginStatuses.filter((status) => status.kind === "outbound" && status.ok);
  const xianyuOrders = input.orders.filter(isXianyuOrder);
  const ordersWithSourceUrl = xianyuOrders.filter((order) => Boolean(order.sourceUrl));
  const generatedReplyCount = messagesWithGeneratedReply.length + ordersWithGeneratedReply.length;
  const messageUrls = new Set(messagesWithSourceUrl.map((message) => normalizePlatformUrl(message.sourceUrl)).filter(Boolean));
  const autoSyncUrls = new Set(successfulAutoSyncStatuses.map((status) => normalizePlatformUrl(status.sourceUrl)).filter(Boolean));
  const autoMessageUrls = [...messageUrls].filter((url) => autoSyncUrls.has(url));
  const replyUrls = new Set([
    ...messagesWithGeneratedReply.map((message) => normalizePlatformUrl(message.sourceUrl)),
    ...ordersWithGeneratedReply.map((order) => normalizePlatformUrl(order.sourceUrl)),
    ...commandsWithReply.map((command) => normalizePlatformUrl(command.sourceUrl)),
  ].filter(Boolean));
  const confirmationUrls = new Set(commandsWithReply.map((command) => normalizePlatformUrl(command.sourceUrl)).filter(Boolean));
  const syncUrls = new Set([
    ...successfulCommands.map((command) => normalizePlatformUrl(command.sourceUrl)),
    ...successfulPluginOutboundStatuses.map((status) => normalizePlatformUrl(status.sourceUrl)),
  ].filter(Boolean));
  const orderUrls = new Set(ordersWithSourceUrl.map((order) => normalizePlatformUrl(order.sourceUrl)).filter(Boolean));
  const closedLoopUrls = autoMessageUrls.filter((url) => replyUrls.has(url) && confirmationUrls.has(url) && syncUrls.has(url) && orderUrls.has(url));

  return [
    {
      label: "真实闲鱼页面可识别",
      ok: input.diagnosticReady,
      detail: input.diagnosticReady ? "插件诊断已满足继续实机测试的条件" : "请先粘贴通过的插件诊断结果",
    },
    {
      label: "插件配置已就绪",
      ok: readyConfigStatuses.length > 0,
      detail: readyConfigStatuses.length > 0
        ? readyConfigStatuses[0].action || "自动同步和回闲鱼开关已开启"
        : "请先在插件里开启自动同步和回闲鱼，并保存配置",
    },
    {
      label: "闲鱼新消息进入工作台",
      ok: autoMessageUrls.length > 0,
      detail: autoMessageUrls.length > 0
        ? `${messagesWithSourceUrl.length} 条闲鱼消息带原平台链接，且插件自动同步成功`
        : messagesWithSourceUrl.length > 0
          ? "已有闲鱼消息，但还缺插件自动同步成功状态；手动同步只能作为兜底"
          : "还没有看到带原平台链接的闲鱼消息",
    },
    {
      label: "工作台已生成可发送回复",
      ok: generatedReplyCount > 0 || commandsWithReply.length > 0,
      detail: generatedReplyCount > 0
        ? `${generatedReplyCount} 条闲鱼客户/订单记录带 AI 回复`
        : commandsWithReply.length > 0
          ? `${commandsWithReply.length} 个回闲鱼任务包含回复内容`
          : "还没有看到 AI 回复或可发送回复内容",
    },
    {
      label: "商家已在工作台确认发送",
      ok: commandsWithReply.length > 0,
      detail: commandsWithReply.length > 0 ? `${commandsWithReply.length} 个回闲鱼任务已创建` : "还没有看到商家确认后创建的回闲鱼任务",
    },
    {
      label: "插件已同步回闲鱼",
      ok: successfulCommands.length > 0 || successfulPluginOutboundStatuses.length > 0,
      detail: successfulCommands.length > 0
        ? `${successfulCommands.length} 个任务已回填或已发送`
        : successfulPluginOutboundStatuses.length > 0
          ? `${successfulPluginOutboundStatuses.length} 条插件回写状态显示已同步`
          : "还没有已回填/已发送的任务或插件成功状态",
    },
    {
      label: "客户与订单记录已沉淀",
      ok: xianyuOrders.length > 0 && ordersWithSourceUrl.length > 0,
      detail: xianyuOrders.length > 0 && ordersWithSourceUrl.length > 0
        ? `${ordersWithSourceUrl.length} 条闲鱼订单/客户记录保留原平台链接`
        : "还没有带原平台链接的闲鱼订单或客户沉淀记录",
    },
    {
      label: "同一闲鱼链接完成闭环",
      ok: closedLoopUrls.length > 0,
      detail: closedLoopUrls.length > 0 ? `已串联 ${closedLoopUrls[0]}` : "消息、回复、发送任务、同步结果和订单还没有落到同一个闲鱼链接",
    },
  ];
}

export function isXianyuMvpAccepted(items: AcceptanceItem[]) {
  return items.length > 0 && items.every((item) => item.ok);
}
