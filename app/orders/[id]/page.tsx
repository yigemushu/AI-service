"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultKnowledgeRules, defaultTemplates, mergeDefaultTemplates, orderStatuses } from "@/lib/constants";
import { formatItemSummary } from "@/lib/format";
import { createOrderHistoryEvent, inferIntentLevel, mapOrderStatus, normalizeOrder } from "@/lib/orderUtils";
import { getKnowledgeRules, getOrders, getSettings, getTemplates, saveKnowledgeRules, saveOrders, saveTemplates } from "@/lib/storage";
import type { AnalyzeApiResponse, AnalyzeResult, ConversationTurn, IntentLevel, Order, OrderHistoryEvent, OrderStatus } from "@/lib/types";

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [followUpText, setFollowUpText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const order = useMemo(() => orders.find((item) => item.id === id), [orders, id]);

  useEffect(() => {
    const normalized = getOrders().map(normalizeOrder);
    const next = normalized.map((item) => (item.id === id ? { ...item, isNew: false } : item));
    setOrders(next);
    saveOrders(next);
  }, [id]);

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

  function buildConversationHistory(currentOrder: Order) {
    const turns = currentOrder.conversation?.length
      ? currentOrder.conversation
      : [{ id: `${currentOrder.id}_initial`, role: "customer" as const, content: currentOrder.rawMessage, createdAt: currentOrder.createdAt }];
    return turns
      .map((turn, index) => {
        const roleLabel = turn.role === "assistant" ? "最终回复" : turn.role === "seller_note" ? "商家备注" : "客户消息";
        return `${index + 1}. ${roleLabel}：${turn.content}`;
      })
      .join("\n");
  }

  function buildContextText(currentOrder: Order, nextCustomerMessage: string) {
    return [
      "下面是同一个客户的连续对话。请结合历史上下文分析最新一条客户消息，不要把它当成全新的客户。",
      "连续对话里的 assistant 内容代表商家最终采用并复制出去的回复；重新生成但未复制的候选回复不算历史消息。",
      "最新客户消息可能是在补充上一轮缺失信息。请先判断哪些缺失信息已经被补齐，并从 missing_info 中移除，不要重复询问客户已经补充过的内容。",
      "如果客户补齐了用途、语气、截止时间、事件经过等信息，推荐回复只需要追问仍然缺少的字段，或者进入报价/确认下一步。",
      "",
      "历史对话：",
      buildConversationHistory(currentOrder),
      "",
      "当前订单已有信息：",
      `订单名称：${currentOrder.orderTitle || ""}`,
      `客户：${currentOrder.customerName}`,
      `平台：${currentOrder.platform}`,
      `业务类型：${businessTypeLabels[currentOrder.businessType]}`,
      `已识别商品/服务：${currentOrder.itemSummary}`,
      `当前状态：${currentOrder.status}`,
      `上一轮缺失信息：${safeArray(currentOrder.analysis?.missingInfo).join("、") || "暂无"}`,
      "",
      "最新客户消息：",
      nextCustomerMessage,
    ].join("\n");
  }

  function buildRegenerateText(currentOrder: Order) {
    return [
      "请基于同一个客户的完整历史对话，重新生成一版更自然、更适合直接发送的推荐回复。",
      "不要新增客户没有说过的承诺，不要自动发送。",
      "注意：这次只是生成候选回复，除非用户复制采用，否则不要把候选回复当作历史消息。",
      "",
      "历史对话：",
      buildConversationHistory(currentOrder),
      "",
      "当前订单信息：",
      `订单名称：${currentOrder.orderTitle || ""}`,
      `客户：${currentOrder.customerName}`,
      `平台：${currentOrder.platform}`,
      `业务类型：${businessTypeLabels[currentOrder.businessType]}`,
      `商品/服务：${currentOrder.itemSummary}`,
      `当前状态：${currentOrder.status}`,
      `当前缺失信息：${safeArray(currentOrder.analysis?.missingInfo).join("、") || "暂无"}`,
      `当前风险点：${safeArray(currentOrder.analysis?.risks).join("、") || "暂无"}`,
      "",
      "请重点优化 reply 字段，让它短一点、像真人商家、有温度、能直接复制给客户。",
    ].join("\n");
  }

  async function requestAnalysis(chatText: string, currentOrder: Order) {
    const settings = getSettings();
    const enabledTemplates = ensureTemplates()
      .filter((template) => template.enabled && template.businessType === currentOrder.businessType)
      .map(({ name, scenario, requiredInfo, content }) => ({ name, scenario, requiredInfo, content }));
    const knowledgeRules = ensureKnowledgeRules()
      .filter((rule) => rule.enabled && (rule.businessType === "all" || rule.businessType === currentOrder.businessType))
      .map(({ title, category, content }) => ({ title, category, content }));
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatText,
        businessType: currentOrder.businessType,
        systemPrompt: settings.systemPrompt,
        sellerRules: settings.merchantRules,
        enabledTemplates,
        knowledgeRules,
        responseMode: "fast",
      }),
    });
    const data = (await response.json()) as AnalyzeApiResponse;
    if (!response.ok || data.error) throw new Error(data.error || "AI analysis failed");
    return mapAnalyzeResponse(data);
  }

  async function analyzeFollowUp() {
    if (!order) return;
    const text = followUpText.trim();
    if (!text) return setMessage("请先粘贴客户新回复");
    setAnalyzing(true);
    setMessage("");
    try {
      const analysis = await requestAnalysis(buildContextText(order, text), order);
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
    } catch {
      setMessage("继续分析失败，请稍后重试");
    } finally {
      setAnalyzing(false);
    }
  }

  async function regenerateReply() {
    if (!order) return;
    setRegenerating(true);
    setMessage("");
    try {
      const analysis = await requestAnalysis(buildRegenerateText(order), order);
      const now = new Date().toISOString();
      updateOrder(
        {
          analysis,
          summary: analysis.summary || order.summary,
          itemSummary: formatItemSummary(analysis.products) || order.itemSummary,
          status: mapOrderStatus(analysis.orderStatus, analysis.missingInfo),
          intentLevel: inferIntentLevel(analysis.urgency, analysis.missingInfo),
        },
        createOrderHistoryEvent("reply_generated", "重新生成候选回复", analysis.reply, now),
      );
      setMessage("已重新生成候选回复。复制采用后才会写入连续对话。");
    } catch {
      setMessage("重新生成失败，请稍后重试");
    } finally {
      setRegenerating(false);
    }
  }

  async function copyReply() {
    const reply = order?.analysis?.reply || "";
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
  const conversation = order.conversation?.length
    ? order.conversation
    : [{ id: `${order.id}_initial`, role: "customer" as const, content: order.rawMessage, createdAt: order.createdAt }];
  const history = order.history || [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">订单详情</h1>
          <p className="mt-1 text-sm text-slate-500">查看连续对话、推荐回复、订单历史和跟进备注。</p>
        </div>
        <Link className={secondaryButtonClass} href="/orders">返回客户订单</Link>
      </header>
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Section title="客户画像">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="订单名称"><input className={inputClass} value={order.orderTitle || ""} onChange={(event) => updateOrder({ orderTitle: event.target.value })} /></Field>
            <Field label="客户昵称"><input className={inputClass} value={order.customerName} onChange={(event) => updateOrder({ customerName: event.target.value })} /></Field>
            <Field label="来源平台"><input className={inputClass} value={order.platform} onChange={(event) => updateOrder({ platform: event.target.value })} /></Field>
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

        <Section title="需求摘要">
          <InfoBlock title="客户诉求" content={order.analysis?.customerIntent || order.summary} />
          <InfoBlock title="商品/服务" content={itemSummary || "待确认"} />
          <InfoBlock title="推荐回复草稿" content={order.analysis?.reply || "暂无"} strong />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button className={secondaryButtonClass} onClick={copyReply} disabled={!order.analysis?.reply?.trim()}>复制推荐回复</button>
            <button className={primaryButtonClass} onClick={regenerateReply} disabled={regenerating}>{regenerating ? "生成中..." : "重新生成推荐回复"}</button>
          </div>
        </Section>
      </div>

      <Section title="继续跟进" description="客户又回复时，把新消息粘到这里。AI 会带着前面的订单信息和历史对话一起分析。">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px] lg:items-end">
          <Field label="客户新回复">
            <textarea className={`${textareaClass} min-h-28`} value={followUpText} onChange={(event) => setFollowUpText(event.target.value)} placeholder="例如：那明天中午前能做好吗？可以便宜一点吗？" />
          </Field>
          <button className={primaryButtonClass} onClick={analyzeFollowUp} disabled={analyzing || !followUpText.trim()}>
            {analyzing ? "分析中..." : "结合历史再分析"}
          </button>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="缺失信息"><SimpleList items={order.analysis?.missingInfo || []} empty="暂无明显缺失" /></Section>
        <Section title="风险点"><SimpleList items={order.analysis?.risks || []} empty="暂无明显风险" /></Section>
        <Section title="下一步动作"><SimpleList items={order.analysis?.nextActions || []} empty="暂无下一步动作" /></Section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <Section title="连续对话">
          <div className="space-y-3">
            {conversation.map((turn) => (
              <div key={turn.id} className={`rounded-md border p-3 text-sm ${turn.role === "assistant" ? "border-emerald-100 bg-emerald-50 text-emerald-950" : "border-amber-100 bg-white text-slate-700"}`}>
                <div className="mb-1 text-xs font-semibold text-slate-500">{turn.role === "assistant" ? "最终回复" : turn.role === "seller_note" ? "商家备注" : "客户消息"}</div>
                <div className="whitespace-pre-wrap leading-6">{turn.content}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="订单历史">
          <div className="space-y-3">
            {(history.length ? history : [createOrderHistoryEvent("created", "订单创建", order.summary, order.createdAt)]).map((event) => (
              <div key={event.id} className="rounded-md border border-amber-100 bg-white p-3 text-sm">
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
      <div className={`whitespace-pre-line rounded-md border border-amber-100 p-3 text-sm leading-6 ${strong ? "bg-emerald-50 text-emerald-950" : "bg-white text-slate-700"}`}>{content}</div>
    </div>
  );
}

function SimpleList({ items, empty }: { items: string[]; empty: string }) {
  return <ul className="space-y-2 text-sm text-slate-700">{(items.length ? items : [empty]).map((item) => <li key={item} className="rounded-md border border-amber-100 bg-white p-2">{item}</li>)}</ul>;
}
