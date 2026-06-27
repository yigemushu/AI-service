"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { isDemoAuthed, setDemoAuthed } from "@/lib/storage";

const isDemoEnvironment = process.env.NEXT_PUBLIC_APP_ENV === "demo" || process.env.NODE_ENV === "development";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(isDemoEnvironment);
  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isDemoEnvironment) {
      setAuthed(true);
      return;
    }
    setAuthed(isDemoAuthed());
    const refresh = () => setAuthed(isDemoAuthed());
    window.addEventListener("auth-updated", refresh);
    return () => window.removeEventListener("auth-updated", refresh);
  }, []);

  function login() {
    if (account === "admin" && password === "demo123") {
      setAuthed(true);
      setError("");
      setDemoAuthed(true);
      return;
    }
    setError("账号或密码不正确，可使用 admin / demo123 进入演示模式");
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#dff3ff,transparent_32%),linear-gradient(135deg,#f8fbff,#eef4fb)] px-4">
        <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white/90 p-6 shadow-2xl shadow-sky-200/50 ring-1 ring-slate-100 backdrop-blur">
          <div className="mb-6">
            <div className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">Demo 工作台</div>
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
            <button type="button" className={`${primaryButtonClass} w-full`} onClick={login}>进入演示工作台</button>
            <button
              type="button"
              className={`${secondaryButtonClass} w-full`}
              onClick={() => {
                setAccount("admin");
                setPassword("demo123");
                setAuthed(true);
                setDemoAuthed(true);
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
    <div className="min-h-screen">
      <aside className="border-b border-slate-200 bg-white/95 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:w-72 lg:border-b-0 lg:border-r lg:border-slate-200/70 lg:bg-slate-950">
        <div className="flex h-full flex-col">
          <div className="px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-400 to-emerald-300 text-base font-black text-slate-950 shadow-lg shadow-cyan-500/25">AI</div>
              <div>
                <div className="text-lg font-semibold text-slate-950 lg:text-white">客服接单台</div>
                <div className="text-xs font-medium text-slate-500 lg:text-slate-400">半自动 · 人工确认</div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-sky-200/60 bg-sky-50 px-3 py-3 text-xs leading-5 text-sky-800 lg:border-white/10 lg:bg-white/10 lg:text-slate-200">
              新消息进入这里，AI 先分析，你确认后再复制回复。
            </div>
          </div>
          <AppNav />
          <div className="mt-auto px-3 pb-4">
            <button type="button" className={`${secondaryButtonClass} w-full`} onClick={() => {
              setDemoAuthed(false);
              setAuthed(false);
            }}>退出登录</button>
          </div>
        </div>
      </aside>
      <main className="lg:pl-72">
        <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
