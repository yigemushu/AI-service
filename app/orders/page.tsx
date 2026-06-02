"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { StatsCards } from "@/components/StatsCards";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, orderStatuses } from "@/lib/constants";
import { demoOrders } from "@/lib/demoData";
import { calculateStats, matchesOrderFilters, normalizeOrder } from "@/lib/orderUtils";
import { getOrders, saveOrders } from "@/lib/storage";
import type { BusinessType, IntentLevel, Order, OrderStatus } from "@/lib/types";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [businessType, setBusinessType] = useState<"all" | BusinessType>("all");
  const [intentLevel, setIntentLevel] = useState<"all" | IntentLevel>("all");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    const storedOrders = getOrders().map(normalizeOrder);
    setOrders(storedOrders);
    saveOrders(storedOrders);
  }, []);

  const filteredOrders = useMemo(() => orders.filter((order) => matchesOrderFilters(order, { status, businessType, intentLevel, keyword })), [orders, status, businessType, intentLevel, keyword]);
  const stats = useMemo(() => calculateStats(orders), [orders]);

  function persist(next: Order[]) {
    setOrders(next);
    saveOrders(next);
  }

  function updateOrder(id: string, patch: Partial<Order>) {
    persist(orders.map((order) => (order.id === id ? { ...order, ...patch, isNew: false, updatedAt: new Date().toISOString() } : order)));
  }

  function loadDemoData() {
    const existing = getOrders().filter((order) => !order.id.startsWith("demo_"));
    persist([...demoOrders, ...existing]);
  }

  function exportCsv() {
    const headers = ["客户昵称", "来源平台", "业务类型", "需求摘要", "商品/服务", "状态", "意向等级", "备注"];
    const rows = filteredOrders.map((order) => [order.customerName, order.platform, businessTypeLabels[order.businessType], order.summary, order.itemSummary, order.status, order.intentLevel, order.note]);
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

      <StatsCards stats={stats} />

      <Section title="筛选">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="状态">
            <select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as "all" | OrderStatus)}>
              <option value="all">全部状态</option>
              {orderStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="业务类型">
            <select className={inputClass} value={businessType} onChange={(event) => setBusinessType(event.target.value as "all" | BusinessType)}>
              <option value="all">全部业务</option>
              {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="意向等级">
            <select className={inputClass} value={intentLevel} onChange={(event) => setIntentLevel(event.target.value as "all" | IntentLevel)}>
              <option value="all">全部意向</option>
              <option value="高">高</option>
              <option value="中">中</option>
              <option value="低">低</option>
            </select>
          </Field>
          <Field label="关键词">
            <input className={inputClass} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="客户、商品、备注..." />
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
                <div className="grid gap-3 lg:grid-cols-[1fr_1fr_160px_130px] lg:items-start">
                  <div>
                    <div className="font-semibold text-slate-950">{order.customerName}</div>
                    <div className="mt-1 text-sm text-slate-500">{order.platform} · {businessTypeLabels[order.businessType]}</div>
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
