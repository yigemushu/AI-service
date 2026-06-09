"use client";

import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels, defaultTemplates, mergeDefaultTemplates } from "@/lib/constants";
import { createId, getTemplates, saveTemplates } from "@/lib/storage";
import type { BusinessType, MessageTemplate } from "@/lib/types";

const emptyForm = { name: "", businessType: "sam" as BusinessType, scenario: "", requiredInfo: "", content: "", enabled: true };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [businessType, setBusinessType] = useState<"all" | BusinessType>("all");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");

  useEffect(() => {
    const stored = getTemplates();
    const next = mergeDefaultTemplates(stored);
    setTemplates(next);
    if (next.length !== stored.length) saveTemplates(next);
  }, []);

  const filtered = useMemo(() => templates.filter((template) => businessType === "all" || template.businessType === businessType), [templates, businessType]);

  function persist(next: MessageTemplate[]) {
    setTemplates(next);
    saveTemplates(next);
  }

  function restoreDefaults() {
    const next = mergeDefaultTemplates(templates);
    persist(next);
  }

  function submit() {
    if (!form.name.trim() || !form.content.trim()) return;
    const now = new Date().toISOString();
    if (editingId) persist(templates.map((template) => (template.id === editingId ? { ...template, ...form, updatedAt: now } : template)));
    else persist([{ id: createId("tpl"), ...form, createdAt: now, updatedAt: now }, ...templates]);
    setForm(emptyForm);
    setEditingId("");
  }

  function edit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({ name: template.name, businessType: template.businessType, scenario: template.scenario, requiredInfo: template.requiredInfo || "", content: template.content, enabled: template.enabled });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">话术模板</h1>
        <p className="mt-1 text-sm text-slate-500">按业务类型管理可复用话术，工作台生成回复时会参考已启用模板。</p>
      </header>

      <Section title={editingId ? "编辑模板" : "新增模板"}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="模板名称"><input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="业务类型">
            <select className={inputClass} value={form.businessType} onChange={(event) => setForm({ ...form, businessType: event.target.value as BusinessType })}>
              {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="使用场景"><input className={inputClass} value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })} /></Field>
          <label className="flex items-end gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用模板</label>
          <div className="lg:col-span-2">
            <Field label="需要的信息">
              <textarea className={`${textareaClass} min-h-24`} value={form.requiredInfo} onChange={(event) => setForm({ ...form, requiredInfo: event.target.value })} placeholder="一行一个，例如：具体内容/事件经过、字数/页数、交付格式" />
            </Field>
          </div>
          <div className="lg:col-span-2">
            <Field label="模板内容"><textarea className={`${textareaClass} min-h-28`} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></Field>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button className={primaryButtonClass} onClick={submit}>{editingId ? "保存修改" : "新增模板"}</button>
          {editingId ? <button className={secondaryButtonClass} onClick={() => { setEditingId(""); setForm(emptyForm); }}>取消编辑</button> : null}
        </div>
      </Section>

      <Section title="模板列表">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xs flex-1">
          <Field label="业务类型筛选">
            <select className={inputClass} value={businessType} onChange={(event) => setBusinessType(event.target.value as "all" | BusinessType)}>
              <option value="all">全部业务</option>
              {Object.entries(businessTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          </div>
          <button className={secondaryButtonClass} onClick={restoreDefaults}>补齐默认模板</button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((template) => (
            <article key={template.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-950">{template.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{businessTypeLabels[template.businessType]} · {template.scenario}</div>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${template.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{template.enabled ? "启用" : "停用"}</span>
              </div>
              {template.requiredInfo ? (
                <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 p-3 text-sm text-slate-700">
                  <div className="mb-1 font-semibold text-slate-900">需要的信息</div>
                  <div className="whitespace-pre-line">{template.requiredInfo}</div>
                </div>
              ) : null}
              <p className="mt-3 whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">{template.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={secondaryButtonClass} onClick={() => edit(template)}>编辑</button>
                <button className={secondaryButtonClass} onClick={() => persist(templates.map((item) => item.id === template.id ? { ...item, enabled: !item.enabled, updatedAt: new Date().toISOString() } : item))}>{template.enabled ? "停用" : "启用"}</button>
                <button className={secondaryButtonClass} onClick={() => persist(templates.filter((item) => item.id !== template.id))}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}
