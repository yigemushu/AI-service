"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCustomerMessages, getOrders } from "@/lib/storage";

const navItems: Array<{ href: string; label: string; badge?: "newOrders" | "newMessages" }> = [
  { href: "/", label: "工作台" },
  { href: "/messages", label: "消息中心", badge: "newMessages" },
  { href: "/orders", label: "客户订单", badge: "newOrders" },
  { href: "/knowledge", label: "商家知识库" },
  { href: "/evaluation", label: "样本压测" },
  { href: "/templates", label: "话术模板" },
  { href: "/optimization", label: "优化中心" },
  { href: "/feedback", label: "外测反馈" },
  { href: "/settings", label: "设置" },
] as const;

function getNewOrderCount() {
  return getOrders().filter((order) => order.isNew).length;
}

function getNewMessageCount() {
  return getCustomerMessages().filter((message) => message.isNew).length;
}

export function AppNav() {
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const refresh = () => {
      setNewOrderCount(getNewOrderCount());
      setNewMessageCount(getNewMessageCount());
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("orders-updated", refresh);
    window.addEventListener("customer-messages-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("orders-updated", refresh);
      window.removeEventListener("customer-messages-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <nav className="flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {navItems.map((item) => {
        const count = item.badge === "newOrders" ? newOrderCount : item.badge === "newMessages" ? newMessageCount : 0;
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex min-h-10 items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition lg:text-slate-300 ${active ? "bg-slate-950 text-white shadow-sm ring-1 ring-sky-200/70 lg:bg-white/12 lg:ring-white/10" : "text-slate-700 hover:bg-sky-50 hover:text-sky-800 lg:hover:bg-white/10 lg:hover:text-white"}`}
          >
            <span>{item.label}</span>
            {count > 0 ? (
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold leading-none shadow-sm ${active ? "bg-white text-slate-950" : "bg-rose-500 text-white"}`}>
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
