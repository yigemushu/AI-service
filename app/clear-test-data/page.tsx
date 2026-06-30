"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";

const KEEP_KEYS = new Set(["ai-service.demo-auth", "ai-service.settings"]);

function shouldRemoveKey(key: string) {
  if (!key.startsWith("ai-service.")) return false;
  if (KEEP_KEYS.has(key)) return false;
  return true;
}

export default function ClearTestDataPage() {
  const [status, setStatus] = useState("正在清空浏览器和服务端测试数据...");
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);

  useEffect(() => {
    async function clearData() {
      const removed: string[] = [];
      try {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index);
          if (key && shouldRemoveKey(key)) {
            localStorage.removeItem(key);
            removed.push(key);
          }
        }

        try {
          const settingsResponse = await fetch("/api/settings", { cache: "no-store" });
          const settings = await settingsResponse.json().catch(() => ({}));
          const token = typeof settings?.inboxWebhookToken === "string" ? settings.inboxWebhookToken : "";
          if (token) {
            await fetch("/api/test-data/clear", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-webhook-token": token,
              },
              body: JSON.stringify({}),
            });
          }
        } catch {
          // Browser cache is still cleared even when the local server clear request fails.
        }

        window.dispatchEvent(new Event("customer-messages-updated"));
        window.dispatchEvent(new Event("orders-updated"));
        setRemovedKeys(removed.sort());
        setStatus("测试数据已清空。现在可以回到消息中心或客户订单页重新测试。");
      } catch (error) {
        setStatus(`清空失败：${error instanceof Error ? error.message : "请刷新后重试"}`);
      }
    }

    clearData();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-rose-600">测试数据清理</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">清空完成检查</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{status}</p>
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
          <div className="font-semibold text-slate-800">已清理的浏览器缓存键</div>
          {removedKeys.length ? (
            <ul className="mt-2 list-disc pl-5">
              {removedKeys.map((key) => <li key={key}>{key}</li>)}
            </ul>
          ) : (
            <p className="mt-2">当前浏览器没有残留订单或消息缓存。</p>
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className={primaryButtonClass} href="/messages">查看消息中心</Link>
          <Link className={secondaryButtonClass} href="/orders">查看客户订单</Link>
          <Link className={secondaryButtonClass} href="/xianyu-mvp">返回闲鱼验证</Link>
        </div>
      </div>
    </main>
  );
}
