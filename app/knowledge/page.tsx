"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultKnowledgeRules } from "@/lib/constants";
import { createId, getKnowledgeRules, saveKnowledgeRules } from "@/lib/storage";
import type { BusinessType, KnowledgeRule } from "@/lib/types";

const categories: KnowledgeRule["category"][] = ["商品库存", "价格报价", "配送履约", "售后退款", "话术禁区", "其他"];

const emptyRule: Omit<KnowledgeRule, "id" | "updatedAt"> = {
  title: "",
  businessType: "all",
  category: "其他",
  content: "",
  enabled: true,
};

export default function KnowledgePage() {
  const [rules, setRules] = useState<KnowledgeRule[]>([]);
  const [form, setForm] = useState(emptyRule);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const stored = getKnowledgeRules();
    setRules(stored.length ? stored : defaultKnowledgeRules);
    if (!stored.length) saveKnowledgeRules(defaultKnowledgeRules);
  }, []);

  function persist(next: KnowledgeRule[], message = "已保存") {
    setRules(next);
    saveKnowledgeRules(next);
    setSaved(message);
    window.setTimeout(() => setSaved(""), 1600);
  }

  function addRule() {
    if (!form.title.trim() || !form.content.trim()) return;
    persist(
      [
        {
          id: createId("rule"),
          ...form,
          updatedAt: new Date().toISOString(),
        },
        ...rules,
      ],
      "规则已新增",
    );
    setForm(emptyRule);
  }

  function updateRule(id: string, patch: Partial<KnowledgeRule>) {
    persist(rules.map((rule) => (rule.id === id ? { ...rule, ...patch, updatedAt: new Date().toISOString() } : rule)));
  }

  function deleteRule(id: string) {
    if (!window.confirm("确认删除这条知识库规则吗？")) return;
    persist(rules.filter((rule) => rule.id !== id), "规则已删除");
  }

  function resetDefaults() {
    if (!window.confirm("确认恢复默认知识库规则吗？这会覆盖当前规则。")) return;
    persist(defaultKnowledgeRules, "已恢复默认规则");
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">商家知识库</h1>
          <p className="mt-1 text-sm text-slate-500">沉淀库存、报价、配送、售后和禁用承诺，让 AI 回复更贴近真实经营规则。</p>
        </div>
        <button className={secondaryButtonClass} onClick={resetDefaults}>恢复默认规则</button>
      </header>

      {saved ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{saved}</div> : null}

      <Section title="新增规则" description="启用后的规则会随工作台分析请求一起传给后端 API，但不会暴露 API Key。">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="规则标题">
            <input className={inputClass} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：山姆配送时效口径" />
          </Field>
          <Field label="业务类型">
            <select className={inputClass} value={form.businessType} onChange={(event) => setForm({ ...form, businessType: event.target.value as BusinessType | "all" })}>
              <option value="all">全部业务</option>
              {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="规则分类">
            <select className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as KnowledgeRule["category"] })}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            启用
          </label>
          <div className="lg:col-span-2">
            <Field label="规则内容">
              <textarea className={`${textareaClass} min-h-28`} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="写清楚 AI 回复时应该遵守的经营规则、禁用承诺或补充信息。" />
            </Field>
          </div>
        </div>
        <button className={`${primaryButtonClass} mt-4`} onClick={addRule} disabled={!form.title.trim() || !form.content.trim()}>新增知识规则</button>
      </Section>

      <Section title={`规则列表（${rules.length}）`}>
        <div className="space-y-3">
          {rules.map((rule) => (
            <article key={rule.id} className="rounded-md border border-slate-200 p-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_170px_150px_90px]">
                <input className={inputClass} value={rule.title} onChange={(event) => updateRule(rule.id, { title: event.target.value })} />
                <select className={inputClass} value={rule.businessType} onChange={(event) => updateRule(rule.id, { businessType: event.target.value as BusinessType | "all" })}>
                  <option value="all">全部业务</option>
                  {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select className={inputClass} value={rule.category} onChange={(event) => updateRule(rule.id, { category: event.target.value as KnowledgeRule["category"] })}>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} />
                  启用
                </label>
              </div>
              <textarea className={`${textareaClass} mt-3 min-h-24`} value={rule.content} onChange={(event) => updateRule(rule.id, { content: event.target.value })} />
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>更新时间：{new Date(rule.updatedAt).toLocaleString("zh-CN")}</span>
                <button className={secondaryButtonClass} onClick={() => deleteRule(rule.id)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}
