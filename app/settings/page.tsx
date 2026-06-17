"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { defaultSettings } from "@/lib/constants";
import { demoOrders } from "@/lib/demoData";
import { getOrders, getSettings, saveOrders, saveSettings } from "@/lib/storage";
import type { Settings } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    setSettings(getSettings());
    setOrigin(window.location.origin);
  }, []);

  function flashSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function save() {
    saveSettings(settings);
    flashSaved();
  }

  function loadDemoData() {
    const existing = getOrders().filter((order) => !order.id.startsWith("demo_"));
    saveOrders([...demoOrders, ...existing]);
    flashSaved();
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(successMessage);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopyMessage(copied ? successMessage : "复制失败，请手动复制");
    }
    window.setTimeout(() => setCopyMessage(""), 1800);
  }

  function pluginConfigText() {
    return [
      `网站地址：${origin}`,
      `Webhook Token：${settings.inboxWebhookToken || ""}`,
    ].join("\n");
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">设置</h1>
        <p className="mt-1 text-sm text-slate-500">配置系统提示词、商家规则和演示数据。API Key 只放在本地环境变量中。</p>
      </header>
      <Section title="AI 与商家规则">
        <div className="space-y-4">
          <Field label="系统提示词"><textarea className={`${textareaClass} min-h-36`} value={settings.systemPrompt} onChange={(event) => setSettings({ ...settings, systemPrompt: event.target.value })} /></Field>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            API Key 请放在项目根目录的 <code className="font-mono">.env.local</code>，不要发到聊天或提交到 GitHub。
          </div>
          <Field label="商家规则"><textarea className={`${textareaClass} min-h-36`} value={settings.merchantRules} onChange={(event) => setSettings({ ...settings, merchantRules: event.target.value })} /></Field>
          <Field label="消息中心 Webhook Token">
            <input
              className={inputClass}
              type="password"
              value={settings.inboxWebhookToken || ""}
              onChange={(event) => setSettings({ ...settings, inboxWebhookToken: event.target.value })}
              placeholder="需要与服务端 .env.local 的 INBOX_WEBHOOK_TOKEN 一致"
            />
          </Field>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            当前 Token 会保存在本浏览器 localStorage，用于消息中心同步和复制给插件。服务端 /api/inbox 不会读取浏览器 localStorage；本地开发请写入项目根目录 <code className="font-mono">.env.local</code> 的 <code className="font-mono">INBOX_WEBHOOK_TOKEN</code> 后重启 <code className="font-mono">npm run dev</code>，云端请写入服务器环境变量后重启 PM2。
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className={primaryButtonClass} onClick={save}>保存设置</button>
            {saved ? <span className="text-sm font-medium text-emerald-700">已保存</span> : null}
          </div>
        </div>
      </Section>
      <Section title="浏览器插件配置">
        <div className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            本地网站用本地 Token，云端网站用云端 Token。插件里填写的网站地址和 Webhook Token 必须来自同一个环境，并且这个 Token 必须已经写入对应服务端环境变量。
          </div>
          <Field label="当前网站地址">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className={inputClass} value={origin} readOnly />
              <button type="button" className={secondaryButtonClass} onClick={() => copyText(origin, "已复制网站地址")}>复制</button>
            </div>
          </Field>
          <Field label="当前 Webhook Token">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className={inputClass} value={settings.inboxWebhookToken || ""} readOnly placeholder="请先在上方填写并保存 Token" />
              <button type="button" className={secondaryButtonClass} onClick={() => copyText(settings.inboxWebhookToken || "", "已复制 Token")} disabled={!settings.inboxWebhookToken}>复制</button>
            </div>
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" className={primaryButtonClass} onClick={() => copyText(pluginConfigText(), "已复制插件配置")}>复制插件配置</button>
            {copyMessage ? <span className="text-sm font-medium text-emerald-700">{copyMessage}</span> : null}
          </div>
        </div>
      </Section>
      <Section title="演示数据">
        <button type="button" className={secondaryButtonClass} onClick={loadDemoData}>加载演示数据</button>
      </Section>
    </div>
  );
}
