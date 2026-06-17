"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
  const [importMessage, setImportMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function exportTemplates() {
    const payload = {
      app: "ai-service-workbench",
      type: "message-templates",
      exportedAt: new Date().toISOString(),
      templates,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `message-templates-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setImportMessage(`已导出 ${templates.length} 条模板`);
  }

  function normalizeImportedTemplates(value: unknown) {
    const rawTemplates = Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null && Array.isArray((value as { templates?: unknown }).templates)
        ? (value as { templates: unknown[] }).templates
        : [];

    const now = new Date().toISOString();
    return rawTemplates.flatMap((item): MessageTemplate[] => {
      if (typeof item !== "object" || item === null) return [];
      const candidate = item as Partial<MessageTemplate>;
      if (!candidate.name?.trim() || !candidate.content?.trim()) return [];
      const business = candidate.businessType && candidate.businessType in businessTypeLabels ? candidate.businessType : "sam";
      return [{
        id: candidate.id?.trim() || createId("tpl"),
        name: candidate.name.trim(),
        businessType: business,
        scenario: candidate.scenario?.trim() || "导入模板",
        requiredInfo: candidate.requiredInfo?.trim() || "",
        content: candidate.content.trim(),
        enabled: candidate.enabled !== false,
        createdAt: candidate.createdAt || now,
        updatedAt: now,
      }];
    });
  }

  async function importTemplates(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = normalizeImportedTemplates(parsed);
      if (imported.length === 0) {
        setImportMessage("导入失败：没有找到可用模板");
        return;
      }
      const importedIds = new Set(imported.map((template) => template.id));
      persist([...imported, ...templates.filter((template) => !importedIds.has(template.id))]);
      setImportMessage(`已导入 ${imported.length} 条模板`);
    } catch {
      setImportMessage("导入失败：文件不是有效的 JSON 模板包");
    } finally {
      event.target.value = "";
    }
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
          <div className="flex flex-wrap gap-2">
            <button className={secondaryButtonClass} onClick={restoreDefaults}>补齐默认模板</button>
            <button className={secondaryButtonClass} onClick={exportTemplates} disabled={templates.length === 0}>导出模板包</button>
            <button className={secondaryButtonClass} onClick={() => fileInputRef.current?.click()}>导入模板包</button>
            <input ref={fileInputRef} className="hidden" type="file" accept="application/json,.json" onChange={importTemplates} />
          </div>
        </div>
        {importMessage ? <div className="mb-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{importMessage}</div> : null}
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
