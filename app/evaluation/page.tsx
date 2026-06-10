"use client";

import { useEffect, useMemo, useState } from "react";
import { Section } from "@/components/Section";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { businessTypeLabels, mergeDefaultTemplates } from "@/lib/constants";
import { evaluationMetrics, evaluationSamples, scoreEvaluationSample, type EvaluationScore } from "@/lib/evaluationSamples";
import { createId, getEvaluationRuns, getOptimizationRecords, getSettings, getTemplates, saveEvaluationRuns, saveOptimizationRecords, saveTemplates } from "@/lib/storage";
import type { AnalyzeApiResponse, BusinessType, EvaluationRun, OptimizationRecord } from "@/lib/types";

type RunResult = {
  sampleId: string;
  output?: AnalyzeApiResponse;
  score?: EvaluationScore;
  error?: string;
  savedToOptimization?: boolean;
};

const targetLine = 75;

function toPercent(value: number) {
  return `${Math.round(value)}%`;
}

function getAverage(results: RunResult[]) {
  const scored = results.filter((result) => result.score);
  if (scored.length === 0) return 0;
  const total = scored.reduce((sum, result) => sum + (result.score?.total || 0), 0);
  return (total / (scored.length * evaluationMetrics.length)) * 100;
}

function getBusinessCounts(samples: typeof evaluationSamples) {
  return samples.reduce<Record<BusinessType, number>>(
    (counts, sample) => ({ ...counts, [sample.businessType]: counts[sample.businessType] + 1 }),
    { sam: 0, xianyu: 0, virtual: 0, local: 0, trade: 0 },
  );
}

function buildRun(sampleGroup: EvaluationRun["sampleGroup"], samples: typeof evaluationSamples, results: RunResult[]): EvaluationRun {
  const scored = results.filter((result) => result.score);
  const totalScore = scored.reduce((sum, result) => sum + (result.score?.total || 0), 0);
  const totalPossible = scored.length * evaluationMetrics.length;
  const byType = samples.reduce<Record<BusinessType, { count: number; score: number; possible: number }>>(
    (summary, sample) => {
      const result = results.find((item) => item.sampleId === sample.id);
      const score = result?.score?.total || 0;
      summary[sample.businessType].count += 1;
      summary[sample.businessType].score += score;
      summary[sample.businessType].possible += result?.score ? evaluationMetrics.length : 0;
      return summary;
    },
    {
      sam: { count: 0, score: 0, possible: 0 },
      xianyu: { count: 0, score: 0, possible: 0 },
      virtual: { count: 0, score: 0, possible: 0 },
      local: { count: 0, score: 0, possible: 0 },
      trade: { count: 0, score: 0, possible: 0 },
    },
  );
  const metricFails = Object.fromEntries(
    evaluationMetrics.map((metric) => [metric, results.filter((result) => result.score && !result.score.metrics[metric]).length]),
  );
  return {
    id: createId("eval"),
    sampleGroup,
    createdAt: new Date().toISOString(),
    average: totalPossible > 0 ? (totalScore / totalPossible) * 100 : 0,
    totalSamples: samples.length,
    totalScore,
    totalPossible,
    byType: {
      sam: { count: byType.sam.count, average: byType.sam.possible ? (byType.sam.score / byType.sam.possible) * 100 : 0 },
      xianyu: { count: byType.xianyu.count, average: byType.xianyu.possible ? (byType.xianyu.score / byType.xianyu.possible) * 100 : 0 },
      virtual: { count: byType.virtual.count, average: byType.virtual.possible ? (byType.virtual.score / byType.virtual.possible) * 100 : 0 },
      local: { count: byType.local.count, average: byType.local.possible ? (byType.local.score / byType.local.possible) * 100 : 0 },
      trade: { count: byType.trade.count, average: byType.trade.possible ? (byType.trade.score / byType.trade.possible) * 100 : 0 },
    },
    metricFails,
    results: samples.map((sample) => {
      const result = results.find((item) => item.sampleId === sample.id);
      return {
        sampleId: sample.id,
        businessType: sample.businessType,
        title: sample.title,
        message: sample.message,
        score: result?.score?.total || 0,
        failedMetrics: result?.score?.notes || evaluationMetrics,
        outputSummary: result?.output?.summary,
        outputReply: result?.output?.reply,
        outputStatus: result?.output?.order_status,
      };
    }),
  };
}

export default function EvaluationPage() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const [savedRuns, setSavedRuns] = useState<EvaluationRun[]>([]);
  const [current, setCurrent] = useState("");
  const [sampleGroup, setSampleGroup] = useState<"基础" | "刁钻" | "全部">("刁钻");
  const activeSamples = useMemo(
    () => evaluationSamples.filter((sample) => sampleGroup === "全部" || (sample.sampleGroup || "基础") === sampleGroup),
    [sampleGroup],
  );
  const businessCounts = useMemo(() => getBusinessCounts(activeSamples), [activeSamples]);
  const average = getAverage(results);
  const finishedCount = results.filter((result) => result.score || result.error).length;

  useEffect(() => {
    setSavedRuns(getEvaluationRuns());
  }, []);

  async function analyzeSample(sample: (typeof evaluationSamples)[number]) {
    const settings = getSettings();
    const storedTemplates = getTemplates();
    const templates = mergeDefaultTemplates(storedTemplates);
    if (templates.length !== storedTemplates.length) saveTemplates(templates);
    const enabledTemplates = templates
      .filter((template) => template.enabled && template.businessType === sample.businessType)
      .map(({ name, scenario, requiredInfo, content }) => ({ name, scenario, requiredInfo, content }));
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatText: sample.message,
        businessType: sample.businessType,
        systemPrompt: settings.systemPrompt,
        sellerRules: settings.merchantRules,
        enabledTemplates,
      }),
    });
    const data = (await response.json()) as AnalyzeApiResponse & { error?: string };
    if (!response.ok || data.error) throw new Error(data.error || "分析失败");
    return data;
  }

  async function runAll() {
    setRunning(true);
    setResults([]);
    setCurrent("");
    const nextResults: RunResult[] = [];
    for (const sample of activeSamples) {
      setCurrent(`${sample.id} ${sample.title}`);
      try {
        const output = await analyzeSample(sample);
        const score = scoreEvaluationSample(sample, output);
        nextResults.push({ sampleId: sample.id, output, score });
      } catch (error) {
        nextResults.push({ sampleId: sample.id, error: error instanceof Error ? error.message : "分析失败" });
      }
      setResults([...nextResults]);
    }
    const run = buildRun(sampleGroup, activeSamples, nextResults);
    const nextRuns = [run, ...getEvaluationRuns()].slice(0, 20);
    saveEvaluationRuns(nextRuns);
    setSavedRuns(nextRuns);
    setCurrent("");
    setRunning(false);
  }

  function clearResults() {
    setResults([]);
    setCurrent("");
  }

  function saveToOptimization(sampleId: string) {
    const sample = evaluationSamples.find((item) => item.id === sampleId);
    const result = results.find((item) => item.sampleId === sampleId);
    if (!sample || !result?.score || !result.output) return;
    const record: OptimizationRecord = {
      id: createId("opt"),
      source: "evaluation",
      sampleId: sample.id,
      businessType: sample.businessType,
      rawMessage: sample.message,
      aiOutput: [
        `状态：${result.output.order_status}`,
        `摘要：${result.output.summary}`,
        `回复：${result.output.reply}`,
        `缺失信息：${result.output.missing_info.join("、") || "无"}`,
        `风险点：${result.output.risk_flags.join("、") || "无"}`,
      ].join("\n"),
      errorType: result.score.notes.join("、"),
      correctResult: [
        `期望状态：${sample.expected.status}`,
        `期望商品/服务：${sample.expected.itemKeywords.join("、") || "无"}`,
        `期望数量：${sample.expected.quantityKeywords.join("、") || "无"}`,
        `期望地址/时间：${sample.expected.addressOrTimeKeywords.join("、") || "无"}`,
        `期望缺失信息：${sample.expected.missingKeywords.join("、") || "无"}`,
        `期望风险点：${sample.expected.riskKeywords.join("、") || "无"}`,
      ].join("\n"),
      improvementAction: "请根据失败维度优化提示词、商品拆分规则、缺失信息规则或话术模板，然后回到样本压测复测。",
      status: "待优化",
      priority: result.score.total <= 4 ? "高" : result.score.total <= 5 ? "中" : "低",
      optimized: false,
      updatedAt: new Date().toISOString(),
    };
    saveOptimizationRecords([record, ...getOptimizationRecords()]);
    setResults((currentResults) => currentResults.map((item) => (item.sampleId === sampleId ? { ...item, savedToOptimization: true } : item)));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">样本压测</h1>
          <p className="mt-1 text-sm text-slate-500">用 50 条真实/半真实聊天记录评估 AI 分析准确率，低于目标时优先优化提示词、商品拆分和话术模板。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButtonClass} onClick={runAll} disabled={running}>{running ? "压测中..." : "开始 50 条压测"}</button>
          <button className={secondaryButtonClass} onClick={clearResults} disabled={running || results.length === 0}>清空结果</button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <ScoreCard label="当前样本" value={`${activeSamples.length}`} />
        <ScoreCard label="山姆/代下单" value={`${businessCounts.sam}`} />
        <ScoreCard label="闲鱼卖货" value={`${businessCounts.xianyu}`} />
        <ScoreCard label="虚拟服务" value={`${businessCounts.virtual}`} />
        <ScoreCard label="本地服务" value={`${businessCounts.local}`} />
        <ScoreCard label="外贸询盘" value={`${businessCounts.trade}`} />
        <ScoreCard label="平均准确率" value={results.length ? toPercent(average) : "-"} tone={average >= targetLine ? "good" : results.length ? "bad" : "neutral"} />
      </div>

      <Section title="样本集" description="基础样本用于稳定性基线，刁钻样本用于发现真实外测中的边界问题。">
        <div className="flex flex-wrap gap-2">
          {(["刁钻", "基础", "全部"] as const).map((group) => (
            <button
              key={group}
              className={group === sampleGroup ? primaryButtonClass : secondaryButtonClass}
              onClick={() => {
                setSampleGroup(group);
                setResults([]);
                setCurrent("");
              }}
              disabled={running}
            >
              {group === "全部" ? "全部 100 条" : `${group} 50 条`}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="压测结论"
        description="目标是平均准确率达到 75%-80%。每次完整压测会自动保存，失败样本可以一键进入优化中心。"
      >
        <div className="flex flex-col gap-3 text-sm text-slate-700">
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${average >= targetLine ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, average)}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>已完成 {finishedCount} / {activeSamples.length} 条</span>
            <span className="font-semibold text-slate-950">
              {results.length === 0 ? "尚未开始" : average >= targetLine ? "已达到外测准确率目标" : "未达标，下一步应优化提示词、商品拆分和话术模板"}
            </span>
          </div>
          {current ? <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">正在分析：{current}</div> : null}
        </div>
      </Section>

      <Section title="历史压测记录" description="保留最近 20 次完整压测，方便对比优化前后的变化。">
        <div className="space-y-3">
          {savedRuns.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无历史记录，先运行一次完整压测。</div>
          ) : (
            savedRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="grid gap-3 rounded-md border border-slate-200 p-3 text-sm sm:grid-cols-[1.2fr_0.8fr_1fr]">
                <div>
                  <div className="font-semibold text-slate-950">{run.sampleGroup}样本 · {run.totalSamples} 条</div>
                  <div className="mt-1 text-slate-500">{new Date(run.createdAt).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-500">平均准确率</div>
                  <div className={`mt-1 text-lg font-semibold ${run.average >= targetLine ? "text-emerald-700" : "text-amber-700"}`}>{toPercent(run.average)}</div>
                </div>
                <div className="text-slate-600">
                  山姆 {toPercent(run.byType.sam.average)} · 闲鱼 {toPercent(run.byType.xianyu.average)} · 虚拟 {toPercent(run.byType.virtual?.average || 0)} · 本地 {toPercent(run.byType.local.average)} · 外贸 {toPercent(run.byType.trade.average)}
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="评分明细" description="每条样本按 7 个维度打分，绿色为通过，红色为需要优化。">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead className="text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">样本</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">得分</th>
                {evaluationMetrics.map((metric) => <th key={metric} className="px-3 py-2">{metric}</th>)}
                <th className="px-3 py-2">需要优化</th>
              </tr>
            </thead>
            <tbody>
              {activeSamples.map((sample) => {
                const result = results.find((item) => item.sampleId === sample.id);
                return (
                  <tr key={sample.id} className="bg-white align-top shadow-sm">
                    <td className="rounded-l-md border-y border-l border-slate-200 px-3 py-3">
                      <div className="font-semibold text-slate-950">{sample.id}</div>
                      <div className="mt-1 max-w-80 text-slate-600">{sample.title}</div>
                      <div className="mt-2 max-w-96 text-xs leading-5 text-slate-500">{sample.message}</div>
                    </td>
                    <td className="border-y border-slate-200 px-3 py-3">{businessTypeLabels[sample.businessType]}</td>
                    <td className="border-y border-slate-200 px-3 py-3 font-semibold text-slate-950">
                      {result?.score ? `${result.score.total}/${evaluationMetrics.length}` : result?.error ? "失败" : "-"}
                    </td>
                    {evaluationMetrics.map((metric) => (
                      <td key={metric} className="border-y border-slate-200 px-3 py-3">
                        {result?.score ? <StatusPill ok={result.score.metrics[metric]} /> : <span className="text-slate-400">-</span>}
                      </td>
                    ))}
                    <td className="rounded-r-md border-y border-r border-slate-200 px-3 py-3">
                      {result?.error ? (
                        <span className="text-red-700">{result.error}</span>
                      ) : result?.score?.notes.length ? (
                        <div className="max-w-80 space-y-2 text-slate-600">
                          <div>{result.score.notes.join("、")}</div>
                          <button className={secondaryButtonClass} onClick={() => saveToOptimization(sample.id)} disabled={result.savedToOptimization}>
                            {result.savedToOptimization ? "已加入优化中心" : "加入优化中心"}
                          </button>
                        </div>
                      ) : result?.score ? (
                        <span className="text-emerald-700">通过</span>
                      ) : (
                        <span className="text-slate-400">待运行</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ScoreCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-amber-700" : "text-slate-950";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      {ok ? "通过" : "未过"}
    </span>
  );
}
