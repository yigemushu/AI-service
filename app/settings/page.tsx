"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { Section } from "@/components/Section";
import { inputClass, primaryButtonClass, secondaryButtonClass, textareaClass } from "@/components/ui";
import { defaultSettings } from "@/lib/constants";
import { demoOrders } from "@/lib/demoData";
import { getOrders, getSettings, saveOrders, saveSettings } from "@/lib/storage";
import type { Settings } from "@/lib/types";

type TokenSource = "env" | "settings" | "none";

type SettingsApiResponse = {
  siteOrigin?: string;
  inboxWebhookToken?: string;
  tokenSource?: TokenSource;
  error?: string;
};

async function fetchJsonWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    let data: SettingsApiResponse = {};
    try {
      data = text ? (JSON.parse(text) as SettingsApiResponse) : {};
    } catch {
      throw new Error("接口没有返回有效 JSON");
    }
    return { response, data };
  } finally {
    window.clearTimeout(timeout);
  }
}

function base64UrlEncode(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [siteOrigin, setSiteOrigin] = useState("");
  const [effectiveToken, setEffectiveToken] = useState("");
  const [tokenSource, setTokenSource] = useState<TokenSource>("none");
  const [loadingToken, setLoadingToken] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [pluginCode, setPluginCode] = useState("");
  const [pluginPlatform, setPluginPlatform] = useState("闲鱼");
  const [pluginBusinessType, setPluginBusinessType] = useState("闲鱼卖货");

  useEffect(() => {
    const localSettings = getSettings();
    setSettings(localSettings);
    setSiteOrigin(window.location.origin);
    loadEffectiveToken();
  }, []);

  async function loadEffectiveToken() {
    setLoadingToken(true);
    setStatusMessage("");
    try {
      const { response, data } = await fetchJsonWithTimeout("/api/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const nextOrigin = window.location.origin || data.siteOrigin || "";
      const nextToken = data.inboxWebhookToken || "";
      setSiteOrigin(nextOrigin);
      setEffectiveToken(nextToken);
      setTokenSource(data.tokenSource || "none");
      saveSettings({ ...getSettings(), inboxWebhookToken: nextToken });
      if (!nextToken) {
        setStatusMessage("当前未配置 Webhook Token，请先在 .env.local 配置 INBOX_WEBHOOK_TOKEN 并重启服务。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "请刷新或检查 /api/settings";
      setTokenSource("none");
      setEffectiveToken("");
      setStatusMessage(`读取设置失败：${message}`);
    } finally {
      setLoadingToken(false);
    }
  }

  function saveLocalSettings() {
    saveSettings({ ...settings, inboxWebhookToken: effectiveToken });
    setStatusMessage("设置已保存");
    window.setTimeout(() => setStatusMessage(""), 1800);
  }

  function loadDemoData() {
    const existing = getOrders().filter((order) => !order.id.startsWith("demo_"));
    saveOrders([...demoOrders, ...existing]);
    setStatusMessage("演示数据已加载");
    window.setTimeout(() => setStatusMessage(""), 1800);
  }

  function generatePluginCode() {
    if (!siteOrigin) {
      setStatusMessage("当前网站地址还没有读取到，请刷新页面后重试。");
      return;
    }
    if (!effectiveToken) {
      setStatusMessage("当前未配置 Webhook Token，请先在 .env.local 配置 INBOX_WEBHOOK_TOKEN 并重启服务。");
      return;
    }
    const config = {
      version: 1,
      siteOrigin,
      webhookToken: effectiveToken,
      platform: pluginPlatform,
      businessType: pluginBusinessType,
    };
    setPluginCode(`aics_${base64UrlEncode(JSON.stringify(config))}`);
    setStatusMessage("插件连接码已生成");
  }

  async function copyText(text: string, successMessage: string) {
    if (!text) {
      setCopyMessage("暂无可复制内容");
      window.setTimeout(() => setCopyMessage(""), 1800);
      return;
    }
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

  const tokenSourceLabel = tokenSource === "env" ? "env" : tokenSource === "settings" ? "settings" : "none";
  const canGenerateCode = Boolean(siteOrigin && effectiveToken && !loadingToken);
  const legacyPluginConfig = useMemo(
    () => [`网站地址：${siteOrigin}`, `Webhook Token：${effectiveToken}`, "说明：插件网站地址和 Token 必须匹配同一个环境。"].join("\n"),
    [siteOrigin, effectiveToken],
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">设置</h1>
        <p className="mt-1 text-sm text-slate-500">配置商家规则，并生成浏览器插件连接码。API Key 和 Webhook Token 的正式值由服务端环境决定。</p>
      </header>

      <Section title="AI 与商家规则">
        <div className="space-y-4">
          <Field label="系统提示词">
            <textarea className={`${textareaClass} min-h-36`} value={settings.systemPrompt} onChange={(event) => setSettings({ ...settings, systemPrompt: event.target.value })} />
          </Field>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            API Key 和正式 Webhook Token 请放在项目根目录的 <code className="font-mono">.env.local</code> 或云端服务器环境变量中，不要发到聊天或提交到 GitHub。
          </div>

          <Field label="商家规则">
            <textarea className={`${textareaClass} min-h-36`} value={settings.merchantRules} onChange={(event) => setSettings({ ...settings, merchantRules: event.target.value })} />
          </Field>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" className={primaryButtonClass} onClick={saveLocalSettings}>保存设置</button>
            {statusMessage ? <span className="text-sm font-medium text-emerald-700">{statusMessage}</span> : null}
          </div>
        </div>
      </Section>

      <Section title="浏览器插件连接码">
        <div className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            连接码包含当前生效 Webhook Token，请不要发给无关人员。主流程只复制连接码，不需要单独复制网站地址和 Token。
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="当前网站地址">
              <input className={inputClass} value={siteOrigin} readOnly placeholder="读取中..." />
            </Field>
            <Field label="当前 Token 来源">
              <input className={inputClass} value={loadingToken ? "读取中..." : tokenSourceLabel} readOnly />
            </Field>
            <Field label="当前生效 Webhook Token">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className={inputClass} type="text" value={loadingToken ? "读取中..." : effectiveToken} readOnly placeholder="未配置" />
                <button type="button" className={secondaryButtonClass} onClick={() => copyText(effectiveToken, "已复制 Token")} disabled={!effectiveToken}>复制</button>
              </div>
            </Field>
          </div>

          {!loadingToken && !effectiveToken ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
              当前未配置 Webhook Token，请先在 <code className="font-mono">.env.local</code> 配置 <code className="font-mono">INBOX_WEBHOOK_TOKEN</code> 并重启服务。
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="默认平台">
              <select className={inputClass} value={pluginPlatform} onChange={(event) => setPluginPlatform(event.target.value)}>
                <option value="闲鱼">闲鱼</option>
                <option value="微信">微信</option>
                <option value="淘宝">淘宝</option>
                <option value="拼多多">拼多多</option>
                <option value="Facebook">Facebook</option>
                <option value="eBay">eBay</option>
                <option value="其他">其他</option>
              </select>
            </Field>
            <Field label="默认业务类型">
              <select className={inputClass} value={pluginBusinessType} onChange={(event) => setPluginBusinessType(event.target.value)}>
                <option value="闲鱼卖货">闲鱼卖货</option>
                <option value="虚拟服务">虚拟服务</option>
                <option value="山姆代下单">山姆代下单</option>
                <option value="本地服务">本地服务</option>
                <option value="外贸询盘">外贸询盘</option>
              </select>
            </Field>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={primaryButtonClass} onClick={generatePluginCode} disabled={!canGenerateCode}>生成插件连接码</button>
            <button type="button" className={secondaryButtonClass} onClick={() => copyText(pluginCode, "已复制插件连接码")} disabled={!pluginCode}>复制插件连接码</button>
            <button type="button" className={secondaryButtonClass} onClick={loadEffectiveToken}>重新读取当前 Token</button>
            <Link className={secondaryButtonClass} href="/xianyu-mvp">打开闲鱼闭环验证</Link>
          </div>

          <textarea className={`${textareaClass} min-h-24 font-mono text-xs`} value={pluginCode} readOnly placeholder={canGenerateCode ? "点击“生成插件连接码”后显示 aics_ 开头的连接码" : "当前没有可用 Token，暂不能生成连接码"} />

          <details className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold">高级/兼容复制</summary>
            <p className="mt-2 leading-6">旧版插件仍可复制网站地址和 Token。新插件建议只使用连接码。</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className={secondaryButtonClass} onClick={() => copyText(siteOrigin, "已复制网站地址")} disabled={!siteOrigin}>复制网站地址</button>
              <button type="button" className={secondaryButtonClass} onClick={() => copyText(legacyPluginConfig, "已复制插件配置")} disabled={!siteOrigin || !effectiveToken}>复制旧版插件配置</button>
            </div>
          </details>

          {copyMessage ? <span className="text-sm font-medium text-emerald-700">{copyMessage}</span> : null}
        </div>
      </Section>

      <Section title="演示数据">
        <button type="button" className={secondaryButtonClass} onClick={loadDemoData}>加载演示数据</button>
      </Section>
    </div>
  );
}
