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
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] px-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <div className="text-xl font-semibold text-slate-950">AI 客服订单助手</div>
            <p className="mt-2 text-sm text-slate-500">Demo 模式用于演示客服分析、订单沉淀和话术优化流程。</p>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">账号</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">密码</span>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <button className={`${primaryButtonClass} w-full`} onClick={login}>
              进入演示工作台
            </button>
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
    <div className="min-h-screen bg-[#f6f7f9]">
      <aside className="border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="px-5 py-5">
            <div className="text-lg font-semibold text-slate-950">AI 客服订单助手</div>
            <div className="mt-1 text-sm text-slate-500">聊天分析 · 订单沉淀 · 话术优化</div>
            <div className="mt-3 inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Demo 模式</div>
          </div>
          <AppNav />
          <div className="mt-auto px-3 pb-4">
            <button
              className={`${secondaryButtonClass} w-full`}
              onClick={() => {
                setDemoAuthed(false);
                setAuthed(false);
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </aside>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
