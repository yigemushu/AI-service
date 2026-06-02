"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, orderStatuses } from "@/lib/constants";
import { formatItemSummary } from "@/lib/format";
import { normalizeOrder } from "@/lib/orderUtils";
import { getOrders, saveOrders } from "@/lib/storage";
import type { IntentLevel, Order, OrderStatus } from "@/lib/types";

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const order = useMemo(() => orders.find((item) => item.id === params.id), [orders, params.id]);

  useEffect(() => {
    const normalized = getOrders().map(normalizeOrder);
    const next = normalized.map((item) => (item.id === params.id ? { ...item, isNew: false } : item));
    setOrders(next);
    saveOrders(next);
  }, [params.id]);

  function updateOrder(patch: Partial<Order>) {
    const next = orders.map((item) => (item.id === params.id ? { ...item, ...patch, isNew: false, updatedAt: new Date().toISOString() } : item));
    setOrders(next);
    saveOrders(next);
  }

  async function copyReply() {
    const reply = order?.analysis?.reply || "";
    if (!reply.trim()) return setMessage("暂无可复制内容");
    const copied = await copyText(reply);
    setMessage(copied ? "已复制推荐回复" : "复制失败，请手动复制");
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

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">订单详情</h1>
          <p className="mt-1 text-sm text-slate-500">查看原始聊天、AI 分析、风险点和跟进备注。</p>
        </div>
        <Link className={secondaryButtonClass} href="/orders">返回客户订单</Link>
      </header>
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{message}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Section title="客户画像">
          <div className="grid gap-4 sm:grid-cols-2">
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
          <button className={secondaryButtonClass} onClick={copyReply} disabled={!order.analysis?.reply?.trim()}>复制推荐回复</button>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="缺失信息"><SimpleList items={order.analysis?.missingInfo || []} empty="暂无明显缺失" /></Section>
        <Section title="风险点"><SimpleList items={order.analysis?.risks || []} empty="暂无明显风险" /></Section>
        <Section title="下一步动作"><SimpleList items={order.analysis?.nextActions || []} empty="暂无下一步动作" /></Section>
      </div>

      <Section title="原始客户消息">
        <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{order.rawMessage || "暂无"}</pre>
      </Section>
    </div>
  );
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

function InfoBlock({ title, content, strong = false }: { title: string; content: string; strong?: boolean }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-sm font-semibold text-slate-800">{title}</div>
      <div className={`rounded-md border border-slate-200 p-3 text-sm ${strong ? "bg-amber-50" : "bg-slate-50"}`}>{content}</div>
    </div>
  );
}

function SimpleList({ items, empty }: { items: string[]; empty: string }) {
  return <ul className="space-y-2 text-sm text-slate-700">{(items.length ? items : [empty]).map((item) => <li key={item} className="rounded-md bg-slate-50 p-2">{item}</li>)}</ul>;
}
