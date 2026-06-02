"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getOrders } from "@/lib/storage";

const navItems: Array<{ href: string; label: string; badge?: "newOrders" }> = [
  { href: "/", label: "工作台" },
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

export function AppNav() {
  const [newOrderCount, setNewOrderCount] = useState(0);

  useEffect(() => {
    const refresh = () => setNewOrderCount(getNewOrderCount());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("orders-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("orders-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <nav className="flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {navItems.map((item) => {
        const count = item.badge === "newOrders" ? newOrderCount : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex min-h-10 items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
          >
            <span>{item.label}</span>
            {count > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold leading-none text-white">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
