import type { PrincipalKpiCard } from "./types";

const toneMap: Record<PrincipalKpiCard["tone"], { card: string; value: string }> = {
  primary: {
    card: "border-blue-200 bg-blue-50/70",
    value: "text-blue-700",
  },
  success: {
    card: "border-emerald-200 bg-emerald-50/70",
    value: "text-emerald-700",
  },
  warning: {
    card: "border-amber-200 bg-amber-50/80",
    value: "text-amber-700",
  },
  danger: {
    card: "border-red-200 bg-red-50/80",
    value: "text-red-700",
  },
};

export default function PrincipalKpiStrip({ items }: { items: PrincipalKpiCard[] }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const palette = toneMap[item.tone];
        return (
          <article key={item.label} className={`rounded-xl border p-4 shadow-sm ${palette.card}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600">{item.label}</p>
            <p className={`mt-2 text-2xl font-extrabold ${palette.value}`}>{item.value}</p>
            {item.subtext && <p className="mt-1 text-xs text-gray-600">{item.subtext}</p>}
          </article>
        );
      })}
    </section>
  );
}
