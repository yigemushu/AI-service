"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { StatsCards, type StatsCardKey } from "@/components/StatsCards";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, orderStatuses } from "@/lib/constants";
import { demoOrders } from "@/lib/demoData";
import { createOrderHistoryEvent, calculateStats, matchesOrderFilters, normalizeOrder } from "@/lib/orderUtils";
import { createId, getCustomerMessages, getOrders, saveCustomerMessages, saveOrders } from "@/lib/storage";
import type { AnalyzeResult, BusinessType, ConversationTurn, CustomerMessage, IntentLevel, Order, OrderStatus } from "@/lib/types";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [businessType, setBusinessType] = useState<"all" | BusinessType>("all");
  const [intentLevel, setIntentLevel] = useState<"all" | IntentLevel>("all");
  const [keyword, setKeyword] = useState("");
  const [statFilter, setStatFilter] = useState<StatsCardKey | null>(null);

  useEffect(() => {
    const synced = syncMessageFoldersToOrders();
    setOrders(synced);
    saveOrders(synced);
  }, []);

  const filteredOrders = useMemo(
    () => orders.filter((order) => matchesOrderFilters(order, { status, businessType, intentLevel, keyword }) && matchesStatFilter(order, statFilter)),
    [orders, status, businessType, intentLevel, keyword, statFilter],
  );
  const stats = useMemo(() => calculateStats(orders), [orders]);

  function persist(next: Order[]) {
    setOrders(next);
    saveOrders(next);
  }

  function updateOrder(id: string, patch: Partial<Order>) {
    persist(orders.map((order) => {
      if (order.id !== id) return order;
      const now = new Date().toISOString();
      const history = [...(order.history || [])];
      if (patch.status && patch.status !== order.status) {
        history.push(createOrderHistoryEvent("status_changed", "状态变更", `${order.status} -> ${patch.status}`, now));
      }
      return { ...order, ...patch, history, isNew: false, updatedAt: now };
    }));
  }

  function completeOrder(id: string) {
    const target = orders.find((order) => order.id === id);
    const now = new Date().toISOString();
    persist(orders.map((order) => (order.id === id ? {
      ...order,
      status: "已完成",
      isNew: false,
      updatedAt: now,
      history: [
        ...(order.history || []),
        createOrderHistoryEvent("completed", "订单完成", `从 ${target?.status || "未知状态"} 标记为已完成`, now),
      ],
    } : order)));
  }

  function deleteOrder(id: string) {
    const target = orders.find((order) => order.id === id);
    const confirmed = window.confirm(`确定要删除这条客户记录吗？\n\n客户：${target?.customerName || "未识别客户"}\n订单：${target?.orderTitle || target?.summary || "未命名订单"}\n\n删除后无法恢复。`);
    if (!confirmed) return;
    persist(orders.filter((order) => order.id !== id));
  }

  function loadDemoData() {
    const existing = getOrders().filter((order) => !order.id.startsWith("demo_"));
    persist([...demoOrders, ...existing]);
  }

  function selectStatFilter(key: StatsCardKey) {
    setStatFilter((current) => (current === key ? null : key));
    setStatus("all");
    setBusinessType("all");
    setIntentLevel("all");
    setKeyword("");
  }

  function clearStatFilter() {
    setStatFilter(null);
  }

  function exportCsv() {
    const headers = ["订单名称", "客户昵称", "来源平台", "业务类型", "需求摘要", "商品/服务", "状态", "意向等级", "备注"];
    const rows = filteredOrders.map((order) => [order.orderTitle, order.customerName, order.platform, businessTypeLabels[order.businessType], order.summary, order.itemSummary, order.status, order.intentLevel, order.note]);
    const csv = "﻿" + [headers, ...rows].map((row) => row.map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customer-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">客户订单</h1>
          <p className="mt-1 text-sm text-slate-500">筛选客户、跟进状态、沉淀备注，并导出给团队复盘。</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className={secondaryButtonClass} onClick={loadDemoData}>加载演示数据</button>
          <button className={primaryButtonClass} onClick={exportCsv}>导出 CSV</button>
        </div>
      </header>

      <StatsCards stats={stats} activeKey={statFilter} onSelect={selectStatFilter} />

      {statFilter ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
          <span>正在查看：{statFilterLabels[statFilter]}，共 {filteredOrders.length} 条。</span>
          <button className="font-semibold underline-offset-4 hover:underline" onClick={clearStatFilter}>查看全部客户</button>
        </div>
      ) : null}

      <Section title="筛选">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="状态">
            <select className={inputClass} value={status} onChange={(event) => { clearStatFilter(); setStatus(event.target.value as "all" | OrderStatus); }}>
              <option value="all">全部状态</option>
              {orderStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="业务类型">
            <select className={inputClass} value={businessType} onChange={(event) => { clearStatFilter(); setBusinessType(event.target.value as "all" | BusinessType); }}>
              <option value="all">全部业务</option>
              {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="意向等级">
            <select className={inputClass} value={intentLevel} onChange={(event) => { clearStatFilter(); setIntentLevel(event.target.value as "all" | IntentLevel); }}>
              <option value="all">全部意向</option>
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
          </Field>
          <Field label="关键词">
            <input className={inputClass} value={keyword} onChange={(event) => { clearStatFilter(); setKeyword(event.target.value); }} placeholder="客户、商品、备注..." />
          </Field>
        </div>
      </Section>

      <Section title={`客户记录（${filteredOrders.length}）`}>
        {filteredOrders.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">暂无匹配记录，可先在工作台保存订单，或加载演示数据。</div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <article key={order.id} className={`rounded-md border border-slate-200 p-4 ${order.isNew ? "bg-red-50" : "bg-white"}`}>
                <div className="grid gap-3 lg:grid-cols-[1fr_1fr_160px_130px_210px] lg:items-start">
                  <div>
                    <div className="font-semibold text-slate-950">{order.orderTitle || order.customerName}</div>
                    <div className="mt-1 text-sm text-slate-500">{order.platform} · {businessTypeLabels[order.businessType]}</div>
                    <div className="mt-1 text-xs text-slate-400">客户：{order.customerName}</div>
                    <Link className="mt-2 inline-flex text-sm font-medium text-slate-950 underline-offset-4 hover:underline" href={`/orders/${order.id}`}>查看详情</Link>
                  </div>
                  <div className="text-sm text-slate-700">
                    <div>{order.summary}</div>
                    <div className="mt-1 text-slate-500">{order.itemSummary}</div>
                  </div>
                  <select className={inputClass} value={order.status} onChange={(event) => updateOrder(order.id, { status: event.target.value as OrderStatus })}>
                    {orderStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={inputClass} value={order.intentLevel} onChange={(event) => updateOrder(order.id, { intentLevel: event.target.value as IntentLevel })}>
                    <option value="高">高</option>
                    <option value="中">中</option>
                    <option value="低">低</option>
                  </select>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <button
                      className={`${order.status === "已完成" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : secondaryButtonClass} min-h-10`}
                      onClick={() => completeOrder(order.id)}
                      disabled={order.status === "已完成"}
                    >
                      {order.status === "已完成" ? "已完成" : "完成"}
                    </button>
                    <button className="min-h-10 rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50" onClick={() => deleteOrder(order.id)}>
                      删除
                    </button>
                  </div>
                </div>
                <textarea className={`${textareaClass} mt-3 min-h-20`} value={order.note} onChange={(event) => updateOrder(order.id, { note: event.target.value })} placeholder="跟进备注" />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function getFolderName(message: Pick<CustomerMessage, "customerFolder" | "customerName">) {
  return (message.customerFolder || message.customerName || "待归类").trim() || "待归类";
}

function getMessageConversation(message: CustomerMessage): ConversationTurn[] {
  return message.conversation?.length
    ? message.conversation
    : [{ id: `${message.id}_initial`, role: "customer", content: message.rawMessage, createdAt: message.createdAt }];
}

function groupCustomerMessages(messages: CustomerMessage[]) {
  const groups = new Map<string, CustomerMessage[]>();
  for (const message of messages) {
    if (message.status === "无效咨询") continue;
    const key = `${message.platform}::${getFolderName(message)}`;
    groups.set(key, [...(groups.get(key) || []), message]);
  }
  return [...groups.values()].map((items) => items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

function fallbackAnalysis(message: CustomerMessage): AnalyzeResult {
  const productName = message.productName || message.productGuess || "待确认需求";
  return {
    customerIntent: "客户发来新咨询，等待在客户订单中分析。",
    products: [{ name: productName, quantity: "1", unit: "项", notes: "由消息中心同步", confidence: productName === "待确认需求" ? "低" : "中" }],
    missingInfo: ["需要在客户订单中结合完整聊天分析"],
    risks: ["请先核对客户真实需求，不要自动承诺价格、时效或结果。"],
    nextActions: ["进入订单详情继续分析", "生成推荐回复"],
    reply: "我先看下你的需求，确认好后回复你哈~",
    summary: message.rawMessage.slice(0, 80) || "客户新咨询",
    customerName: message.customerName,
    platform: String(message.platform || "未识别"),
    orderStatus: "待确认",
    urgency: "medium",
  };
}

function buildOrderFromMessageGroup(messages: CustomerMessage[], existingOrder?: Order) {
  const latest = messages[0];
  const folder = getFolderName(latest);
  const analysis = existingOrder?.analysis || latest.analysis || fallbackAnalysis(latest);
  const itemSummary = latest.productName || latest.productGuess || existingOrder?.itemSummary || formatProducts(analysis);
  const now = new Date().toISOString();
  return normalizeOrder({
    ...(existingOrder || {}),
    id: existingOrder?.id || createId("order"),
    orderTitle: existingOrder?.orderTitle || `${folder} - ${itemSummary || "待确认需求"}`,
    customerFolder: folder,
    customerName: latest.customerName || folder,
    platform: latest.platform || analysis.platform || "未识别",
    businessType: latest.businessType,
    summary: analysis.summary || latest.rawMessage.slice(0, 80),
    itemSummary: itemSummary || "待确认",
    status: existingOrder?.status || mapStatusFromMessage(latest),
    intentLevel: existingOrder?.intentLevel || (analysis.urgency === "high" ? "高" : "中"),
    note: existingOrder?.note || `来源消息：${latest.platform}`,
    createdAt: existingOrder?.createdAt || latest.createdAt || now,
    updatedAt: now,
    isNew: latest.isNew,
    rawMessage: messages.map((message) => message.rawMessage).join("\n\n"),
    analysis,
    conversation: messages.flatMap(getMessageConversation).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    history: existingOrder?.history || [createOrderHistoryEvent("created", "从消息中心同步订单", `客户文件夹：${folder}\n消息数：${messages.length}`, now)],
  });
}

function formatProducts(analysis: AnalyzeResult) {
  return analysis.products.map((item) => `${item.name}${item.quantity ? ` x${item.quantity}${item.unit || ""}` : ""}`).join("、") || "待确认";
}

function mapStatusFromMessage(message: CustomerMessage): OrderStatus {
  if (message.status === "待补信息") return "待补充";
  if (message.status === "已成单") return "待确认";
  return "待确认";
}

function syncMessageFoldersToOrders() {
  const messages = getCustomerMessages();
  const orders = getOrders().map(normalizeOrder);
  if (messages.length === 0) return orders;

  let nextOrders = [...orders];
  let changedOrders = false;
  const nextMessages = [...messages];

  for (const group of groupCustomerMessages(messages)) {
    const latest = group[0];
    const folder = getFolderName(latest);
    const existingOrder =
      nextOrders.find((order) => group.some((message) => message.linkedOrderId === order.id)) ||
      nextOrders.find((order) => (order.customerFolder || order.customerName) === folder && order.platform === latest.platform && order.status !== "已完成");
    if (existingOrder) {
      const linked = group.some((message) => message.linkedOrderId === existingOrder.id);
      if (!linked) {
        for (let index = 0; index < nextMessages.length; index += 1) {
          if (getFolderName(nextMessages[index]) === folder && nextMessages[index].platform === latest.platform) {
            nextMessages[index] = { ...nextMessages[index], linkedOrderId: existingOrder.id };
          }
        }
        changedOrders = true;
      }
      continue;
    }

    const order = buildOrderFromMessageGroup(group);
    nextOrders = [order, ...nextOrders];
    for (let index = 0; index < nextMessages.length; index += 1) {
      if (getFolderName(nextMessages[index]) === folder && nextMessages[index].platform === latest.platform) {
        nextMessages[index] = { ...nextMessages[index], linkedOrderId: order.id };
      }
    }
    changedOrders = true;
  }

  if (changedOrders) saveCustomerMessages(nextMessages);
  return nextOrders.map(normalizeOrder);
}

const statFilterLabels: Record<StatsCardKey, string> = {
  todayNew: "今日新增客户",
  missingInfo: "待补信息",
  pendingQuote: "待报价",
  highIntent: "高意向客户",
  afterSales: "售后中",
};

function matchesStatFilter(order: Order, statFilter: StatsCardKey | null) {
  if (!statFilter) return true;
  const normalized = normalizeOrder(order);
  if (statFilter === "todayNew") return new Date(normalized.createdAt).toDateString() === new Date().toDateString();
  if (statFilter === "missingInfo") return normalized.status === "待补充" || (normalized.analysis?.missingInfo || []).length > 0;
  if (statFilter === "pendingQuote") return normalized.status === "待报价";
  if (statFilter === "highIntent") return normalized.intentLevel === "高";
  if (statFilter === "afterSales") return normalized.status === "售后中";
  return true;
}
