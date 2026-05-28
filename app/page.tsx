"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { StatsCards } from "@/components/StatsCards";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessGuides, businessTypeLabels, defaultTemplates } from "@/lib/constants";
import { formatItemSummary, formatQuantity } from "@/lib/format";
import { calculateStats, inferIntentLevel, mapOrderStatus } from "@/lib/orderUtils";
import { createId, getOrders, getSettings, getTemplates, saveOrders, saveTemplates } from "@/lib/storage";
import type { AnalyzeApiResponse, AnalyzeResult, BusinessType, MessageTemplate, Order } from "@/lib/types";

const samples: Record<BusinessType, string> = {
  sam: "想要一个牛肉卷一个鸡胸肉，送青秀区，今天下午能到吗？",
  xianyu: "这个耳机还能便宜点吗？包邮不？今天拍什么时候发？",
  local: "我想约明天下午上门清洗空调，青秀区，大概多少钱？",
  trade: "Hi, we need 500 pieces of stainless steel water bottles. Can you quote FOB price and delivery time to Malaysia?",
};

export default function WorkbenchPage() {
  const [chatText, setChatText] = useState(samples.sam);
  const [businessType, setBusinessType] = useState<BusinessType>("sam");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(calculateStats([]));

  useEffect(() => {
    const refresh = () => setStats(calculateStats(getOrders()));
    refresh();
    window.addEventListener("orders-updated", refresh);
    return () => window.removeEventListener("orders-updated", refresh);
  }, []);

  function changeBusinessType(value: BusinessType) {
    setBusinessType(value);
    setChatText(samples[value]);
    setResult(null);
    setMessage("");
  }

  function ensureTemplates() {
    const existing = getTemplates();
    if (existing.length > 0) return existing;
    saveTemplates(defaultTemplates);
    return defaultTemplates;
  }

  async function analyze() {
    setLoading(true);
    setMessage("");
    try {
      const settings = getSettings();
      const enabledTemplates = ensureTemplates()
        .filter((template) => template.enabled && template.businessType === businessType)
        .map(({ name, scenario, content }) => ({ name, scenario, content }));
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatText,
          businessType,
          systemPrompt: settings.systemPrompt,
          sellerRules: settings.merchantRules,
          enabledTemplates,
        }),
      });
      const data = (await response.json()) as AnalyzeApiResponse;
      if (!response.ok || data.error) throw new Error(data.error || "AI 分析失败，请稍后重试或使用 mock 模式");
      setResult(mapAnalyzeResponse(data));
    } catch {
      setResult(null);
      setMessage("AI 分析失败，请稍后重试或使用 mock 模式");
    } finally {
      setLoading(false);
    }
  }

  async function copyReply() {
    const reply = result?.reply || "";
    if (!reply.trim()) {
      setMessage("暂无可复制内容");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(reply);
      else fallbackCopy(reply);
      setMessage("已复制");
    } catch {
      try {
        fallbackCopy(reply);
        setMessage("已复制");
      } catch {
        setMessage("复制失败，请手动复制");
      }
    }
  }

  function saveOrder() {
    if (!result) return;
    const orders = getOrders();
    const now = new Date();
    const duplicate = orders.some((order) => {
      const createdAt = new Date(order.createdAt || order.updatedAt).getTime();
      return order.customerName === result.customerName && order.summary === result.summary && now.getTime() - createdAt <= 10 * 60 * 1000;
    });
    if (duplicate && !window.confirm("可能是重复订单，是否继续保存？")) {
      setMessage("已取消保存");
      return;
    }
    const missingInfo = result.missingInfo || [];
    const itemSummary = formatItemSummary(result.products);
    const order: Order = {
      id: createId("order"),
      customerName: result.customerName,
      platform: result.platform || "未识别",
      businessType,
      summary: result.summary,
      itemSummary: itemSummary || "待确认",
      status: mapOrderStatus(result.orderStatus, missingInfo),
      intentLevel: inferIntentLevel(result.urgency, missingInfo),
      note: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isNew: true,
      rawMessage: chatText,
      analysis: result,
    };
    saveOrders([order, ...orders]);
    setMessage("订单已保存");
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">工作台</h1>
        <p className="mt-1 text-sm text-slate-500">粘贴聊天记录，生成订单分析、客服回复草稿，并沉淀客户信息。</p>
      </header>

      <StatsCards stats={stats} />

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{message}</div> : null}

      <Section title="业务类型" description={businessGuides[businessType]}>
        <div className="grid gap-2 sm:grid-cols-4">
          {(Object.keys(businessTypeLabels) as BusinessType[]).map((type) => (
            <button
              key={type}
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                businessType === type ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => changeBusinessType(type)}
            >
              {businessTypeLabels[type]}
            </button>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <Section title="聊天分析">
          <div className="space-y-4">
            <Field label="客户聊天记录">
              <textarea className={`${textareaClass} min-h-72 resize-y`} value={chatText} onChange={(event) => setChatText(event.target.value)} />
            </Field>
            <button className={primaryButtonClass} onClick={analyze} disabled={loading || !chatText.trim()}>
              {loading ? "分析中..." : "生成分析"}
            </button>
          </div>
        </Section>

        <Section title="AI 输出">
          {result ? (
            <div className="space-y-4">
              <OutputBlock title="客户诉求" content={result.customerIntent} />
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-800">商品/服务列表</div>
                <div className="space-y-2">
                  {result.products.map((product, index) => (
                    <div key={`${product.name}-${index}`} className="rounded-md border border-slate-200 p-3 text-sm">
                      <div className="font-medium text-slate-950">{product.name}</div>
                      <div className="mt-1 text-slate-600">数量：{formatQuantity(product.quantity, product.unit)}</div>
                      {product.confidence ? <div className="mt-1 text-slate-500">置信度：{product.confidence}</div> : null}
                      {product.notes ? <div className="mt-1 text-slate-500">{product.notes}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
              <ListBlock title="缺失信息" items={result.missingInfo} empty="暂无明显缺失" />
              <ListBlock title="风险点" items={result.risks} />
              <ListBlock title="下一步动作" items={result.nextActions} />
              <OutputBlock title="回复话术" content={result.reply} strong />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button className={secondaryButtonClass} onClick={copyReply} disabled={!result.reply?.trim()}>一键复制回复</button>
                <button className={primaryButtonClass} onClick={saveOrder}>保存为订单</button>
                {message === "订单已保存" ? <Link className={secondaryButtonClass} href="/orders">查看订单</Link> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              生成后会在这里展示客户诉求、商品/服务、缺失信息、风险点、下一步动作和回复话术。
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function mapAnalyzeResponse(data: AnalyzeApiResponse): AnalyzeResult {
  const confidenceMap = { high: "高", medium: "中", low: "低" } as const;
  return {
    customerIntent: data.customer_intent,
    products: data.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.note,
      confidence: confidenceMap[item.confidence],
    })),
    missingInfo: data.missing_info,
    risks: data.risk_flags,
    nextActions: data.next_action,
    reply: data.reply,
    summary: data.summary,
    customerName: data.customer_info.name || "待填写客户",
    platform: data.customer_info.platform || "未识别",
    orderStatus: data.order_status,
    urgency: data.urgency,
  };
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!success) throw new Error("copy failed");
}

function OutputBlock({ title, content, strong = false }: { title: string; content: string; strong?: boolean }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-800">{title}</div>
      <div className={`rounded-md border border-slate-200 p-3 text-sm ${strong ? "bg-amber-50" : "bg-slate-50"}`}>{content}</div>
    </div>
  );
}

function ListBlock({ title, items, empty = "暂无" }: { title: string; items: string[]; empty?: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-800">{title}</div>
      <ul className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {(items.length ? items : [empty]).map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
