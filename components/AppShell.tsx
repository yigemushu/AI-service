"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { isDemoAuthed, setDemoAuthed } from "@/lib/storage";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState("");

  useEffect(() => {
    setAuthed(isDemoAuthed());
    const refresh = () => setAuthed(isDemoAuthed());
    window.addEventListener("auth-updated", refresh);
    return () => window.removeEventListener("auth-updated", refresh);
  }, []);

  function login() {
    if (account === "admin" && password === "demo123") {
      setDemoAuthed(true);
      setAuthed(true);
      setError("");
      return;
    }
    setError("账号或密码不正确，可使用 admin / demo123 进入演示模式");
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f1e8] px-4">
        <div className="w-full max-w-md rounded-lg border border-amber-100 bg-white p-6 shadow-xl shadow-amber-100/60">
          <div className="mb-6">
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Demo 工作台</div>
            <div className="mt-3 text-2xl font-semibold text-slate-950">AI 客服接单助手</div>
            <p className="mt-2 text-sm text-slate-500">集中处理客户消息、AI 分析订单、人工确认后回复。</p>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">账号</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" value={account} onChange={(event) => setAccount(event.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">密码</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <button className={`${primaryButtonClass} w-full`} onClick={login}>进入演示工作台</button>
            <button
              className={`${secondaryButtonClass} w-full`}
              onClick={() => {
                setAccount("admin");
                setPassword("demo123");
                setDemoAuthed(true);
                setAuthed(true);
              }}
            >
              一键进入 Demo 模式
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f1e8]">
      <aside className="border-b border-amber-100 bg-white/95 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[#111827] text-base font-black text-white">AI</div>
              <div>
                <div className="text-lg font-semibold text-slate-950">客服接单台</div>
                <div className="text-xs font-medium text-slate-500">半自动 · 人工确认</div>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
              新消息进入这里，AI 先分析，你确认后再复制回复。
            </div>
          </div>
          <AppNav />
          <div className="mt-auto px-3 pb-4">
            <button className={`${secondaryButtonClass} w-full`} onClick={() => setDemoAuthed(false)}>退出登录</button>
          </div>
        </div>
      </aside>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
