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

  const filteredOrders = useMemo(
    () => orders.filter((order) => matchesOrderFilters(order, { status, businessType, intentLevel, keyword })),
    [orders, status, businessType, intentLevel, keyword],
  );
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

  function clearDemoData() {
    if (!window.confirm("确认清空演示数据吗？你自己保存的非演示订单会保留。")) return;
    persist(getOrders().filter((order) => !order.id.startsWith("demo_")));
  }

  function exportCsv() {
    const headers = ["客户昵称", "来源平台", "业务类型", "需求摘要", "商品/服务", "状态", "意向等级", "缺失信息", "风险点", "备注", "创建时间", "更新时间"];
    const rows = filteredOrders.map((order) => [
      order.customerName,
      order.platform,
      businessTypeLabels[order.businessType],
      order.summary,
      order.itemSummary,
      order.status,
      order.intentLevel,
      order.analysis?.missingInfo?.join("；") || "",
      order.analysis?.risks?.join("；") || "",
      order.note,
      new Date(order.createdAt).toLocaleString("zh-CN"),
      new Date(order.updatedAt).toLocaleString("zh-CN"),
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `客户订单-${new Date().toISOString().slice(0, 10)}.csv`;
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
          <button className={secondaryButtonClass} onClick={clearDemoData}>清空演示数据</button>
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
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-slate-500">
                  {["客户", "平台", "业务", "需求摘要", "商品/服务", "状态", "意向", "时间", "备注"].map((head) => (
                    <th key={head} className="border-b border-slate-200 px-3 py-2 font-medium">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id} className={`align-top ${order.isNew ? "bg-red-50" : order.intentLevel === "高" ? "bg-amber-50" : ""}`}>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <input className={inputClass} value={order.customerName} onChange={(event) => updateOrder(order.id, { customerName: event.target.value })} />
                      <div className="mt-2 flex gap-1">
                        {order.isNew ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">新</span> : null}
                        {order.intentLevel === "高" ? <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">高意向</span> : null}
                      </div>
                      <Link className="mt-2 inline-flex text-sm font-medium text-slate-950 underline-offset-4 hover:underline" href={`/orders/${order.id}`}>
                        查看详情
                      </Link>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{order.platform}</td>
                    <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{businessTypeLabels[order.businessType]}</td>
                    <td className="max-w-xs border-b border-slate-100 px-3 py-3 text-slate-800">{order.summary}</td>
                    <td className="max-w-xs border-b border-slate-100 px-3 py-3 text-slate-700">{order.itemSummary}</td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <select className={inputClass} value={order.status} onChange={(event) => updateOrder(order.id, { status: event.target.value as OrderStatus })}>
                        {orderStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <select className={inputClass} value={order.intentLevel} onChange={(event) => updateOrder(order.id, { intentLevel: event.target.value as IntentLevel })}>
                        <option value="高">高</option>
                        <option value="中">中</option>
                        <option value="低">低</option>
                      </select>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-slate-500">
                      <div>跟进：{new Date(order.updatedAt).toLocaleString("zh-CN")}</div>
                      <div className="mt-1">创建：{new Date(order.createdAt).toLocaleString("zh-CN")}</div>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <textarea className={`${textareaClass} min-h-20`} value={order.note} onChange={(event) => updateOrder(order.id, { note: event.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function csvCell(value: string) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}
