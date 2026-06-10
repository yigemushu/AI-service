"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { businessTypeLabels } from "@/lib/constants";
import { createId, getEvaluationRuns, getOptimizationRecords, getSettings, getTemplates, saveOptimizationRecords, saveSettings, saveTemplates } from "@/lib/storage";
import type { BusinessType, EvaluationRun, MessageTemplate, OptimizationRecord } from "@/lib/types";

const emptyForm: Omit<OptimizationRecord, "id" | "updatedAt"> = {
  source: "manual",
  rawMessage: "",
  aiOutput: "",
  errorType: "",
  correctResult: "",
  improvementAction: "",
  status: "待优化",
  priority: "中",
  optimized: false,
};

const statuses = ["全部", "待优化", "已优化", "已复测"] as const;
const priorities = ["高", "中", "低"] as const;

function extractCustomerReply(record: OptimizationRecord) {
  const editedOutput = record.aiOutput || "";
  const replyLine = editedOutput.match(/(?:回复|推荐回复|回复话术)[：:]\s*([\s\S]+)/)?.[1]?.trim();
  return replyLine || editedOutput.trim() || record.correctResult.trim() || record.improvementAction?.trim() || "";
}

export default function OptimizationPage() {
  const [records, setRecords] = useState<OptimizationRecord[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState<(typeof statuses)[number]>("待优化");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);

  useEffect(() => {
    setRecords(getOptimizationRecords());
    setRuns(getEvaluationRuns());
    const refresh = () => {
      setRecords(getOptimizationRecords());
      setRuns(getEvaluationRuns());
    };
    window.addEventListener("optimization-updated", refresh);
    window.addEventListener("evaluation-runs-updated", refresh);
    return () => {
      window.removeEventListener("optimization-updated", refresh);
      window.removeEventListener("evaluation-runs-updated", refresh);
    };
  }, []);

  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
  }, [runs, selectedRunId]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => statusFilter === "全部" || (record.status || (record.optimized ? "已优化" : "待优化")) === statusFilter);
  }, [records, statusFilter]);

  const stats = useMemo(() => {
    return records.reduce(
      (summary, record) => {
        const status = record.status || (record.optimized ? "已优化" : "待优化");
        summary[status] += 1;
        return summary;
      },
      { 待优化: 0, 已优化: 0, 已复测: 0 },
    );
  }, [records]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) || runs[0], [runs, selectedRunId]);
  const failedRunResults = useMemo(() => {
    return (selectedRun?.results || []).filter((result) => result.failedMetrics.length > 0);
  }, [selectedRun]);

  function persist(next: OptimizationRecord[]) {
    setRecords(next);
    saveOptimizationRecords(next);
  }

  function addRecord() {
    const record: OptimizationRecord = {
      id: createId("opt"),
      ...form,
      optimized: form.status === "已优化" || form.status === "已复测",
      updatedAt: new Date().toISOString(),
    };
    persist([record, ...records]);
    setForm(emptyForm);
  }

  function updateRecord(id: string, patch: Partial<OptimizationRecord>) {
    const next = records.map((record) => {
      if (record.id !== id) return record;
      const status = patch.status || record.status || "待优化";
      return {
        ...record,
        ...patch,
        status,
        optimized: status === "已优化" || status === "已复测",
        updatedAt: new Date().toISOString(),
      };
    });
    persist(next);
  }

  function removeRecord(id: string) {
    if (!window.confirm("确定删除这条优化记录吗？")) return;
    persist(records.filter((record) => record.id !== id));
  }

  function buildOptimizationRule(record: OptimizationRecord) {
    const business = record.businessType ? businessTypeLabels[record.businessType] : "通用业务";
    return [
      `[${business}${record.sampleId ? ` ${record.sampleId}` : ""}]`,
      `失败维度：${record.errorType || "未填写"}`,
      `优化要求：${record.improvementAction || "按正确结果修正 AI 输出。"}`,
      `正确结果：${record.correctResult || "未填写"}`,
    ].join("\n");
  }

  function applyToMerchantRules(record: OptimizationRecord) {
    const settings = getSettings();
    const rule = buildOptimizationRule(record);
    const marker = record.sampleId ? `[${record.sampleId}]` : rule.slice(0, 30);
    if (!settings.merchantRules.includes(marker)) {
      saveSettings({ ...settings, merchantRules: `${settings.merchantRules.trim()}\n\n${rule}`.trim() });
    }
    updateRecord(record.id, {
      status: "已优化",
      improvementAction: `${record.improvementAction || ""}\n已应用到商家规则。`.trim(),
    });
  }

  function applyToTemplate(record: OptimizationRecord) {
    const businessType = record.businessType || "sam";
    const now = new Date().toISOString();
    const replyDraft = extractCustomerReply(record);
    const content = [
      replyDraft || "根据失败样本修正回复。",
      "写法要求：回复要短、自然、有一点情绪；中文场景的 ~ 只放在整段最后一句结尾，不要每句话都加。",
      "安全边界：只生成草稿，不要承诺库存、最低价、一定送达或无条件退款。",
    ].filter(Boolean).join("\n");
    const template: MessageTemplate = {
      id: createId("tpl_opt"),
      name: `优化话术 ${record.sampleId || now.slice(0, 10)}`,
      businessType,
      scenario: record.errorType || "压测失败样本",
      requiredInfo: record.correctResult || "按失败样本补充需要客户提供的信息。",
      content,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    saveTemplates([template, ...getTemplates()]);
    updateRecord(record.id, {
      status: "已优化",
      improvementAction: `${record.improvementAction || ""}\n已把你编辑后的客户回复保存为启用的话术模板。`.trim(),
    });
  }

  function suggestAction(record: OptimizationRecord) {
    const failures = record.errorType || "";
    const actions = [
      failures.includes("商品") || failures.includes("服务") ? "补充商品/服务别名和拆分规则，要求多个商品逐一提取。" : "",
      failures.includes("数量") ? "强化数量识别规则，识别中文数字、口语数量、套/盒/包/小时等单位。" : "",
      failures.includes("地址") || failures.includes("时间") ? "强化地址和时间提取，保留客户提到的门禁、楼层、目的国、目的港、交期。" : "",
      failures.includes("缺失") ? "补充缺失信息规则：缺电话、详细地址、数量、规格、目的地、贸易条款、订单号或照片时必须列出。" : "",
      failures.includes("风险") ? "补充风险规则：库存、价格、配送、包邮、成色、售后证据、上门排期、MOQ、付款和认证都要提示人工确认。" : "",
      failures.includes("回复") ? "优化回复模板：回复要短、自然、有一点情绪。先接住客户需求，再问缺失信息；中文场景可在整段最后一句用 ~，不要每句话都加；避免承诺一定有货、一定送达、最低价或无条件退款。" : "",
      failures.includes("状态") ? "固定订单状态规则：缺关键信息用待补充，询价用待报价，售后/退款/质量问题用售后中，已拍待发用处理中。" : "",
    ].filter(Boolean);
    updateRecord(record.id, { improvementAction: actions.join("\n") || "根据失败维度补充规则，并复测该样本。" });
  }

  function makeRecordFromRunResult(run: EvaluationRun, result: EvaluationRun["results"][number]): OptimizationRecord {
    return {
      id: createId("opt"),
      source: "evaluation",
      sampleId: result.sampleId,
      businessType: result.businessType,
      rawMessage: result.message,
      aiOutput: [
        `状态：${result.outputStatus || "未记录"}`,
        `摘要：${result.outputSummary || "未记录"}`,
        `回复：${result.outputReply || "未记录"}`,
      ].join("\n"),
      errorType: result.failedMetrics.join("、"),
      correctResult: "请根据该样本的期望字段补充正确商品/服务、数量、地址/时间、缺失信息、风险点、回复和订单状态。",
      improvementAction: "先判断失败维度属于提示词、商品拆分、缺失信息规则、风险规则还是话术模板，再修改对应配置并复测。",
      status: "待优化",
      priority: result.score <= 4 ? "高" : result.score <= 5 ? "中" : "低",
      optimized: false,
      updatedAt: new Date().toISOString(),
    };
  }

  function toggleSample(sampleId: string) {
    setSelectedSampleIds((current) => (current.includes(sampleId) ? current.filter((id) => id !== sampleId) : [...current, sampleId]));
  }

  function importSelectedFailedSamples() {
    if (!selectedRun) return;
    const existingKeys = new Set(records.map((record) => `${record.sampleId || ""}:${record.errorType}`));
    const targets = failedRunResults.filter((result) => selectedSampleIds.includes(result.sampleId));
    const imported = targets
      .map((result) => makeRecordFromRunResult(selectedRun, result))
      .filter((record) => !existingKeys.has(`${record.sampleId || ""}:${record.errorType}`));
    if (imported.length === 0) return;
    persist([...imported, ...records]);
    setSelectedSampleIds([]);
    setStatusFilter("待优化");
  }

  function selectAllFailedSamples() {
    setSelectedSampleIds(failedRunResults.map((result) => result.sampleId));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">优化中心</h1>
          <p className="mt-1 text-sm text-slate-500">把压测失败样本沉淀成待办，逐条优化提示词、商品拆分、缺失信息规则和话术模板。</p>
        </div>
        <Link className={secondaryButtonClass} href="/evaluation">回到样本压测</Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="待优化" value={stats.待优化} tone="bad" />
        <StatCard label="已优化" value={stats.已优化} tone="neutral" />
        <StatCard label="已复测" value={stats.已复测} tone="good" />
      </div>

      <Section title="从压测结果选择优化项" description="先选择一次历史压测，再勾选失败样本导入优化清单。以后不用逐条回到压测页点加入。">
        {runs.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            还没有保存过的压测结果。请先回到样本压测页，完整跑完一次“基础 50 条”或“刁钻 50 条”。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <Field label="历史压测">
                <select
                  className={inputClass}
                  value={selectedRun?.id || ""}
                  onChange={(event) => {
                    setSelectedRunId(event.target.value);
                    setSelectedSampleIds([]);
                  }}
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.sampleGroup}样本 · {run.totalSamples} 条 · {Math.round(run.average)}% · {new Date(run.createdAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
              <button className={secondaryButtonClass} onClick={selectAllFailedSamples} disabled={failedRunResults.length === 0}>
                全选失败项
              </button>
              <button className={primaryButtonClass} onClick={importSelectedFailedSamples} disabled={selectedSampleIds.length === 0}>
                导入选中 {selectedSampleIds.length} 条
              </button>
            </div>

            {failedRunResults.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">这次压测没有失败项。</div>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
                {failedRunResults.map((result) => (
                  <label key={result.sampleId} className="grid cursor-pointer gap-3 border-b border-slate-100 p-3 text-sm last:border-b-0 lg:grid-cols-[auto_1fr_0.8fr]">
                    <input type="checkbox" checked={selectedSampleIds.includes(result.sampleId)} onChange={() => toggleSample(result.sampleId)} />
                    <div>
                      <div className="font-semibold text-slate-950">{result.sampleId} · {result.title}</div>
                      <div className="mt-1 text-slate-500">{result.message}</div>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-950">{result.score}/7</div>
                      <div className="mt-1 text-slate-600">{result.failedMetrics.join("、")}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="新增优化记录" description="也可以在样本压测页点击“加入优化中心”，自动带入失败维度和期望结果。">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="原始客户消息">
            <textarea className={`${textareaClass} min-h-32`} value={form.rawMessage} onChange={(event) => setForm({ ...form, rawMessage: event.target.value })} />
          </Field>
          <Field label="AI 输出">
            <textarea className={`${textareaClass} min-h-32`} value={form.aiOutput} onChange={(event) => setForm({ ...form, aiOutput: event.target.value })} />
          </Field>
          <Field label="失败维度/错误类型">
            <input className={inputClass} value={form.errorType} onChange={(event) => setForm({ ...form, errorType: event.target.value })} placeholder="如：缺失信息不完整、风险点不合理、回复不可直接发" />
          </Field>
          <Field label="优先级">
            <select className={inputClass} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as OptimizationRecord["priority"] })}>
              {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </Field>
          <Field label="正确结果/期望输出">
            <textarea className={`${textareaClass} min-h-28`} value={form.correctResult} onChange={(event) => setForm({ ...form, correctResult: event.target.value })} />
          </Field>
          <Field label="准备怎么优化">
            <textarea className={`${textareaClass} min-h-28`} value={form.improvementAction || ""} onChange={(event) => setForm({ ...form, improvementAction: event.target.value })} placeholder="例如：补充商家规则、改提示词、加入商品别名、调整状态规则" />
          </Field>
        </div>
        <button className={`${primaryButtonClass} mt-4`} onClick={addRecord} disabled={!form.rawMessage.trim()}>保存优化记录</button>
      </Section>

      <Section title="优化清单" description="建议先处理高优先级和重复出现的失败维度，优化后回到样本压测复测。">
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div className="font-semibold text-slate-900">怎么选保存方式</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <p>保存成话术模板：适合你把 AI 输出改成更像真人、更短、更能直接发客户的回复。</p>
            <p>应用到商家规则：适合“不承诺有货、价格要确认、缺电话必须追问”这类判断底线。</p>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {statuses.map((status) => (
            <button key={status} className={statusFilter === status ? primaryButtonClass : secondaryButtonClass} onClick={() => setStatusFilter(status)}>
              {status}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {filteredRecords.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">暂无记录。可以先去样本压测页把失败样本加入优化中心。</div>
          ) : (
            filteredRecords.map((record) => (
              <OptimizationCard key={record.id} record={record} onUpdate={updateRecord} onDelete={removeRecord} onSuggest={suggestAction} onApplyRule={applyToMerchantRules} onApplyTemplate={applyToTemplate} />
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function OptimizationCard({
  record,
  onUpdate,
  onDelete,
  onSuggest,
  onApplyRule,
  onApplyTemplate,
}: {
  record: OptimizationRecord;
  onUpdate: (id: string, patch: Partial<OptimizationRecord>) => void;
  onDelete: (id: string) => void;
  onSuggest: (record: OptimizationRecord) => void;
  onApplyRule: (record: OptimizationRecord) => void;
  onApplyTemplate: (record: OptimizationRecord) => void;
}) {
  const businessLabel = record.businessType ? businessTypeLabels[record.businessType as BusinessType] : "手动记录";
  return (
    <article className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-950">{record.sampleId || "手动优化"}</span>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{businessLabel}</span>
            <span className={`rounded px-2 py-1 text-xs font-semibold ${record.priority === "高" ? "bg-red-50 text-red-700" : record.priority === "中" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{record.priority || "中"}优先级</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">更新于 {new Date(record.updatedAt).toLocaleString()}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={inputClass} value={record.status || (record.optimized ? "已优化" : "待优化")} onChange={(event) => onUpdate(record.id, { status: event.target.value as OptimizationRecord["status"] })}>
            <option value="待优化">待优化</option>
            <option value="已优化">已优化</option>
            <option value="已复测">已复测</option>
          </select>
          <button className={secondaryButtonClass} onClick={() => onSuggest(record)}>生成优化建议</button>
          <button className={primaryButtonClass} onClick={() => onApplyRule(record)}>应用到商家规则</button>
          <button className={secondaryButtonClass} onClick={() => onApplyTemplate(record)}>保存成话术模板</button>
          <button className={secondaryButtonClass} onClick={() => onDelete(record.id)}>删除</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <EditableText title="原始消息" value={record.rawMessage} onChange={(value) => onUpdate(record.id, { rawMessage: value })} />
        <EditableText title="AI 输出" value={record.aiOutput} onChange={(value) => onUpdate(record.id, { aiOutput: value })} />
        <EditableText title="失败维度/错误类型" value={record.errorType} onChange={(value) => onUpdate(record.id, { errorType: value })} />
        <EditableText title="正确结果/期望输出" value={record.correctResult} onChange={(value) => onUpdate(record.id, { correctResult: value })} />
        <EditableText title="准备怎么优化" value={record.improvementAction || ""} onChange={(value) => onUpdate(record.id, { improvementAction: value })} wide />
      </div>
    </article>
  );
}

function EditableText({ title, value, onChange, wide = false }: { title: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className={wide ? "lg:col-span-2" : ""}>
      <span className="mb-1 block text-sm font-semibold text-slate-800">{title}</span>
      <textarea className={`${textareaClass} min-h-24`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "good" | "bad" | "neutral" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-slate-950";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
