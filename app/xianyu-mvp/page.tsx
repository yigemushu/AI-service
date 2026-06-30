"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Section } from "@/components/Section";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { createId, getWebhookTokenForClient, getXianyuTestSession, getXianyuVerificationRecords, saveXianyuTestSession, saveXianyuVerificationRecords } from "@/lib/storage";
import { analyzeXianyuDiagnostics, buildXianyuAcceptanceItems, buildXianyuTestEvidenceItems, isDiagnosticReady, isXianyuMessage, isXianyuMvpAccepted, isXianyuOrder } from "@/lib/xianyuMvpValidation";
import type { BrowserPluginStatus, CustomerMessage, Order, OutboundReplyCommand, OutboundReplyStatus, XianyuMvpTestSession, XianyuMvpVerificationRecord } from "@/lib/types";

type HealthState = "idle" | "ok" | "warn" | "error";

type CheckState = {
  health: HealthState;
  tokenReady: boolean;
  message: string;
};

type PluginHeartbeatView = {
  online?: boolean;
  status?: {
    siteOrigin?: string;
    platform?: string;
    shopAlias?: string;
    pageStatus?: "xianyu-detected" | "not-detected";
    autoSyncEnabled?: boolean;
    lastSyncAt?: string;
    lastCapturedSummary?: string;
    extensionVersion?: string;
    updatedAt?: string;
  } | null;
};

type InboxLogEntry = {
  id: string;
  receivedAt: string;
  platform: string;
  customerName: string;
  messageSummary: string;
  conversationId: string;
  duplicated: boolean;
  status: "success" | "failed";
  httpStatus: number;
  error?: string;
};

const outboundStatusLabels: Record<OutboundReplyStatus, string> = {
  pending: "待插件处理",
  processing: "插件处理中",
  filled: "已回填输入框",
  sent: "已发送",
  failed: "发送失败",
  cancelled: "已取消",
};

const checklist = [
  "在设置页生成插件连接码，并导入浏览器插件。",
  "在插件里开启闲鱼自动同步和允许回闲鱼。",
  "打开真实闲鱼聊天页，点击插件里的诊断并复制结果。",
  "让买家发送本页测试消息，确认本次测试追踪出现通过项。",
  "在消息中心生成回复并点击发送回闲鱼。",
  "确认本页出现已回填或已发送的回闲鱼任务。",
  "确认客户记录或订单记录里保留原平台链接。",
];

function timeLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function hasSourceUrl(item: { sourceUrl?: string }) {
  return Boolean(item.sourceUrl && /^https?:\/\//.test(item.sourceUrl));
}

function createTestCode() {
  const now = new Date();
  const date = `${now.getMonth() + 1}${now.getDate()}${now.getHours()}${now.getMinutes()}`.padStart(8, "0");
  return `XY-${date}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function createTestSession(): XianyuMvpTestSession {
  const code = createTestCode();
  return {
    id: createId("xianyu_test"),
    createdAt: new Date().toISOString(),
    code,
    buyerMessage: `实机测试 ${code}：还在吗？今天可以发货吗？`,
  };
}

async function readJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: token ? { "x-webhook-token": token, Authorization: `Bearer ${token}` } : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function statusTone(status: HealthState) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "warn") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function mergeVerificationRecords(...groups: XianyuMvpVerificationRecord[][]) {
  const byId = new Map<string, XianyuMvpVerificationRecord>();
  for (const record of groups.flat()) {
    if (record?.id) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}

function pluginStatusSummary(status: BrowserPluginStatus | undefined, emptyText: string) {
  if (!status) return emptyText;
  const result = status.ok ? "成功" : status.error || "失败";
  const target = status.messageId ? `消息 ${status.messageId}` : status.commandId ? `任务 ${status.commandId}` : "无对应 ID";
  const action = status.action || (status.kind === "outbound" && status.mode ? (status.mode === "send" ? "代点击发送" : "只回填输入框") : "未标明方式");
  const source = status.sourceUrl ? ` / ${status.sourceUrl}` : "";
  return `${result} / ${action} / ${target}${source}`;
}

function pendingDetail(items: Array<{ label: string; ok: boolean; detail: string }>, label: string) {
  return items.find((item) => item.label === label && !item.ok)?.detail || "";
}

function configOutboundMode(status: BrowserPluginStatus | undefined) {
  const value = `${status?.action || ""} ${status?.mode || ""}`;
  if (/代点击发送|send/.test(value)) return "send";
  if (/只回填输入框|fill/.test(value)) return "fill";
  return "";
}

export default function XianyuMvpPage() {
  const [checkState, setCheckState] = useState<CheckState>({ health: "idle", tokenReady: false, message: "尚未检查" });
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [outbox, setOutbox] = useState<OutboundReplyCommand[]>([]);
  const [pluginStatuses, setPluginStatuses] = useState<BrowserPluginStatus[]>([]);
  const [inboxLogs, setInboxLogs] = useState<InboxLogEntry[]>([]);
  const [pluginHeartbeat, setPluginHeartbeat] = useState<PluginHeartbeatView>({});
  const [loading, setLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [diagnosticText, setDiagnosticText] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [records, setRecords] = useState<XianyuMvpVerificationRecord[]>([]);
  const [testSession, setTestSession] = useState<XianyuMvpTestSession | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getWebhookTokenForClient();
      const [health, heartbeatData] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }).then((response) => response.ok).catch(() => false),
        fetch("/api/plugin/status", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})),
      ]);
      setPluginHeartbeat(heartbeatData as PluginHeartbeatView);
      if (!token) {
        setMessages([]);
        setOrders([]);
        setOutbox([]);
        setPluginStatuses([]);
        setCheckState({
          health: health ? "warn" : "error",
          tokenReady: false,
          message: heartbeatData?.online
            ? "网站已收到插件心跳，但当前页面还没有读到 Webhook Token；消息和订单统计暂时不会刷新。"
            : "还没有读取到 Webhook Token，请先去设置页生成插件连接码。",
        });
        setLastRefreshAt(new Date().toLocaleString());
        return;
      }
      const [inboxData, orderData, outboxData, pluginStatusData, inboxLogData] = await Promise.all([
        readJson<{ messages?: CustomerMessage[] }>("/api/inbox", token),
        readJson<{ orders?: Order[] }>("/api/orders", token),
        readJson<{ commands?: OutboundReplyCommand[] }>("/api/outbox?status=all&platform=%E9%97%B2%E9%B1%BC", token),
        readJson<{ statuses?: BrowserPluginStatus[] }>("/api/plugin-status?platform=%E9%97%B2%E9%B1%BC", token),
        readJson<{ logs?: InboxLogEntry[] }>("/api/inbox/logs", token),
      ]);
      setMessages(Array.isArray(inboxData.messages) ? inboxData.messages : []);
      setOrders(Array.isArray(orderData.orders) ? orderData.orders : []);
      setOutbox(Array.isArray(outboxData.commands) ? outboxData.commands : []);
      setPluginStatuses(Array.isArray(pluginStatusData.statuses) ? pluginStatusData.statuses : []);
      setInboxLogs(Array.isArray(inboxLogData.logs) ? inboxLogData.logs : []);
      setCheckState({
        health: health ? "ok" : "warn",
        tokenReady: true,
        message: health ? "工作台接口可用，插件连接码 Token 已读取。" : "Token 已读取，但健康检查未通过。",
      });
      const serverRecords = await readJson<{ records?: XianyuMvpVerificationRecord[] }>("/api/xianyu-verification", token).catch(() => ({ records: [] }));
      if (Array.isArray(serverRecords.records) && serverRecords.records.length > 0) {
        setRecords((current) => mergeVerificationRecords(current, serverRecords.records || []));
      }
      setLastRefreshAt(new Date().toLocaleString());
    } catch (error) {
      setCheckState({
        health: "error",
        tokenReady: false,
        message: error instanceof Error ? error.message : "检查失败",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    setRecords(getXianyuVerificationRecords());
    const storedSession = getXianyuTestSession();
    if (storedSession) {
      setTestSession(storedSession);
    } else {
      const nextSession = createTestSession();
      setTestSession(nextSession);
      saveXianyuTestSession(nextSession);
    }
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [autoRefresh, refresh]);

  const xianyuMessages = useMemo(
    () => [...messages].filter(isXianyuMessage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [messages],
  );
  const xianyuOrders = useMemo(
    () => [...orders].filter(isXianyuOrder).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [orders],
  );
  const latestCommands = useMemo(
    () => [...outbox].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [outbox],
  );
  const latestPluginStatuses = useMemo(
    () => [...pluginStatuses].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [pluginStatuses],
  );
  const latestConfigStatus = latestPluginStatuses.find((status) => status.kind === "config");
  const latestAutoSyncStatus = latestPluginStatuses.find((status) => status.kind === "autoSync");
  const latestOutboundPluginStatus = latestPluginStatuses.find((status) => status.kind === "outbound");

  const metrics = [
    { label: "闲鱼消息", value: xianyuMessages.length, hint: "来自插件或手动同步" },
    { label: "有原链接的记录", value: xianyuMessages.filter(hasSourceUrl).length + xianyuOrders.filter(hasSourceUrl).length, hint: "回填需要这个链接" },
    { label: "回闲鱼任务", value: latestCommands.length, hint: "工作台确认发送后生成" },
    { label: "已回填/已发送", value: latestCommands.filter((item) => item.status === "filled" || item.status === "sent").length, hint: "插件成功处理" },
  ];
  const diagnosticItems = useMemo(() => analyzeXianyuDiagnostics(diagnosticText), [diagnosticText]);
  const diagnosticReady = isDiagnosticReady(diagnosticItems);
  const acceptanceItems = useMemo(
    () => buildXianyuAcceptanceItems({ diagnosticReady, messages, orders, commands: latestCommands, pluginStatuses: latestPluginStatuses }),
    [diagnosticReady, latestCommands, latestPluginStatuses, messages, orders],
  );
  const accepted = isXianyuMvpAccepted(acceptanceItems);
  const latestMessage = xianyuMessages[0];
  const latestCommand = latestCommands[0];
  const heartbeatStatus = pluginHeartbeat.status || null;
  const heartbeatOnline = Boolean(pluginHeartbeat.online);
  const heartbeatPageDetected = heartbeatStatus?.pageStatus === "xianyu-detected";
  const latestAutoSyncSummary = pluginStatusSummary(latestAutoSyncStatus, "无自动同步状态");
  const latestOutboundPluginSummary = pluginStatusSummary(latestOutboundPluginStatus, "无回闲鱼状态");
  const latestConfigSummary = pluginStatusSummary(latestConfigStatus, "无插件配置状态");
  const outboundAutomationMode = configOutboundMode(latestConfigStatus);
  const noReturnToXianyuReady = Boolean(latestConfigStatus?.ok && outboundAutomationMode === "send");
  const trackedEvidenceItems = useMemo(
    () => buildXianyuTestEvidenceItems({
      testCode: testSession?.code,
      messages,
      orders,
      commands: latestCommands,
      pluginStatuses: latestPluginStatuses,
    }),
    [latestCommands, latestPluginStatuses, messages, orders, testSession?.code],
  );
  const trackedTestMessage = useMemo(
    () => testSession?.code ? xianyuMessages.find((message) => (message.rawMessage || "").includes(testSession.code)) : undefined,
    [testSession?.code, xianyuMessages],
  );
  const trackedMessageHref = trackedTestMessage
    ? `/messages?messageId=${encodeURIComponent(trackedTestMessage.id)}`
    : "/messages";
  const testSessionPendingCount = trackedEvidenceItems.filter((item) => !item.ok).length;
  const testSessionAccepted = trackedEvidenceItems.length > 0 && testSessionPendingCount === 0;
  const strictAccepted = accepted && testSessionAccepted;
  const acceptedRecordForCurrentTest = useMemo(
    () => Boolean(testSession?.code && records.some((record) => record.accepted && record.testSessionSummary?.includes(testSession.code))),
    [records, testSession?.code],
  );
  const nextAction = useMemo(() => {
    if (strictAccepted) {
      return {
        title: "可以保存本次验收记录",
        detail: "总体验收门槛和本次测试码证据都已满足，点击页面顶部“保存验收记录”。",
        href: "",
        actionLabel: "",
      };
    }
    if (!checkState.tokenReady) {
      return {
        title: "先完成插件连接码",
        detail: "工作台还没有读到 Webhook Token。去设置页生成连接码，并导入浏览器插件。",
        href: "/settings",
        actionLabel: "打开设置页",
      };
    }
    if (!diagnosticReady) {
      return {
        title: "先诊断真实闲鱼聊天页",
        detail: "在真实闲鱼聊天页打开插件，点击诊断并复制结果，再粘贴到本页“插件诊断文本”。",
        href: "",
        actionLabel: "",
      };
    }
    const configDetail = pendingDetail(acceptanceItems, "插件配置已就绪");
    if (configDetail) {
      return {
        title: "打开插件并确认两个开关",
        detail: configDetail,
        href: "",
        actionLabel: "",
      };
    }
    const messageDetail = pendingDetail(trackedEvidenceItems, "测试码消息进入工作台");
    if (messageDetail) {
      return {
        title: "让朋友发送本页测试消息",
        detail: testSession?.buyerMessage || messageDetail,
        href: "",
        actionLabel: "",
      };
    }
    const autoSyncDetail = pendingDetail(trackedEvidenceItems, "自动同步匹配同一链接");
    if (autoSyncDetail) {
      return {
        title: "检查插件自动同步状态",
        detail: "保持真实闲鱼聊天页打开，确认插件里“自动同步”和“回闲鱼”已开启；如果仍未通过，刷新闲鱼页后让朋友再发一次测试消息。",
        href: "",
        actionLabel: "",
      };
    }
    const commandDetail = pendingDetail(trackedEvidenceItems, "本次回复任务已创建");
    if (commandDetail) {
      return {
        title: "去消息中心确认发送回闲鱼",
        detail: "打开本次测试消息，生成或确认回复，然后点击“发送回闲鱼”。",
        href: trackedMessageHref,
        actionLabel: trackedTestMessage ? "打开本次消息" : "打开消息中心",
      };
    }
    const outboundDetail = pendingDetail(trackedEvidenceItems, "本次回复已同步回闲鱼");
    if (outboundDetail) {
      return {
        title: "等待插件处理回闲鱼任务",
        detail: "保持闲鱼聊天页登录并打开，等待插件轮询任务；如果任务失败，可在本页“最近回闲鱼任务”点击重新处理。",
        href: "",
        actionLabel: "",
      };
    }
    const orderDetail = pendingDetail(trackedEvidenceItems, "本次客户与订单已沉淀");
    if (orderDetail) {
      return {
        title: "确认客户与订单沉淀",
        detail: "如果任务已创建但还没有订单记录，回到消息中心或订单页确认这条客户记录是否已生成订单并保留原平台链接。",
        href: "/orders",
        actionLabel: "打开订单页",
      };
    }
    const acceptanceDetail = acceptanceItems.find((item) => !item.ok);
    return {
      title: acceptanceDetail ? `处理：${acceptanceDetail.label}` : "继续刷新状态",
      detail: acceptanceDetail?.detail || "点击刷新状态，等待插件和工作台同步最新证据。",
      href: "",
      actionLabel: "",
    };
  }, [acceptanceItems, checkState.tokenReady, diagnosticReady, strictAccepted, testSession?.buyerMessage, trackedEvidenceItems, trackedMessageHref, trackedTestMessage]);
  const liveRunSteps = useMemo(() => {
    const hasTestMessage = trackedEvidenceItems.find((item) => item.label === "测试码消息进入工作台")?.ok || false;
    const hasAutoSync = trackedEvidenceItems.find((item) => item.label === "自动同步匹配同一链接")?.ok || false;
    const hasCommand = trackedEvidenceItems.find((item) => item.label === "本次回复任务已创建")?.ok || false;
    const hasOutboundSync = trackedEvidenceItems.find((item) => item.label === "本次回复已同步回闲鱼")?.ok || false;
    const hasOrder = trackedEvidenceItems.find((item) => item.label === "本次客户与订单已沉淀")?.ok || false;
    const steps = [
      {
        label: "连接插件",
        done: Boolean(checkState.tokenReady && latestConfigStatus?.ok),
        detail: checkState.tokenReady && latestConfigStatus?.ok ? "连接码、Token、自动同步和回闲鱼开关已就绪。" : "先在设置页生成连接码，导入插件并保存配置。",
        href: "/settings",
        actionLabel: "插件连接码",
      },
      {
        label: "诊断真实闲鱼页",
        done: diagnosticReady,
        detail: diagnosticReady ? "诊断文本显示当前闲鱼聊天页可继续测试。" : "在真实闲鱼聊天页打开插件，复制诊断结果并粘贴到本页。",
        href: "",
        actionLabel: "",
      },
      {
        label: "让朋友发送测试消息",
        done: hasTestMessage,
        detail: hasTestMessage ? "工作台已看到带本次测试码的闲鱼消息。" : testSession?.buyerMessage || "复制本页测试消息，让朋友从闲鱼发过来。",
        href: "",
        actionLabel: "",
      },
      {
        label: "确认自动入站",
        done: hasAutoSync,
        detail: hasAutoSync ? "插件自动同步状态已匹配本次测试消息。" : "保持真实闲鱼聊天页打开，等待插件自动同步状态回写。",
        href: "",
        actionLabel: "",
      },
      {
        label: "工作台确认回复",
        done: hasCommand,
        detail: hasCommand ? "本次消息已创建回闲鱼任务。" : "去消息中心生成或确认回复，然后点击发送回闲鱼。",
        href: trackedMessageHref,
        actionLabel: trackedTestMessage ? "本次消息" : "消息中心",
      },
      {
        label: "插件同步回闲鱼",
        done: hasOutboundSync,
        detail: hasOutboundSync ? "本次任务已回填或已发送到闲鱼。" : "保持闲鱼页打开等待插件处理；失败任务可在本页重新处理。",
        href: "",
        actionLabel: "",
      },
      {
        label: "沉淀并保存记录",
        done: acceptedRecordForCurrentTest,
        detail: acceptedRecordForCurrentTest
          ? "本次测试码已有已通过验收记录。"
          : hasOrder && strictAccepted
            ? "客户与订单已沉淀，可以点击页面顶部保存验收记录。"
            : "等待同一闲鱼链接下的客户与订单记录沉淀，再保存验收记录。",
        href: "/orders",
        actionLabel: "订单页",
      },
    ];
    const currentIndex = steps.findIndex((step) => !step.done);
    return steps.map((step, index) => ({ ...step, current: index === currentIndex }));
  }, [acceptedRecordForCurrentTest, checkState.tokenReady, diagnosticReady, latestConfigStatus?.ok, strictAccepted, testSession?.buyerMessage, trackedEvidenceItems, trackedMessageHref, trackedTestMessage]);

  async function copyVerificationSummary() {
    const lines = [
      "闲鱼闭环 MVP 实机验收摘要",
      `时间：${new Date().toLocaleString()}`,
      testSession ? `本次测试码：${testSession.code}` : "本次测试码：未生成",
      testSession ? `买家测试消息：${testSession.buyerMessage}` : "买家测试消息：未生成",
      `连接状态：${checkState.message}`,
      `闲鱼消息数：${xianyuMessages.length}`,
      `有原链接记录数：${xianyuMessages.filter(hasSourceUrl).length + xianyuOrders.filter(hasSourceUrl).length}`,
      `回闲鱼任务数：${latestCommands.length}`,
      `已回填/已发送：${latestCommands.filter((item) => item.status === "filled" || item.status === "sent").length}`,
      `闭环验收：${accepted ? "已达到" : `未完成，${acceptanceItems.filter((item) => !item.ok).length} 项待处理`}`,
      `本次测试：${testSessionAccepted ? "已完成" : `未完成，${testSessionPendingCount} 项待处理`}`,
      `严格验收：${strictAccepted ? "已通过" : "未通过"}`,
      `验收记录：${acceptedRecordForCurrentTest ? "已保存本次通过记录" : "尚未保存本次通过记录"}`,
      latestMessage ? `最近消息：${latestMessage.customerFolder || latestMessage.customerName || "待识别客户"} / ${latestMessage.rawMessage.slice(0, 120)}` : "最近消息：无",
      latestCommand ? `最近回闲鱼任务：${latestCommand.customerFolder || latestCommand.customerName || "待识别客户"} / ${outboundStatusLabels[latestCommand.status] || latestCommand.status}${latestCommand.error ? ` / ${latestCommand.error}` : ""}` : "最近回闲鱼任务：无",
      `插件配置状态：${latestConfigSummary}`,
      `无需回闲鱼手动发送：${noReturnToXianyuReady ? "已开启代点击发送" : outboundAutomationMode === "fill" ? "当前只回填输入框" : "未确认"}`,
      `插件自动同步状态：${latestAutoSyncSummary}`,
      `插件回闲鱼状态：${latestOutboundPluginSummary}`,
      "本次测试追踪：",
      ...trackedEvidenceItems.map((item) => `- ${item.ok ? "通过" : "待处理"} ${item.label}：${item.detail}`),
      "闭环验收门槛：",
      ...acceptanceItems.map((item) => `- ${item.ok ? "通过" : "待处理"} ${item.label}：${item.detail}`),
      "插件诊断判断：",
      ...(diagnosticItems.length ? diagnosticItems.map((item) => `- ${item.ok ? "通过" : "待处理"} ${item.label}：${item.detail}`) : ["- 未粘贴插件诊断文本"]),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyMessage("已复制验收摘要");
    } catch {
      setCopyMessage("复制失败，请手动选择页面内容");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  async function copyLiveRunbook() {
    const lines = [
      "闲鱼闭环 MVP 现场跑测步骤",
      `本次测试码：${testSession?.code || "未生成"}`,
      testSession ? `买家测试消息：${testSession.buyerMessage}` : "买家测试消息：未生成",
      `下一步：${nextAction.title} - ${nextAction.detail}`,
      ...liveRunSteps.map((step, index) => `${index + 1}. ${step.done ? "已完成" : step.current ? "现在处理" : "待处理"}｜${step.label}：${step.detail}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyMessage("已复制现场跑测步骤");
    } catch {
      setCopyMessage("复制失败，请手动选择页面内容");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  async function saveVerificationRecord() {
    const record: XianyuMvpVerificationRecord = {
      id: createId("xianyu_verify"),
      createdAt: new Date().toISOString(),
      accepted: strictAccepted,
      pendingCount: acceptanceItems.filter((item) => !item.ok).length + testSessionPendingCount,
      testSessionSummary: testSession ? `${testSession.code} / ${testSession.buyerMessage}` : "未生成测试码",
      testSessionAccepted,
      testSessionPendingCount,
      testEvidenceItems: trackedEvidenceItems,
      latestMessageSummary: latestMessage
        ? `${latestMessage.customerFolder || latestMessage.customerName || "待识别客户"} / ${latestMessage.rawMessage.slice(0, 120)}`
        : "无",
      latestCommandSummary: latestCommand
        ? `${latestCommand.customerFolder || latestCommand.customerName || "待识别客户"} / ${outboundStatusLabels[latestCommand.status] || latestCommand.status}${latestCommand.error ? ` / ${latestCommand.error}` : ""}`
        : "无",
      latestConfigSummary,
      latestAutoSyncSummary,
      latestOutboundPluginSummary,
      acceptanceItems,
      diagnosticItems,
    };
    const nextRecords = [record, ...records].slice(0, 20);
    setRecords(nextRecords);
    saveXianyuVerificationRecords(nextRecords);
    try {
      const token = await getWebhookTokenForClient();
      if (!token) throw new Error("还没有读取到 Webhook Token");
      const response = await fetch("/api/xianyu-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-token": token,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ record }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setCopyMessage("已保存验收记录，本机和服务端都已留档");
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务端保存失败";
      setCopyMessage(`已保存本机验收记录；服务端留档失败：${message}`);
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  async function copyBuyerTestMessage() {
    if (!testSession) return;
    try {
      await navigator.clipboard.writeText(testSession.buyerMessage);
      setCopyMessage("已复制买家测试消息");
    } catch {
      setCopyMessage("复制失败，请手动选择测试消息");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  function startNewTestSession() {
    const nextSession = createTestSession();
    setTestSession(nextSession);
    saveXianyuTestSession(nextSession);
    setCopyMessage("已生成新的实机测试码");
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  async function clearTestData() {
    const confirmed = window.confirm("确认清空本机和服务端测试消息、订单、会话、发送任务和验收记录吗？插件连接配置会保留。");
    if (!confirmed) return;
    try {
      const token = await getWebhookTokenForClient();
      const removablePrefixes = ["ai-service."];
      const keepKeys = new Set(["ai-service.settings", "ai-service.demo-auth"]);
      for (const key of Object.keys(window.localStorage)) {
        if (removablePrefixes.some((prefix) => key.startsWith(prefix)) && !keepKeys.has(key)) {
          window.localStorage.removeItem(key);
        }
      }
      window.dispatchEvent(new Event("orders-updated"));
      window.dispatchEvent(new Event("customer-messages-updated"));
      const response = await fetch("/api/test-data/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessages([]);
      setOrders([]);
      setOutbox([]);
      setPluginStatuses([]);
      setPluginHeartbeat({});
      setRecords([]);
      const nextSession = createTestSession();
      setTestSession(nextSession);
      saveXianyuTestSession(nextSession);
      setCopyMessage("测试数据已清空，插件连接配置已保留");
      await refresh();
    } catch (error) {
      setCopyMessage(`清空测试数据失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    }
    window.setTimeout(() => setCopyMessage(""), 2500);
  }

  async function retryOutboundCommand(command: OutboundReplyCommand) {
    try {
      const token = await getWebhookTokenForClient();
      if (!token) throw new Error("还没有读取到 Webhook Token，请先去设置页生成插件连接码。");
      const response = await fetch("/api/outbox", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-token": token,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: command.id, status: "pending" }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setCopyMessage("已重新放回待处理");
      await refresh();
    } catch (error) {
      setCopyMessage(error instanceof Error ? error.message : "重试失败");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  const friendlyConnectionMessage = checkState.health === "error"
    ? "网站连接失败：插件或网站服务暂时没有连通。请先确认插件连接码是否导入成功，再刷新状态。"
    : checkState.message;
  const beginnerCards = [
    {
      title: "插件连接",
      status: heartbeatOnline ? "已连接" : heartbeatStatus ? "已离线" : "未连接",
      detail: heartbeatOnline ? "网站已收到插件心跳。" : heartbeatStatus ? "超过 60 秒没有收到插件心跳，请打开插件或刷新状态。" : "尚未收到插件心跳。请打开插件并点击测试连接。",
      meta: heartbeatStatus?.updatedAt ? `最近心跳：${timeLabel(heartbeatStatus.updatedAt)}` : "当前网站：使用本页设置页生成的连接码",
      action: heartbeatOnline ? { label: "下一步：打开闲鱼聊天页", href: "" } : { label: "去设置页复制插件连接码", href: "/settings" },
      tone: heartbeatOnline ? "ok" : heartbeatStatus ? "error" : "warn",
    },
    {
      title: "闲鱼页面识别",
      status: heartbeatPageDetected ? "已识别闲鱼" : "未识别",
      detail: heartbeatPageDetected ? "插件当前识别到闲鱼聊天页。" : "打开真实闲鱼聊天页后，在插件里点“检查当前页面”。",
      meta: `自动同步：${heartbeatStatus?.autoSyncEnabled ? "开" : "关或待确认"}`,
      action: { label: "刷新状态", href: "" },
      tone: heartbeatPageDetected ? "ok" : "warn",
    },
    {
      title: "消息同步",
      status: latestMessage ? "已有客户消息" : "等待消息",
      detail: latestMessage ? `${latestMessage.customerName || latestMessage.customerFolder || "客户"}：${(latestMessage.rawMessage || "").slice(0, 42)}` : "等待客户在闲鱼发来消息，插件会自动同步到消息中心。",
      meta: heartbeatStatus?.lastCapturedSummary ? `最近插件捕获：${heartbeatStatus.lastCapturedSummary}` : latestMessage?.sourceUrl ? "已保留原闲鱼页面链接" : "同一会话聚合会在消息中心查看",
      action: { label: "打开消息中心查看", href: "/messages" },
      tone: latestMessage ? "ok" : "warn",
    },
    {
      title: "回复与订单",
      status: xianyuOrders.length > 0 ? "订单已保存" : latestCommand ? "回复已生成" : "未生成回复",
      detail: xianyuOrders.length > 0 ? "客户订单已保存，可以进入订单页查看。" : latestCommand ? "已有回复任务，下一步确认订单是否保存。" : "在消息中心打开会话，生成 AI 回复并保存订单。",
      meta: `订单数：${xianyuOrders.length}`,
      action: { label: "打开客户订单", href: "/orders" },
      tone: xianyuOrders.length > 0 ? "ok" : latestCommand ? "warn" : "idle",
    },
  ];
  const beginnerSteps = [
    { label: "导入插件连接码", done: checkState.tokenReady && Boolean(latestConfigStatus?.ok), href: "/settings", actionLabel: "复制连接码" },
    { label: "打开闲鱼聊天页", done: diagnosticReady, href: "", actionLabel: "在插件里检查当前页面" },
    { label: "等待客户消息同步", done: Boolean(latestMessage), href: "/messages", actionLabel: "查看消息中心" },
    { label: "在消息中心生成回复", done: Boolean(latestCommand), href: trackedMessageHref, actionLabel: "打开会话" },
    { label: "保存订单", done: xianyuOrders.length > 0, href: "/orders", actionLabel: "查看订单" },
  ].map((step, index, all) => ({
    ...step,
    current: !step.done && all.slice(0, index).every((item) => item.done),
  }));

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">Xianyu MVP</div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">闲鱼闭环验证</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">按 5 步完成最小验证：连接插件、识别闲鱼页、同步消息、生成回复、保存订单。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link className={secondaryButtonClass} href="/settings">插件连接码</Link>
            <Link className={secondaryButtonClass} href="/messages">消息中心</Link>
            <button type="button" className={primaryButtonClass} onClick={refresh} disabled={loading}>{loading ? "刷新中..." : "刷新状态"}</button>
          </div>
        </div>
        {copyMessage ? <div className="mt-3 text-sm font-medium text-emerald-700">{copyMessage}</div> : null}
      </header>

      <div className={`rounded-md border px-4 py-3 text-sm ${statusTone(checkState.health)}`}>
        <div className="font-semibold">{checkState.tokenReady ? "连接准备就绪" : "连接待确认"}</div>
        <div className="mt-1">{friendlyConnectionMessage}</div>
        {lastRefreshAt ? <div className="mt-1 text-xs opacity-75">最近刷新：{lastRefreshAt}</div> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {beginnerCards.map((card) => (
          <div key={card.title} className={`rounded-md border p-4 text-sm ${card.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : card.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : card.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`}>
            <div className="text-xs font-semibold opacity-75">{card.title}</div>
            <div className="mt-2 text-lg font-semibold">{card.status}</div>
            <div className="mt-2 text-xs leading-5 opacity-85">{card.detail}</div>
            <div className="mt-2 text-xs opacity-70">{card.meta}</div>
            {card.action.href ? (
              <Link className="mt-3 inline-flex rounded-md border border-white/80 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50" href={card.action.href}>
                {card.action.label}
              </Link>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
        <div className="text-xs font-semibold text-sky-700">下一步</div>
        <div className="mt-1 font-semibold">{nextAction.title}</div>
        <div className="mt-1 text-xs leading-5 text-sky-800">{nextAction.detail}</div>
        {nextAction.href && nextAction.actionLabel ? (
          <Link className="mt-3 inline-flex rounded-md border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100" href={nextAction.href}>
            {nextAction.actionLabel}
          </Link>
        ) : null}
      </div>

      <Section title="5 步完成验证">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            新用户只按这条路径走，完成后就能判断闭环是否跑通。
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {beginnerSteps.map((step, index) => (
            <div
              key={step.label}
              className={`rounded-md border p-3 text-sm ${step.done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : step.current ? "border-sky-200 bg-sky-50 text-sky-950" : "border-slate-200 bg-white text-slate-700"}`}
            >
              <div className="flex items-start gap-2">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-100 text-emerald-800" : step.current ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}>
                  {index + 1}
                </span>
                <div>
                  <div className="font-semibold">{step.done ? "已完成" : step.current ? "现在做" : "待处理"} · {step.label}</div>
                  <div className="mt-1 text-xs leading-5 opacity-80">
                    {step.current ? "这是当前最重要的一步。" : step.done ? "已通过。" : "完成前面的步骤后再处理。"}
                  </div>
                  {!step.done && step.current && step.href && step.actionLabel ? (
                    <Link className="mt-2 inline-flex rounded-md border border-white/80 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" href={step.href}>
                      {step.actionLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <details className="rounded-md border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">高级调试、验收记录和完整证据</summary>
        <div className="mt-4 space-y-5">
          <label className="flex w-fit items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>{autoRefresh ? "自动刷新已开启，每 8 秒更新" : "自动刷新已关闭"}</span>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={secondaryButtonClass} onClick={saveVerificationRecord}>保存验收记录</button>
            <button type="button" className={secondaryButtonClass} onClick={copyVerificationSummary}>复制验收摘要</button>
            <button type="button" className={secondaryButtonClass} onClick={copyLiveRunbook}>复制跑测步骤</button>
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50" onClick={clearTestData}>清空测试数据</button>
          </div>

      <div className={`rounded-md border px-4 py-3 text-sm ${noReturnToXianyuReady ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <div className="font-semibold">{noReturnToXianyuReady ? "统一操作模式：已开启代点击发送" : "统一操作模式：还可能需要回闲鱼确认发送"}</div>
        <div className="mt-1 text-xs leading-5 opacity-80">
          {noReturnToXianyuReady
            ? "插件配置显示会代点击发送。商家在工作台确认后，插件会尽量在闲鱼页完成发送动作。"
            : outboundAutomationMode === "fill"
              ? "当前插件配置是只回填输入框。若要测试“不回闲鱼点发送”，请在插件里把“同步回闲鱼后的动作”改成“代点击发送”并保存。"
              : "还没有看到插件回闲鱼动作配置。打开插件并保存配置后，这里会显示当前是只回填还是代点击发送。"}
        </div>
      </div>

      <Section title="本次实机测试">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="text-xs font-semibold text-slate-500">让朋友在闲鱼发这句话</div>
            <div className="mt-3 rounded-md bg-white p-3 text-base font-semibold leading-7 text-slate-950 ring-1 ring-slate-200">
              {testSession?.buyerMessage || "正在生成测试消息..."}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className={secondaryButtonClass} onClick={copyBuyerTestMessage} disabled={!testSession}>复制测试消息</button>
              <button type="button" className={secondaryButtonClass} onClick={startNewTestSession}>换一个测试码</button>
            </div>
            <div className="mt-3 text-xs leading-5 text-slate-500">
              测试码会帮我们确认这次证据来自同一条真实闲鱼消息，而不是之前留下的数据。
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {trackedEvidenceItems.map((item) => (
              <div key={item.label} className={`rounded-md border p-3 text-sm ${item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}>
                <div className="font-semibold">{item.ok ? "通过" : "待处理"} · {item.label}</div>
                <div className="mt-2 text-xs leading-5 opacity-80">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="插件最近状态">
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { label: "插件配置", status: latestConfigStatus, empty: "还没有收到插件配置状态。" },
            { label: "自动同步", status: latestAutoSyncStatus, empty: "还没有收到插件自动同步状态。" },
            { label: "回闲鱼", status: latestOutboundPluginStatus, empty: "还没有收到插件回闲鱼状态。" },
          ].map((item) => (
            <div key={item.label} className={`rounded-md border p-4 text-sm ${item.status?.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : item.status ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-700"}`}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="font-semibold">{item.label}</div>
                <div className="text-xs opacity-75">{item.status ? timeLabel(item.status.updatedAt) : "等待中"}</div>
              </div>
              {item.status ? (
                <>
                  <div className="mt-2">{item.status.ok ? "成功" : item.status.error || "失败"}</div>
                  <div className="mt-1 text-xs opacity-80">
                    {item.status.messageId ? `消息：${item.status.messageId}` : item.status.commandId ? `任务：${item.status.commandId}` : item.status.action || "插件已回写状态"}
                    {item.status.mode ? ` · ${item.status.mode === "send" ? "代点击发送" : "只回填输入框"}` : ""}
                    {item.status.action && (item.status.messageId || item.status.commandId) ? ` · ${item.status.action}` : ""}
                  </div>
                  {item.status.sourceUrl ? <div className="mt-1 break-all text-xs opacity-75">{item.status.sourceUrl}</div> : null}
                </>
              ) : (
                <div className="mt-2 text-slate-500">{item.empty}</div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="最近 /api/inbox 入站日志">
        {inboxLogs.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {inboxLogs.slice(0, 6).map((log) => (
              <div key={log.id} className={`rounded-md border p-4 text-sm ${log.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-semibold">{log.status === "success" ? "已收到同步请求" : "同步请求失败"}</div>
                  <div className="text-xs opacity-75">{timeLabel(log.receivedAt)}</div>
                </div>
                <div className="mt-2 text-xs leading-5">
                  <div>HTTP {log.httpStatus}{log.duplicated ? " · duplicated=true" : ""}</div>
                  <div>平台：{log.platform || "未识别"} · 客户：{log.customerName || "未识别"}</div>
                  <div>摘要：{log.messageSummary || "无内容"}</div>
                  {log.conversationId ? <div>conversationId：{log.conversationId}</div> : null}
                  {log.error ? <div>错误：{log.error}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            尚未收到插件同步请求。请先在插件里点击“测试同步当前页最新消息”，如果这里仍为空，问题在插件请求没有到达网站。
          </div>
        )}
      </Section>

      <div className="grid gap-3 md:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500">{metric.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.hint}</div>
          </div>
        ))}
      </div>

      <Section title="闭环验收门槛">
        <div className={`mb-3 rounded-md border px-4 py-3 text-sm ${accepted ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <div className="font-semibold">{accepted ? "闲鱼闭环 MVP 已具备验收证据" : `还有 ${acceptanceItems.filter((item) => !item.ok).length} 项未满足`}</div>
          <div className="mt-1 text-xs opacity-80">这里按目标逐项判断：真实页识别、插件配置、消息入站、回复生成、商家确认发送、插件回填/发送、客户与订单沉淀，以及是否串在同一个闲鱼链接上。</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {acceptanceItems.map((item) => (
            <div key={item.label} className={`rounded-md border p-3 text-sm ${item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}>
              <div className="font-semibold">{item.ok ? "通过" : "待处理"} · {item.label}</div>
              <div className="mt-2 text-xs leading-5 opacity-80">{item.detail}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="实机验证步骤">
        <div className="grid gap-2 md:grid-cols-2">
          {checklist.map((item, index) => (
            <div key={item} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{index + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="插件诊断文本">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <textarea
              className="min-h-44 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              value={diagnosticText}
              onChange={(event) => setDiagnosticText(event.target.value)}
              placeholder="把插件里的“复制诊断结果”粘贴到这里，工作台会判断当前闲鱼页是否适合继续测试。"
            />
            <div className="mt-2 text-xs text-slate-500">诊断文本只保存在当前浏览器页面里，不会发送给闲鱼。</div>
          </div>
          <div className={`rounded-md border p-4 text-sm ${diagnosticItems.length === 0 ? "border-slate-200 bg-slate-50 text-slate-600" : diagnosticReady ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <div className="font-semibold">{diagnosticItems.length === 0 ? "等待诊断文本" : diagnosticReady ? "可以继续实机闭环测试" : "需要先处理页面适配"}</div>
            <div className="mt-3 space-y-2">
              {diagnosticItems.length === 0 ? (
                <div>先在闲鱼聊天页打开插件，点击“诊断当前闲鱼页面”，再复制结果粘贴到这里。</div>
              ) : diagnosticItems.map((item) => (
                <div key={item.label} className="rounded bg-white/70 px-3 py-2">
                  <div className="font-semibold">{item.ok ? "通过" : "待处理"} · {item.label}</div>
                  <div className="mt-1 text-xs opacity-80">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="最近闲鱼消息">
          {xianyuMessages.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-500">还没有看到闲鱼消息。先在真实闲鱼聊天页打开插件诊断，再让买家发一条新消息或点击“同步当前页最新消息”。</div>
          ) : (
            <div className="space-y-3">
              {xianyuMessages.slice(0, 5).map((message) => (
                <div key={message.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="font-semibold text-slate-950">{message.customerFolder || message.customerName || "待识别客户"}</div>
                    <div className="text-xs text-slate-500">{timeLabel(message.updatedAt)}</div>
                  </div>
                  <div className="mt-2 line-clamp-3 text-slate-700">{message.rawMessage}</div>
                  <div className="mt-2 text-xs text-slate-500">{message.sourceUrl || "缺少原平台链接"}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="最近回闲鱼任务">
          {latestCommands.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-500">还没有回闲鱼任务。在消息中心生成回复后点击“发送回闲鱼”，这里会显示插件处理状态。</div>
          ) : (
            <div className="space-y-3">
              {latestCommands.slice(0, 5).map((command) => (
                <div key={command.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="font-semibold text-slate-950">{command.customerFolder || command.customerName || "待识别客户"}</div>
                    <span className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${command.status === "failed" ? "bg-rose-50 text-rose-700" : command.status === "filled" || command.status === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                      {outboundStatusLabels[command.status] || command.status}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-3 text-slate-700">{command.reply}</div>
                  {command.error ? <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{command.error}</div> : null}
                  <div className="mt-2 text-xs text-slate-500">{timeLabel(command.updatedAt)} · {command.sourceUrl || "缺少原平台链接"}</div>
                  {command.status === "failed" || command.status === "cancelled" ? (
                    <button
                      type="button"
                      className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => retryOutboundCommand(command)}
                    >
                      重新处理
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="客户与订单沉淀">
        {xianyuOrders.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-500">还没有看到闲鱼订单记录。消息中心保存订单后，这里会显示最近记录。</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {xianyuOrders.slice(0, 6).map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} className="rounded-md border border-slate-200 bg-white p-3 text-sm transition hover:border-sky-200 hover:bg-sky-50">
                <div className="font-semibold text-slate-950">{order.orderTitle || order.customerFolder || order.customerName}</div>
                <div className="mt-1 text-slate-600">{order.summary || order.itemSummary || "暂无摘要"}</div>
                <div className="mt-2 text-xs text-slate-500">{order.status} · {timeLabel(order.updatedAt)} · {order.sourceUrl || "缺少原平台链接"}</div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="验收记录">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-500">暂无验收记录。完成一次实机测试后，点击页面顶部“保存验收记录”。</div>
        ) : (
          <div className="space-y-3">
            {records.slice(0, 8).map((record) => (
              <div key={record.id} className={`rounded-md border p-3 text-sm ${record.accepted ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-semibold">{record.accepted ? "已通过" : `${record.pendingCount} 项待处理`}</div>
                  <div className="text-xs opacity-75">{timeLabel(record.createdAt)}</div>
                </div>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  <div>测试码：{record.testSessionSummary || "旧记录未保存"}</div>
                  <div>本次测试：{record.testSessionAccepted === undefined ? "旧记录未保存" : record.testSessionAccepted ? "已完成" : `${record.testSessionPendingCount || 0} 项待处理`}</div>
                  <div>最近消息：{record.latestMessageSummary}</div>
                  <div>最近任务：{record.latestCommandSummary}</div>
                  <div>插件配置：{record.latestConfigSummary || "旧记录未保存"}</div>
                  <div>自动同步：{record.latestAutoSyncSummary || "旧记录未保存"}</div>
                  <div>回闲鱼：{record.latestOutboundPluginSummary || "旧记录未保存"}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(record.testEvidenceItems || []).map((item) => (
                    <span key={`test-${item.label}`} className={`rounded-full px-2 py-1 text-xs font-semibold ${item.ok ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-700"}`}>
                      本次{item.ok ? "通过" : "待处理"} · {item.label}
                    </span>
                  ))}
                  {record.acceptanceItems.map((item) => (
                    <span key={item.label} className={`rounded-full px-2 py-1 text-xs font-semibold ${item.ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                      {item.ok ? "通过" : "待处理"} · {item.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
        </div>
      </details>
    </div>
  );
}
