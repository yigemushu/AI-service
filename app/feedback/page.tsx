"use client";

import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, textareaClass } from "@/components/ui";
import { createId, getFeedbackRecords, saveFeedbackRecords } from "@/lib/storage";
import type { FeedbackRecord } from "@/lib/types";

const emptyForm: Omit<FeedbackRecord, "id" | "createdAt"> = {
  testerName: "",
  role: "",
  scenario: "",
  rating: 4,
  willingnessToPay: "再观望",
  feedback: "",
  contact: "",
};

export default function FeedbackPage() {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRecords(getFeedbackRecords());
  }, []);

  const averageRating = useMemo(() => {
    if (!records.length) return "暂无";
    return (records.reduce((sum, record) => sum + record.rating, 0) / records.length).toFixed(1);
  }, [records]);

  function submit() {
    if (!form.feedback.trim()) return;
    const next = [
      {
        id: createId("feedback"),
        ...form,
        createdAt: new Date().toISOString(),
      },
      ...records,
    ];
    setRecords(next);
    saveFeedbackRecords(next);
    setForm(emptyForm);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">外测反馈</h1>
        <p className="mt-1 text-sm text-slate-500">给真实卖家试用时，记录使用场景、付费意愿、阻塞点和下一版优先级。</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="反馈数量" value={String(records.length)} />
        <Metric label="平均评分" value={averageRating} />
        <Metric label="愿意付费" value={String(records.filter((record) => record.willingnessToPay === "愿意付费").length)} />
      </div>

      {saved ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">反馈已保存</div> : null}

      <Section title="新增外测反馈">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="测试人/店铺名">
            <input className={inputClass} value={form.testerName} onChange={(event) => setForm({ ...form, testerName: event.target.value })} placeholder="例如：闲鱼数码卖家 A" />
          </Field>
          <Field label="角色">
            <input className={inputClass} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} placeholder="例如：山姆代购、闲鱼卖家、本地商家" />
          </Field>
          <Field label="试用场景">
            <input className={inputClass} value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })} placeholder="例如：晚高峰回复 20 条咨询" />
          </Field>
          <Field label="整体评分">
            <select className={inputClass} value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) })}>
              {[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} 分</option>)}
            </select>
          </Field>
          <Field label="付费意愿">
            <select className={inputClass} value={form.willingnessToPay} onChange={(event) => setForm({ ...form, willingnessToPay: event.target.value as FeedbackRecord["willingnessToPay"] })}>
              <option value="愿意付费">愿意付费</option>
              <option value="再观望">再观望</option>
              <option value="暂不愿意">暂不愿意</option>
            </select>
          </Field>
          <Field label="联系方式">
            <input className={inputClass} value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} placeholder="可选，方便回访" />
          </Field>
          <div className="lg:col-span-2">
            <Field label="反馈内容">
              <textarea className={`${textareaClass} min-h-32`} value={form.feedback} onChange={(event) => setForm({ ...form, feedback: event.target.value })} placeholder="哪里有用？哪里卡住？是否愿意为它付费？希望下一版加什么？" />
            </Field>
          </div>
        </div>
        <button className={`${primaryButtonClass} mt-4`} onClick={submit} disabled={!form.feedback.trim()}>保存反馈</button>
      </Section>

      <Section title="反馈记录">
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">暂无反馈。外测时可以让朋友或商家边用边填。</div>
        ) : (
          <div className="space-y-3">
            {records.map((record) => (
              <article key={record.id} className="rounded-md border border-slate-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-slate-950">{record.testerName || "未命名测试人"}</div>
                    <div className="mt-1 text-sm text-slate-500">{record.role || "未填写角色"} · {record.scenario || "未填写场景"}</div>
                  </div>
                  <div className="flex gap-2 text-xs font-semibold">
                    <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">{record.rating} 分</span>
                    <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{record.willingnessToPay}</span>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{record.feedback}</p>
                <div className="mt-3 text-xs text-slate-500">
                  {record.contact ? `联系方式：${record.contact} · ` : ""}提交时间：{new Date(record.createdAt).toLocaleString("zh-CN")}
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}
