import type { OrderStats } from "@/lib/orderUtils";

const items = [
  { key: "todayNew", label: "今日新增客户", tone: "bg-emerald-50 text-emerald-700" },
  { key: "missingInfo", label: "待补信息", tone: "bg-amber-50 text-amber-700" },
  { key: "pendingQuote", label: "待报价", tone: "bg-sky-50 text-sky-700" },
  { key: "highIntent", label: "高意向客户", tone: "bg-rose-50 text-rose-700" },
  { key: "afterSales", label: "售后中", tone: "bg-violet-50 text-violet-700" },
] as const;

export type StatsCardKey = (typeof items)[number]["key"];

type StatsCardsProps = {
  stats: OrderStats;
  activeKey?: StatsCardKey | null;
  onSelect?: (key: StatsCardKey) => void;
};

export function StatsCards({ stats, activeKey, onSelect }: StatsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map((item) => {
        const active = activeKey === item.key;
        const content = (
          <>
            <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-white text-slate-950" : item.tone}`}>{item.label}</div>
            <div className={`mt-2 text-2xl font-semibold ${active ? "text-white" : "text-slate-950"}`}>{stats[item.key]}</div>
            {onSelect ? <div className={`mt-2 text-xs font-medium ${active ? "text-slate-200" : "text-slate-400"}`}>{active ? "正在查看" : "点击查看项目"}</div> : null}
          </>
        );

        if (!onSelect) {
          return (
            <div key={item.key} className="rounded-2xl border border-white bg-white/90 p-4 shadow-lg shadow-slate-200/50 ring-1 ring-slate-100">
              {content}
            </div>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            className={`rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${active ? "border-slate-950 bg-slate-950 shadow-slate-300/60" : "border-white bg-white/90 shadow-slate-200/50 hover:border-sky-100 hover:bg-sky-50/70"}`}
            onClick={() => onSelect(item.key)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
