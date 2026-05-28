"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { defaultSettings } from "@/lib/constants";
import { demoOrders } from "@/lib/demoData";
import { getOrders, getSettings, saveOrders, saveSettings } from "@/lib/storage";
import type { Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  function save() {
    saveSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function loadDemoData() {
    const existing = getOrders().filter((order) => !order.id.startsWith("demo_"));
    saveOrders([...demoOrders, ...existing]);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function clearDemoData() {
    if (!window.confirm("确认清空演示数据吗？你自己保存的非演示订单会保留。")) return;
    saveOrders(getOrders().filter((order) => !order.id.startsWith("demo_")));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">设置</h1>
        <p className="mt-1 text-sm text-slate-500">配置系统提示词、商家规则和演示数据。API Key 只放在本地环境变量中。</p>
      </header>

      <Section title="AI 与商家规则">
        <div className="space-y-4">
          <Field label="系统提示词">
            <textarea className={`${textareaClass} min-h-36`} value={settings.systemPrompt} onChange={(event) => setSettings({ ...settings, systemPrompt: event.target.value })} />
          </Field>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            AI API Key 请配置在项目根目录的 <code className="font-mono">.env.local</code> 中：
            <code className="mt-2 block font-mono text-slate-950">OPENAI_API_KEY=你的 Key</code>
            前端不会保存或发送 API Key，未配置时自动使用 mock 模式。
          </div>
          <Field label="商家规则">
            <textarea className={`${textareaClass} min-h-36`} value={settings.merchantRules} onChange={(event) => setSettings({ ...settings, merchantRules: event.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <button className={primaryButtonClass} onClick={save}>保存设置</button>
            {saved ? <span className="text-sm font-medium text-emerald-700">已保存</span> : null}
          </div>
        </div>
      </Section>

      <Section title="演示数据">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className={secondaryButtonClass} onClick={loadDemoData}>加载演示数据</button>
          <button className={secondaryButtonClass} onClick={clearDemoData}>清空演示数据</button>
        </div>
      </Section>
    </div>
  );
}
