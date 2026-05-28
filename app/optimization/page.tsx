"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, textareaClass } from "@/components/ui";
import { createId, getOptimizationRecords, saveOptimizationRecords } from "@/lib/storage";
import type { OptimizationRecord } from "@/lib/types";

const emptyForm = {
  rawMessage: "",
  aiOutput: "",
  errorType: "",
  correctResult: "",
  optimized: false,
};

export default function OptimizationPage() {
  const [records, setRecords] = useState<OptimizationRecord[]>([]);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    setRecords(getOptimizationRecords());
  }, []);

  function addRecord() {
    const record: OptimizationRecord = {
      id: createId("opt"),
      ...form,
      updatedAt: new Date().toISOString(),
    };
    const next = [record, ...records];
    setRecords(next);
    saveOptimizationRecords(next);
    setForm(emptyForm);
  }

  function updateRecord(id: string, patch: Partial<OptimizationRecord>) {
    const next = records.map((record) =>
      record.id === id ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record,
    );
    setRecords(next);
    saveOptimizationRecords(next);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">优化中心</h1>
        <p className="mt-1 text-sm text-slate-500">记录 AI 分析错误和正确答案，后续可用于优化提示词或训练数据。</p>
      </header>

      <Section title="新增优化记录">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="原始客户消息">
            <textarea
              className={`${textareaClass} min-h-32`}
              value={form.rawMessage}
              onChange={(event) => setForm({ ...form, rawMessage: event.target.value })}
            />
          </Field>
          <Field label="AI 输出">
            <textarea
              className={`${textareaClass} min-h-32`}
              value={form.aiOutput}
              onChange={(event) => setForm({ ...form, aiOutput: event.target.value })}
            />
          </Field>
          <Field label="错误类型">
            <input
              className={inputClass}
              value={form.errorType}
              onChange={(event) => setForm({ ...form, errorType: event.target.value })}
              placeholder="如：漏提地址、数量识别错误、话术不合适"
            />
          </Field>
          <Field label="正确结果">
            <textarea
              className={`${textareaClass} min-h-24`}
              value={form.correctResult}
              onChange={(event) => setForm({ ...form, correctResult: event.target.value })}
            />
          </Field>
        </div>
        <button className={`${primaryButtonClass} mt-4`} onClick={addRecord} disabled={!form.rawMessage.trim()}>
          保存优化记录
        </button>
      </Section>

      <Section title="记录列表">
        <div className="space-y-3">
          {records.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">暂无记录。</div>
          ) : (
            records.map((record) => (
              <article key={record.id} className="rounded-md border border-slate-200 p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <TextPreview title="原始消息" text={record.rawMessage} />
                  <TextPreview title="AI 输出" text={record.aiOutput} />
                  <TextPreview title="错误类型" text={record.errorType || "未填写"} />
                  <TextPreview title="正确结果" text={record.correctResult || "未填写"} />
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={record.optimized}
                    onChange={(event) => updateRecord(record.id, { optimized: event.target.checked })}
                  />
                  是否已优化
                </label>
              </article>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function TextPreview({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-slate-800">{title}</div>
      <div className="min-h-16 rounded-md bg-slate-50 p-3 text-sm text-slate-700">{text}</div>
    </div>
  );
}
