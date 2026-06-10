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
import { getOrders, saveOrders } from "@/lib/storage";
import type { BusinessType, IntentLevel, Order, OrderStatus } from "@/lib/types";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [businessType, setBusinessType] = useState<"all" | BusinessType>("all");
  const [intentLevel, setIntentLevel] = useState<"all" | IntentLevel>("all");
  const [keyword, setKeyword] = useState("");
  const [statFilter, setStatFilter] = useState<StatsCardKey | null>(null);

  useEffect(() => {
    const storedOrders = getOrders().map(normalizeOrder);
    setOrders(storedOrders);
    saveOrders(storedOrders);
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
                <div className="grid gap-3 lg:grid-cols-[1fr_1fr_160px_130px_120px] lg:items-start">
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
                  <button
                    className={`${order.status === "已完成" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : secondaryButtonClass} min-h-10`}
                    onClick={() => completeOrder(order.id)}
                    disabled={order.status === "已完成"}
                  >
                    {order.status === "已完成" ? "已完成" : "完成"}
                  </button>
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
