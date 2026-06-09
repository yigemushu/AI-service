"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultKnowledgeRules, defaultTemplates, mergeDefaultTemplates } from "@/lib/constants";
import { formatItemSummary, formatQuantity } from "@/lib/format";
import { buildOrderTitle, createOrderHistoryEvent, inferIntentLevel, mapOrderStatus } from "@/lib/orderUtils";
import {
  createId,
  getCustomerMessages,
  getKnowledgeRules,
  getOrders,
  getSettings,
  getTemplates,
  saveCustomerMessages,
  saveKnowledgeRules,
  saveOrders,
  saveTemplates,
} from "@/lib/storage";
import type { AnalyzeApiResponse, AnalyzeResult, BusinessType, CustomerMessage, InboxStatus, Order, SourcePlatform } from "@/lib/types";

const platformOptions: Array<SourcePlatform | string> = ["闲鱼", "微信", "淘宝", "拼多多", "Facebook", "eBay", "其他"];
const inboxStatuses: InboxStatus[] = ["未处理", "已分析", "已回复", "待补信息", "已成单", "无效咨询"];

const sampleMessages: CustomerMessage[] = [
  {
    id: "msg_demo_xianyu",
    customerName: "闲鱼买家A",
    platform: "闲鱼",
    sourceChannel: "浏览器插件",
    businessType: "xianyu",
    rawMessage: "最低多少？能不能包邮，今天拍今天能发吗？耳机电池还行不行？",
    sourceUrl: "https://www.goofish.com/",
    status: "未处理",
    isNew: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "msg_demo_sam",
    customerName: "青秀区客户",
    platform: "微信",
    sourceChannel: "安卓助手",
    businessType: "sam",
    rawMessage: "想要一盒瑞士卷两个牛肉卷，下午六点前能送到吗？价格多少？",
    sourceUrl: "",
    status: "未处理",
    isNew: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<CustomerMessage[]>(() => getCustomerMessages());
  const [selectedId, setSelectedId] = useState(messages[0]?.id || "");
  const [messageText, setMessageText] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [platform, setPlatform] = useState<SourcePlatform | string>("闲鱼");
  const [businessType, setBusinessType] = useState<BusinessType>("xianyu");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => messages.find((item) => item.id === selectedId) || messages[0], [messages, selectedId]);
  const pendingCount = messages.filter((item) => item.status === "未处理" || item.isNew).length;

  function persist(next: CustomerMessage[], nextSelectedId = selectedId) {
    setMessages(next);
    saveCustomerMessages(next);
    if (nextSelectedId) setSelectedId(nextSelectedId);
  }

  function addMessage() {
    if (!messageText.trim()) {
      setNotice("请先粘贴客户消息");
      return;
    }
    const now = new Date().toISOString();
    const nextMessage: CustomerMessage = {
      id: createId("msg"),
      customerName: customerName.trim() || "待识别客户",
      platform,
      sourceChannel: "网站手动",
      businessType,
      rawMessage: messageText.trim(),
      sourceUrl: sourceUrl.trim(),
      status: "未处理",
      isNew: true,
      createdAt: now,
      updatedAt: now,
    };
    persist([nextMessage, ...messages], nextMessage.id);
    setMessageText("");
    setCustomerName("");
    setSourceUrl("");
    setNotice("新消息已进入待处理列表");
  }

  async function syncExternalMessages() {
    try {
      const response = await fetch("/api/inbox", { cache: "no-store" });
      const data = (await response.json()) as { messages?: CustomerMessage[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "sync failed");
      const incoming = safeArray(data.messages);
      const knownIds = new Set(messages.map((item) => item.id));
      const merged = [...incoming.filter((item) => !knownIds.has(item.id)), ...messages];
      persist(merged, incoming[0]?.id || selectedId);
      setNotice(incoming.length ? `已同步 ${incoming.length} 条外部消息` : "外部收件箱暂无消息");
    } catch {
      setNotice("同步外部消息失败，请确认 /api/inbox 可访问，或检查 Webhook Token 配置");
    }
  }

  function loadDemoMessages() {
    const existing = messages.filter((item) => !item.id.startsWith("msg_demo_"));
    persist([...sampleMessages, ...existing], sampleMessages[0].id);
    setNotice("已加载演示消息");
  }

  function updateMessage(id: string, patch: Partial<CustomerMessage>) {
    const next = messages.map((item) => (item.id === id ? { ...item, ...patch, isNew: false, updatedAt: new Date().toISOString() } : item));
    persist(next, id);
  }

  function deleteMessage(id: string) {
    const target = messages.find((item) => item.id === id);
    const confirmed = window.confirm(`确定要删除这条待处理消息吗？\n\n客户：${target?.customerName || "未识别客户"}\n删除后无法恢复。`);
    if (!confirmed) return;
    const next = messages.filter((item) => item.id !== id);
    persist(next, selectedId === id ? next[0]?.id || "" : selectedId);
    setNotice("已删除待处理消息");
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

  async function analyzeMessage() {
    if (!selected) return;
    setLoading(true);
    setNotice("");
    try {
      const settings = getSettings();
      const enabledTemplates = ensureTemplates()
        .filter((template) => template.enabled && template.businessType === selected.businessType)
        .map(({ name, scenario, requiredInfo, content }) => ({ name, scenario, requiredInfo, content }));
      const knowledgeRules = ensureKnowledgeRules()
        .filter((rule) => rule.enabled && (rule.businessType === "all" || rule.businessType === selected.businessType))
        .map(({ title, category, content }) => ({ title, category, content }));
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatText: selected.rawMessage,
          businessType: selected.businessType,
          systemPrompt: settings.systemPrompt,
          sellerRules: settings.merchantRules,
          enabledTemplates,
          knowledgeRules,
          responseMode: "fast",
        }),
      });
      const data = (await response.json()) as AnalyzeApiResponse;
      if (!response.ok || data.error) throw new Error(data.error || "AI analysis failed");
      const analysis = mapAnalyzeResponse(data);
      updateMessage(selected.id, {
        analysis,
        customerName: selected.customerName === "待识别客户" ? analysis.customerName : selected.customerName,
        platform: analysis.platform || selected.platform,
        status: analysis.missingInfo.length > 0 ? "待补信息" : "已分析",
      });
      setNotice("AI 已完成分析");
    } catch {
      setNotice("AI 分析失败，请稍后重试，或先手动复制消息到工作台分析");
    } finally {
      setLoading(false);
    }
  }

  async function copyReply() {
    const reply = selected?.analysis?.reply || "";
    if (!reply.trim()) return setNotice("暂无可复制回复");
    const copied = await copyText(reply);
    if (selected) updateMessage(selected.id, { status: "已回复" });
    setNotice(copied ? "已复制推荐回复，可回到原平台粘贴发送" : "复制失败，请手动复制");
  }

  function saveAsOrder() {
    if (!selected?.analysis) {
      setNotice("请先完成 AI 分析");
      return;
    }
    const missingInfo = safeArray(selected.analysis.missingInfo);
    const itemSummary = formatItemSummary(selected.analysis.products);
    const now = new Date().toISOString();
    const orderTitle = buildOrderTitle({ customerName: selected.customerName || selected.analysis.customerName, itemSummary, summary: selected.analysis.summary });
    const order: Order = {
      id: createId("order"),
      orderTitle,
      customerName: selected.customerName || selected.analysis.customerName,
      platform: selected.platform || selected.analysis.platform || "未识别",
      businessType: selected.businessType,
      summary: selected.analysis.summary,
      itemSummary: itemSummary || "待确认",
      status: mapOrderStatus(selected.analysis.orderStatus, missingInfo),
      intentLevel: inferIntentLevel(selected.analysis.urgency, missingInfo),
      note: `来源消息：${selected.platform}`,
      createdAt: now,
      updatedAt: now,
      isNew: true,
      rawMessage: selected.rawMessage,
      analysis: selected.analysis,
      conversation: [
        { id: `${selected.id}_customer`, role: "customer", content: selected.rawMessage, createdAt: selected.createdAt },
        { id: `${selected.id}_assistant`, role: "assistant", content: selected.analysis.reply, createdAt: now },
      ],
      history: [
        createOrderHistoryEvent("created", "从消息中心保存订单", `订单名称：${orderTitle}`, now),
        createOrderHistoryEvent("reply_generated", "生成推荐回复", selected.analysis.reply, now),
      ],
    };
    saveOrders([order, ...getOrders()]);
    updateMessage(selected.id, { status: "已成单" });
    setNotice("已保存为客户订单");
  }

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-lg border border-amber-100 bg-white shadow-sm shadow-amber-100/50">
        <div className="grid gap-4 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-6">
          <div>
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">半自动接单工作台</div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950 lg:text-3xl">消息中心</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              先把闲鱼、微信或外贸客户消息集中进来，AI 自动分析需求和风险。你确认后再复制回复，或者打开原平台手动发送。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="待处理" value={pendingCount} tone="bg-rose-50 text-rose-700" />
            <Metric label="总消息" value={messages.length} tone="bg-sky-50 text-sky-700" />
            <Metric label="已成单" value={messages.filter((item) => item.status === "已成单").length} tone="bg-emerald-50 text-emerald-700" />
          </div>
        </div>
      </header>

      {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{notice}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Section title="新增客户消息" description="目前先手动录入，后续可以接浏览器插件、Webhook 或平台消息转发。">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="来源平台">
                  <select className={inputClass} value={platform} onChange={(event) => setPlatform(event.target.value)}>
                    {platformOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="业务类型">
                  <select className={inputClass} value={businessType} onChange={(event) => setBusinessType(event.target.value as BusinessType)}>
                    {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="客户昵称">
                <input className={inputClass} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="可不填，AI 会尽量识别" />
              </Field>
              <Field label="原平台链接">
                <input className={inputClass} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="例如闲鱼聊天页链接，可选" />
              </Field>
              <Field label="客户消息">
                <textarea className={`${textareaClass} min-h-36`} value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="粘贴客户发来的消息..." />
              </Field>
              <div className="flex flex-col gap-2">
                <button className={primaryButtonClass} onClick={addMessage}>加入待处理</button>
                <button className={secondaryButtonClass} onClick={syncExternalMessages}>同步外部消息</button>
                <button className={secondaryButtonClass} onClick={loadDemoMessages}>加载演示消息</button>
              </div>
            </div>
          </Section>

          <Section title={`待处理列表（${messages.length}）`}>
            {messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/60 p-4 text-sm text-slate-600">还没有消息。先新增一条，或加载演示消息。</div>
            ) : (
              <div className="space-y-2">
                {messages.map((item) => (
                  <div
                    key={item.id}
                    className={`w-full rounded-md border p-3 text-left transition ${selected?.id === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-amber-100 bg-white hover:bg-emerald-50"}`}
                  >
                    <button className="w-full text-left" onClick={() => updateMessage(item.id, {})}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold">{item.customerName}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${selected?.id === item.id ? "bg-white text-slate-950" : "bg-amber-50 text-amber-700"}`}>{item.status}</span>
                      </div>
                      <div className={`mt-1 text-xs ${selected?.id === item.id ? "text-slate-200" : "text-slate-500"}`}>{item.platform} · {item.sourceChannel || "网站手动"} · {businessTypeLabels[item.businessType]}</div>
                      <div className={`mt-2 line-clamp-2 text-sm ${selected?.id === item.id ? "text-white" : "text-slate-700"}`}>{item.rawMessage}</div>
                    </button>
                    <button
                      className={`mt-3 inline-flex min-h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold ${selected?.id === item.id ? "border-white/30 text-white hover:bg-white/10" : "border-rose-100 text-rose-600 hover:bg-rose-50"}`}
                      onClick={() => deleteMessage(item.id)}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section title="消息处理">
          {selected ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-5">
                <Field label="客户">
                  <input className={inputClass} value={selected.customerName} onChange={(event) => updateMessage(selected.id, { customerName: event.target.value })} />
                </Field>
                <Field label="平台">
                  <input className={inputClass} value={selected.platform} onChange={(event) => updateMessage(selected.id, { platform: event.target.value })} />
                </Field>
                <Field label="入口">
                  <input className={inputClass} value={selected.sourceChannel || "网站手动"} onChange={(event) => updateMessage(selected.id, { sourceChannel: event.target.value as CustomerMessage["sourceChannel"] })} />
                </Field>
                <Field label="业务">
                  <select className={inputClass} value={selected.businessType} onChange={(event) => updateMessage(selected.id, { businessType: event.target.value as BusinessType })}>
                    {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="状态">
                  <select className={inputClass} value={selected.status} onChange={(event) => updateMessage(selected.id, { status: event.target.value as InboxStatus })}>
                    {inboxStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
              </div>

              <div className="rounded-lg border border-amber-100 bg-[#fffaf2] p-4">
                <div className="text-sm font-semibold text-slate-950">原始消息</div>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{selected.rawMessage}</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button className={primaryButtonClass} onClick={analyzeMessage} disabled={loading}>{loading ? "分析中..." : "AI 分析这条消息"}</button>
                <button className={secondaryButtonClass} onClick={copyReply} disabled={!selected.analysis?.reply}>复制推荐回复</button>
                <button className={secondaryButtonClass} onClick={saveAsOrder} disabled={!selected.analysis}>保存为订单</button>
                {selected.sourceUrl ? (
                  <a className={secondaryButtonClass} href={selected.sourceUrl} target="_blank" rel="noreferrer">打开原平台</a>
                ) : null}
                <Link className={secondaryButtonClass} href="/orders">查看客户订单</Link>
              </div>

              {selected.analysis ? (
                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  <InfoBlock title="客户诉求" content={selected.analysis.customerIntent} />
                  <InfoBlock title="推荐回复" content={selected.analysis.reply} strong />
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-800">商品/服务</div>
                    <div className="space-y-2">
                      {safeArray(selected.analysis.products).map((product, index) => (
                        <div key={`${product.name}-${index}`} className="rounded-md border border-amber-100 bg-white p-3 text-sm">
                          <div className="font-semibold text-slate-950">{product.name}</div>
                          <div className="mt-1 text-slate-600">数量：{formatQuantity(product.quantity, product.unit)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ListBlock title="缺失信息" items={selected.analysis.missingInfo} empty="暂无明显缺失" />
                  <ListBlock title="风险点" items={selected.analysis.risks} empty="暂无明显风险" />
                  <ListBlock title="下一步动作" items={selected.analysis.nextActions} empty="暂无下一步动作" />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/60 p-6 text-sm text-slate-600">点击 AI 分析后，这里会显示客户需求、缺失信息、风险点和推荐回复。</div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-amber-200 bg-amber-50/60 p-6 text-sm text-slate-600">请选择或新增一条客户消息。</div>
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
    products: safeArray(data.items).map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, notes: item.note, confidence: confidenceMap[item.confidence] })),
    missingInfo: safeArray(data.missing_info),
    risks: safeArray(data.risk_flags),
    nextActions: safeArray(data.next_action),
    reply: data.reply,
    summary: data.summary,
    customerName: data.customer_info?.name || "待识别客户",
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

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-amber-100 bg-white p-3">
      <div className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function InfoBlock({ title, content, strong = false }: { title: string; content: string; strong?: boolean }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-800">{title}</div>
      <div className={`whitespace-pre-line rounded-md border border-amber-100 p-3 text-sm leading-6 ${strong ? "bg-emerald-50 text-emerald-950" : "bg-white text-slate-700"}`}>{content}</div>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-800">{title}</div>
      <ul className="space-y-2 text-sm text-slate-700">
        {(safeArray(items).length ? items : [empty]).map((item, index) => <li key={`${item}-${index}`} className="rounded-md border border-amber-100 bg-white p-2">{item}</li>)}
      </ul>
    </div>
  );
}
