"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultKnowledgeRules, mergeDefaultTemplates, orderStatuses } from "@/lib/constants";
import { buildAnalyzePayload, promptVersion } from "@/lib/analyzePayload";
import { formatItemSummary } from "@/lib/format";
import { createOrderHistoryEvent, inferIntentLevel, mapOrderStatus, normalizeOrder } from "@/lib/orderUtils";
import { getCustomerMessages, getKnowledgeRules, getOrders, getSettings, getTemplates, getWebhookTokenForClient, saveCustomerMessages, saveKnowledgeRules, saveOrders, saveTemplates } from "@/lib/storage";
import type { AnalyzeApiResponse, AnalyzeResult, ConversationTurn, IntentLevel, Order, OrderHistoryEvent, OrderStatus, OutboundReplyCommand, OutboundReplyStatus } from "@/lib/types";

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function getOrderTheme(order: Order) {
  const themes: Record<Order["businessType"], { badge: string; panel: string; chip: string; glow: string }> = {
    sam: { badge: "bg-sky-50 text-sky-700", panel: "from-sky-50 to-white", chip: "bg-sky-100 text-sky-700", glow: "shadow-sky-200/60" },
    xianyu: { badge: "bg-amber-50 text-amber-700", panel: "from-amber-50 to-white", chip: "bg-amber-100 text-amber-800", glow: "shadow-amber-200/60" },
    virtual: { badge: "bg-fuchsia-50 text-fuchsia-700", panel: "from-fuchsia-50 to-white", chip: "bg-fuchsia-100 text-fuchsia-700", glow: "shadow-fuchsia-200/50" },
    local: { badge: "bg-emerald-50 text-emerald-700", panel: "from-emerald-50 to-white", chip: "bg-emerald-100 text-emerald-700", glow: "shadow-emerald-200/60" },
    trade: { badge: "bg-indigo-50 text-indigo-700", panel: "from-indigo-50 to-white", chip: "bg-indigo-100 text-indigo-700", glow: "shadow-indigo-200/50" },
  };
  return themes[order.businessType];
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeConversationRole(role: unknown): ConversationTurn["role"] {
  return role === "assistant" || role === "seller_note" ? role : "customer";
}

function mergeOrders(localOrders: Order[], serverOrders: Order[]) {
  const byId = new Map<string, Order>();
  for (const order of serverOrders.map(normalizeOrder)) byId.set(order.id, order);
  for (const order of localOrders.map(normalizeOrder)) {
    const existing = byId.get(order.id);
    byId.set(order.id, existing ? normalizeOrder({ ...existing, ...order, isNew: existing.isNew || order.isNew }) : order);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const outboundStatusLabels: Record<OutboundReplyStatus, string> = {
  pending: "待插件处理",
  processing: "插件处理中",
  filled: "已回填输入框",
  sent: "已发送",
  failed: "发送失败",
  cancelled: "已取消",
};

function getOutboundStatusClass(status: OutboundReplyStatus) {
  if (status === "sent" || status === "filled") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  if (status === "processing") return "bg-sky-50 text-sky-700";
  if (status === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

function getOutboundModeLabel(mode: OutboundReplyCommand["mode"]) {
  if (mode === "send") return "代点击发送";
  if (mode === "fill") return "只回填";
  return "按插件设置";
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [followUpText, setFollowUpText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sendingToPlatform, setSendingToPlatform] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [outboundCommands, setOutboundCommands] = useState<OutboundReplyCommand[]>([]);
  const order = useMemo(() => orders.find((item) => item.id === id), [orders, id]);
  const orderOutboundCommands = useMemo(() => {
    if (!order) return [];
    return outboundCommands
      .filter((command) => command.orderId === order.id || (command.customerFolder && command.customerFolder === (order.customerFolder || order.customerName)) || (command.sourceUrl && command.sourceUrl === order.sourceUrl))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [outboundCommands, order]);

  useEffect(() => {
    const normalized = getOrders().map(normalizeOrder);
    const next = normalized.map((item) => (item.id === id ? { ...item, isNew: false } : item));
    setOrders(next);
    saveOrders(next);
    if (!next.some((item) => item.id === id)) {
      syncServerOrder();
    }
  }, [id]);

  useEffect(() => {
    refreshOutboundCommands(true);
    const timer = window.setInterval(() => refreshOutboundCommands(true), 8000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setReplyDraft(order?.analysis?.reply || "");
  }, [order?.id, order?.analysis?.reply]);

  useEffect(() => {
    if (!order) return;
    const successful = orderOutboundCommands.filter((command) => command.status === "filled" || command.status === "sent");
    if (!successful.length) return;
    const nextCommand = successful.find((command) => !(order.history || []).some((event) => event.detail.includes(`任务ID：${command.id}`)));
    if (!nextCommand) return;
    const now = new Date().toISOString();
    updateOrder(
      {},
      createOrderHistoryEvent(nextCommand.status === "sent" ? "reply_generated" : "follow_up", outboundStatusLabels[nextCommand.status], `任务ID：${nextCommand.id}\n回复：${nextCommand.reply}`, now),
    );
    const nextMessages = getCustomerMessages().map((messageItem) =>
      messageItem.linkedOrderId === order.id || (order.customerFolder && messageItem.customerFolder === order.customerFolder)
        ? { ...messageItem, status: "已回复" as const, isNew: false, updatedAt: now }
        : messageItem,
    );
    saveCustomerMessages(nextMessages);
  }, [orderOutboundCommands, order?.id]);

  async function syncServerOrder() {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/orders", {
        cache: "no-store",
        headers: token ? { "x-webhook-token": token } : undefined,
      });
      const data = (await response.json()) as { orders?: Order[] };
      if (!response.ok || !Array.isArray(data.orders)) return;
      const serverOrders = data.orders.map(normalizeOrder);
      const merged = mergeOrders(getOrders().map(normalizeOrder), serverOrders).map((item) => (item.id === id ? { ...item, isNew: false } : item));
      setOrders(merged);
      saveOrders(merged);
    } catch {
      // Keep local detail behavior if server orders are unavailable.
    }
  }

  async function refreshOutboundCommands(silent = true) {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch(`/api/outbox?status=all&platform=${encodeURIComponent("闲鱼")}`, {
        cache: "no-store",
        headers: token ? { "x-webhook-token": token } : undefined,
      });
      const data = (await response.json()) as { commands?: OutboundReplyCommand[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "sync outbox failed");
      setOutboundCommands(safeArray(data.commands));
    } catch (error) {
      if (!silent) {
        const detail = error instanceof Error ? error.message : "同步发送状态失败";
        setMessage(`同步闲鱼发送状态失败：${detail}`);
      }
    }
  }

  async function retryOutboundCommand(command: OutboundReplyCommand) {
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/outbox", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({ id: command.id, status: "pending" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "retry failed");
      await refreshOutboundCommands(true);
      setMessage("???????????????????????????\????????\????????????");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "重试失败";
      setMessage(`重试闲鱼发送任务失败：${detail}`);
    }
  }

  function updateOrder(patch: Partial<Order>, historyEvent?: OrderHistoryEvent) {
    const next = orders.map((item) => {
      if (item.id !== id) return item;
      const now = new Date().toISOString();
      const history = [...(item.history || [])];
      if (patch.status && patch.status !== item.status && !historyEvent) {
        history.push(createOrderHistoryEvent("status_changed", "状态变更", `${item.status} -> ${patch.status}`, now));
      }
      if (historyEvent) history.push(historyEvent);
      return normalizeOrder({ ...item, ...patch, history, isNew: false, updatedAt: now });
    });
    setOrders(next);
    saveOrders(next);
  }

  function ensureTemplates() {
    const existing = getTemplates();
    const next = mergeDefaultTemplates(existing);
    if (next.length !== existing.length) saveTemplates(next);
    return next;
  }

  function ensureKnowledgeRules() {
    const existing = getKnowledgeRules();
    if (existing.length > 0) return existing;
    saveKnowledgeRules(defaultKnowledgeRules);
    return defaultKnowledgeRules;
  }

  function getOrderConversation(currentOrder: Order): ConversationTurn[] {
    const turns = currentOrder.conversation?.length
      ? currentOrder.conversation
      : [{ id: `${currentOrder.id}_initial`, role: "customer" as const, content: currentOrder.rawMessage, createdAt: currentOrder.createdAt }];
    return turns
      .map((turn) => ({
        id: safeString(turn.id) || `turn_${currentOrder.id}_${Date.now()}`,
        role: normalizeConversationRole(turn.role),
        content: safeString(turn.content),
        createdAt: safeString(turn.createdAt) || currentOrder.createdAt,
      }))
      .filter((turn) => turn.content.trim());
  }

  async function requestAnalysis(currentOrder: Order, options: { mode: "order-followup" | "regenerate"; latestMessage?: string }) {
    const settings = getSettings();
    const conversationHistory = getOrderConversation(currentOrder);
    const latestMessage = safeString(options.latestMessage);
    const templates = ensureTemplates();
    const knowledge = ensureKnowledgeRules();
    const payload = buildAnalyzePayload({
      chatText: currentOrder.rawMessage,
      businessType: currentOrder.businessType,
      settings,
      templates,
      knowledgeRules: knowledge,
      mode: options.mode,
      order: currentOrder,
      latestCustomerMessage: latestMessage,
      conversationHistory,
      platform: String(currentOrder.platform || ""),
    });
    const logBase = {
      orderId: currentOrder.id,
      mode: options.mode,
      businessType: currentOrder.businessType,
      platform: currentOrder.platform,
      historyLength: conversationHistory.length,
      originalMessageLength: safeString(currentOrder.rawMessage).length,
      latestMessageLength: latestMessage.length,
      itemsCount: currentOrder.analysis?.products?.length || 0,
      templatesCount: payload.enabledTemplates.length,
      hasKnowledge: payload.knowledgeRules.length > 0,
      hasSellerRules: Boolean(settings.merchantRules?.trim()),
      usedPromptVersion: promptVersion,
    };
    console.info("[order-detail/analyze] request started", logBase);
    let response: Response | undefined;
    try {
      response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as AnalyzeApiResponse;
      if (!response.ok || data.error) throw new Error(data.error || "AI analysis failed");
      console.info("[order-detail/analyze] request succeeded", { ...logBase, httpStatus: response.status });
      return mapAnalyzeResponse(data);
    } catch (error) {
      console.error("[order-detail/analyze] request failed", {
        ...logBase,
        httpStatus: response?.status,
        errorMessage: error instanceof Error ? error.message.slice(0, 180) : safeString(error).slice(0, 180),
      });
      throw error;
    }
  }

  async function analyzeFollowUp() {
    if (!order) return;
    const text = followUpText.trim();
    if (!text) return setMessage("请先粘贴客户新回复");
    setAnalyzing(true);
    setMessage("");
    try {
      const analysis = await requestAnalysis(order, { mode: "order-followup", latestMessage: text });
      const now = new Date().toISOString();
      const nextConversation: ConversationTurn[] = [
        ...(order.conversation || []),
        { id: `turn_${Date.now()}_customer`, role: "customer", content: text, createdAt: now },
      ];
      updateOrder(
        {
          analysis,
          summary: analysis.summary || order.summary,
          itemSummary: formatItemSummary(analysis.products) || order.itemSummary,
          status: mapOrderStatus(analysis.orderStatus, analysis.missingInfo),
          intentLevel: inferIntentLevel(analysis.urgency, analysis.missingInfo),
          rawMessage: `${order.rawMessage}\n\n[客户追问 ${new Date().toLocaleString()}]\n${text}`,
          conversation: nextConversation,
        },
        createOrderHistoryEvent("follow_up", "继续跟进", `客户新回复：${text}`, now),
      );
      setFollowUpText("");
      setMessage("已结合历史消息重新分析。推荐回复复制后才会写入连续对话。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请稍后重试";
      setMessage(`继续分析失败：${detail}`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function regenerateReply() {
    if (!order) return;
    setRegenerating(true);
    setMessage("");
    try {
      const analysis = await requestAnalysis(order, { mode: "regenerate" });
      updateOrder({
        analysis,
        summary: analysis.summary || order.summary,
        itemSummary: formatItemSummary(analysis.products) || order.itemSummary,
        status: mapOrderStatus(analysis.orderStatus, analysis.missingInfo),
        intentLevel: inferIntentLevel(analysis.urgency, analysis.missingInfo),
      });
      setReplyDraft(analysis.reply || "");
      setMessage("已重新生成候选回复。复制采用后才会写入连续对话。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请稍后重试";
      setMessage(`重新生成失败：${detail}`);
    } finally {
      setRegenerating(false);
    }
  }

  async function copyReply() {
    const reply = replyDraft || "";
    if (!reply.trim()) return setMessage("暂无可复制内容");
    const copied = await copyText(reply);
    if (!copied || !order) return setMessage("复制失败，请手动复制");
    const latestAssistant = [...(order.conversation || [])].reverse().find((turn) => turn.role === "assistant");
    if (latestAssistant?.content === reply) return setMessage("已复制推荐回复");
    const now = new Date().toISOString();
    updateOrder(
      {
        conversation: [
          ...(order.conversation || []),
          { id: `turn_${Date.now()}_assistant_sent`, role: "assistant", content: reply, createdAt: now },
        ],
      },
      createOrderHistoryEvent("reply_generated", "采用并复制推荐回复", reply, now),
    );
    setMessage("已复制推荐回复，并记入连续对话");
  }

  async function sendReplyToPlatform() {
    if (!order) return;
    if (String(order.platform) !== "闲鱼") return setMessage("当前先支持发送回闲鱼，其他平台等平台适配器接入后再开放。");
    if (!order.sourceUrl?.trim()) return setMessage("这条订单缺少原平台链接。请先从闲鱼插件同步消息进入工作台，或在客户画像里补上原平台链接。");
    const reply = replyDraft || "";
    if (!reply.trim()) return setMessage("暂无可发送的推荐回复，请先生成回复。");
    setSendingToPlatform(true);
    setMessage("");
    try {
      const token = await getWebhookTokenForClient();
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-webhook-token": token } : {}),
        },
        body: JSON.stringify({
          orderId: order.id,
          customerFolder: order.customerFolder || order.customerName,
          customerName: order.customerName,
          platform: order.platform,
          conversationId: order.conversationId || "",
          sourceUrl: order.sourceUrl,
          itemTitle: order.itemSummary || "",
          reply,
          mode: "fill",
        }),
      });
      const data = (await response.json()) as { command?: { id?: string }; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "创建发送任务失败");
      const now = new Date().toISOString();
      const latestAssistant = [...(order.conversation || [])].reverse().find((turn) => turn.role === "assistant");
      updateOrder(
        {
          conversation: latestAssistant?.content === reply
            ? order.conversation
            : [...(order.conversation || []), { id: `turn_${Date.now()}_assistant_outbox`, role: "assistant", content: reply, createdAt: now }],
        },
        createOrderHistoryEvent("follow_up", "已创建闲鱼发送任务", `任务ID：${data.command?.id || "待插件同步"}\n回复：${reply}`, now),
      );
      await refreshOutboundCommands(true);
      setMessage("Xianyu fill task created. Open the target customer chat, then use the extension to fill the input box and send manually.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "发送任务创建失败";
      setMessage(`发送回闲鱼失败：${detail}`);
    } finally {
      setSendingToPlatform(false);
    }
  }

  if (!order) {
    return (
      <div className="space-y-5">
        <Link className={secondaryButtonClass} href="/orders">返回客户订单</Link>
        <Section title="订单不存在">
          <p className="text-sm text-slate-500">这条订单可能已被清空或仍在加载。</p>
        </Section>
      </div>
    );
  }

  const products = order.analysis?.products || [];
  const itemSummary = products.length > 0 ? formatItemSummary(products) : order.itemSummary;
  const conversation = getOrderConversation(order);
  const history = order.history || [];
  const theme = getOrderTheme(order);

  return (
    <div className="space-y-5">
      <header className={`overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br ${theme.panel} p-5 shadow-xl ${theme.glow} ring-1 ring-slate-100 lg:p-7`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${theme.badge}`}>{businessTypeLabels[order.businessType]} · {order.status}</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 lg:text-4xl">{order.orderTitle || order.customerName}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">查看连续对话、推荐回复、订单历史和跟进备注。推荐回复复制后才会写入连续对话。</p>
        </div>
        <Link className={secondaryButtonClass} href="/orders">返回客户订单</Link>
        </div>
      </header>
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.25fr]">
        <Section title="客户画像">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="订单名称"><input className={inputClass} value={order.orderTitle || ""} onChange={(event) => updateOrder({ orderTitle: event.target.value })} /></Field>
            <Field label="客户昵称"><input className={inputClass} value={order.customerName} onChange={(event) => updateOrder({ customerName: event.target.value })} /></Field>
            <Field label="来源平台"><input className={inputClass} value={order.platform} onChange={(event) => updateOrder({ platform: event.target.value })} /></Field>
            <Field label="原平台链接"><input className={inputClass} value={order.sourceUrl || ""} onChange={(event) => updateOrder({ sourceUrl: event.target.value })} placeholder="闲鱼聊天页链接" /></Field>
            <Field label="业务类型"><input className={inputClass} value={businessTypeLabels[order.businessType]} readOnly /></Field>
            <Field label="意向等级">
              <select className={inputClass} value={order.intentLevel} onChange={(event) => updateOrder({ intentLevel: event.target.value as IntentLevel })}>
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </Field>
            <Field label="当前状态">
              <select className={inputClass} value={order.status} onChange={(event) => updateOrder({ status: event.target.value as OrderStatus })}>
                {orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="跟进备注"><textarea className={`${textareaClass} min-h-28`} value={order.note} onChange={(event) => updateOrder({ note: event.target.value })} /></Field>
          </div>
        </Section>

        <section className={`rounded-3xl border border-white/80 bg-gradient-to-br ${theme.panel} p-5 shadow-xl ${theme.glow} ring-1 ring-slate-100`}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${theme.chip}`}>AI Order Analysis</div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">需求摘要与推荐回复</h2>
            </div>
            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">{order.intentLevel}意向</span>
          </div>
          <InfoBlock title="客户诉求" content={order.analysis?.customerIntent || order.summary} />
          <InfoBlock title="商品/服务" content={itemSummary || "待确认"} />
          <div className="mb-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">推荐回复草稿</div>
            <textarea className={`${textareaClass} min-h-36 bg-emerald-50/90 text-emerald-950`} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="AI 生成后可在这里编辑，确认后再复制或创建闲鱼发送任务。" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" className={secondaryButtonClass} onClick={copyReply} disabled={!replyDraft.trim()}>复制推荐回复</button>
            <button type="button" className={secondaryButtonClass} onClick={sendReplyToPlatform} disabled={sendingToPlatform || !replyDraft.trim()}>{sendingToPlatform ? "创建发送任务中..." : "创建闲鱼发送任务"}</button>
            <button type="button" className={primaryButtonClass} onClick={regenerateReply} disabled={regenerating}>{regenerating ? "生成中..." : "重新生成推荐回复"}</button>
          </div>
          <div className="mt-4 rounded-2xl border border-white bg-white/90 p-4 text-sm shadow-sm ring-1 ring-slate-100">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-950">闲鱼发送状态</div>
              <button type="button" className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => refreshOutboundCommands(false)}>刷新</button>
            </div>
            {orderOutboundCommands.length ? (
              <div className="mt-3 space-y-2">
                {orderOutboundCommands.slice(0, 3).map((command) => (
                  <div key={command.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getOutboundStatusClass(command.status)}`}>{outboundStatusLabels[command.status]}</span>
                      <span className="text-xs text-slate-500">{getOutboundModeLabel(command.mode)} · {formatDateTime(command.updatedAt)}</span>
                    </div>
                    <div className="mt-2 line-clamp-2 whitespace-pre-line text-slate-700">{command.reply}</div>
                    {command.error ? <div className="mt-2 text-xs font-medium text-rose-600">{command.error}</div> : null}
                    {command.status === "failed" || command.status === "cancelled" ? (
                      <button type="button" className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => retryOutboundCommand(command)}>重试</button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">还没有发送回闲鱼的任务。</div>
            )}
          </div>
        </section>
      </div>

      <Section title="继续跟进" description="客户又回复时，把新消息粘到这里。AI 会带着前面的订单信息和历史对话一起分析。">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px] lg:items-end">
          <Field label="客户新回复">
            <textarea className={`${textareaClass} min-h-28`} value={followUpText} onChange={(event) => setFollowUpText(event.target.value)} placeholder="例如：那明天中午前能做好吗？可以便宜一点吗？" />
          </Field>
          <button type="button" className={primaryButtonClass} onClick={analyzeFollowUp} disabled={analyzing || !followUpText.trim()}>
            {analyzing ? "分析中..." : "结合历史再分析"}
          </button>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="缺失信息"><SimpleList items={order.analysis?.missingInfo || []} empty="暂无明显缺失" tone="amber" /></Section>
        <Section title="风险点"><SimpleList items={order.analysis?.risks || []} empty="暂无明显风险" tone="rose" /></Section>
        <Section title="下一步动作"><SimpleList items={order.analysis?.nextActions || []} empty="暂无下一步动作" tone="sky" /></Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <Section title="连续对话">
          <div className="space-y-3">
            {conversation.map((turn) => (
              <div key={turn.id} className={`rounded-2xl border p-4 text-sm shadow-sm ${turn.role === "assistant" ? "border-emerald-100 bg-emerald-50 text-emerald-950" : turn.role === "seller_note" ? "border-sky-100 bg-sky-50 text-sky-950" : "border-white bg-white/90 text-slate-700 ring-1 ring-slate-100"}`}>
                <div className="mb-2 inline-flex rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-500 shadow-sm">{turn.role === "assistant" ? "最终回复" : turn.role === "seller_note" ? "商家备注" : "客户消息"}</div>
                <div className="whitespace-pre-wrap leading-6">{turn.content}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="订单历史">
          <div className="space-y-3">
            {(history.length ? history : [createOrderHistoryEvent("created", "订单创建", order.summary, order.createdAt)]).map((event) => (
              <div key={event.id} className="rounded-2xl border border-white bg-white/90 p-4 text-sm shadow-sm ring-1 ring-slate-100">
                <div className="font-semibold text-slate-950">{event.title}</div>
                <div className="mt-1 text-xs text-slate-400">{formatDateTime(event.createdAt)}</div>
                <div className="mt-2 whitespace-pre-wrap leading-6 text-slate-700">{event.detail}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function mapAnalyzeResponse(data: AnalyzeApiResponse): AnalyzeResult {
  const confidenceMap = { high: "高", medium: "中", low: "低" } as const;
  return {
    customerIntent: data.customer_intent,
    products: safeArray(data.items).map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, notes: item.note, confidence: confidenceMap[item.confidence] })),
    missingInfo: safeArray(data.missing_info),
    risks: safeArray(data.risk_flags),
    nextActions: safeArray(data.next_action),
    reply: data.reply,
    summary: data.summary,
    customerName: data.customer_info?.name || "待填写客户",
    platform: data.customer_info?.platform || "未识别",
    orderStatus: data.order_status,
    urgency: data.urgency,
  };
}

async function copyText(text: string) {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function InfoBlock({ title, content, strong = false }: { title: string; content: string; strong?: boolean }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-sm font-semibold text-slate-800">{title}</div>
      <div className={`whitespace-pre-line rounded-2xl border p-4 text-sm leading-6 shadow-sm ${strong ? "border-emerald-100 bg-emerald-50 text-emerald-950" : "border-white bg-white/85 text-slate-700 ring-1 ring-slate-100"}`}>{content}</div>
    </div>
  );
}

function SimpleList({ items, empty, tone }: { items: string[]; empty: string; tone: "amber" | "rose" | "sky" }) {
  const toneClass = {
    amber: "border-amber-100 bg-amber-50/80 text-amber-950",
    rose: "border-rose-100 bg-rose-50/80 text-rose-950",
    sky: "border-sky-100 bg-sky-50/80 text-sky-950",
  }[tone];
  return <ul className="space-y-2 text-sm">{(items.length ? items : [empty]).map((item) => <li key={item} className={`rounded-2xl border p-3 leading-6 shadow-sm ${toneClass}`}>{item}</li>)}</ul>;
}
