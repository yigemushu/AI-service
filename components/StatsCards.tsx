import type { OrderStats } from "@/lib/orderUtils";

const items = [
  { key: "todayNew", label: "今日新增客户" },
  { key: "missingInfo", label: "待补信息" },
  { key: "pendingQuote", label: "待报价" },
  { key: "highIntent", label: "高意向客户" },
  { key: "afterSales", label: "售后中" },
] as const;

export function StatsCards({ stats }: { stats: OrderStats }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">{item.label}</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{stats[item.key]}</div>
        </div>
      ))}
    </div>
  );
}
