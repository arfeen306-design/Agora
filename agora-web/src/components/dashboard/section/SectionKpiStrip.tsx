import type { SectionKpiItem } from "./types";

const toneMap: Record<SectionKpiItem["tone"], { card: string; value: string }> = {
  primary: {
    card: "border-cyan-200 bg-cyan-50/70",
    value: "text-cyan-700",
  },
  success: {
    card: "border-emerald-200 bg-emerald-50/70",
    value: "text-emerald-700",
  },
  warning: {
    card: "border-amber-200 bg-amber-50/70",
    value: "text-amber-700",
  },
  danger: {
    card: "border-red-200 bg-red-50/70",
    value: "text-red-700",
  },
};

export default function SectionKpiStrip({ items }: { items: SectionKpiItem[] }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const tone = toneMap[item.tone];
        return (
          <article key={item.label} className={`rounded-xl border p-4 shadow-sm ${tone.card}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600">{item.label}</p>
            <p className={`mt-2 text-2xl font-extrabold ${tone.value}`}>{item.value}</p>
            {item.helper && <p className="mt-1 text-xs text-gray-600">{item.helper}</p>}
          </article>
        );
      })}
    </section>
  );
}
