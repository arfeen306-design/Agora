"use client";

interface AttendanceBreakdown {
  total: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  leave_count: number;
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function MiniDonutChart({
  title,
  breakdown,
  tone = "blue",
}: {
  title: string;
  breakdown: AttendanceBreakdown;
  tone?: "blue" | "emerald" | "violet" | "amber";
}) {
  const total = Number(breakdown.total || 0);
  const present = Number(breakdown.present_count || 0);
  const late = Number(breakdown.late_count || 0);
  const absent = Number(breakdown.absent_count || 0);
  const leave = Number(breakdown.leave_count || 0);
  const safeTotal = Math.max(total, 1);
  const segments = [
    { label: "Present", value: present, color: tone === "emerald" ? "#10b981" : tone === "violet" ? "#8b5cf6" : tone === "amber" ? "#f59e0b" : "#2563eb" },
    { label: "Late", value: late, color: "#f59e0b" },
    { label: "Absent", value: absent, color: "#ef4444" },
    { label: "Leave", value: leave, color: "#94a3b8" },
  ].filter((segment) => segment.value > 0);

  const gradient = segments.length
    ? `conic-gradient(${segments
        .map((segment, index) => {
          const previous = segments.slice(0, index).reduce((sum, item) => sum + item.value, 0);
          const start = (previous / safeTotal) * 360;
          const end = ((previous + segment.value) / safeTotal) * 360;
          return `${segment.color} ${start}deg ${end}deg`;
        })
        .join(", ")})`
    : "conic-gradient(#e2e8f0 0deg 360deg)";

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-white shadow-lg shadow-slate-950/20">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</p>
      <div className="mt-4 flex items-center gap-4">
        <div className="relative h-24 w-24 rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-3 rounded-full bg-slate-950/95" />
          <div className="absolute inset-0 flex items-center justify-center text-center">
            <div>
              <p className="text-2xl font-semibold">{percent(present, safeTotal)}%</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Present</p>
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-2 text-sm text-slate-200">
          {[
            { label: "Present", value: present, chip: "bg-emerald-500/20 text-emerald-200" },
            { label: "Late", value: late, chip: "bg-amber-500/20 text-amber-200" },
            { label: "Absent", value: absent, chip: "bg-rose-500/20 text-rose-200" },
            { label: "Leave", value: leave, chip: "bg-slate-500/20 text-slate-200" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
              <span>{row.label}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.chip}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProgressStripe({
  label,
  value,
  total,
  hint,
  colorClass = "from-blue-500 to-violet-500",
}: {
  label: string;
  value: number;
  total: number;
  hint?: string;
  colorClass?: string;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="font-semibold text-slate-900">{label}</p>
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        </div>
        <span className="text-sm font-semibold text-slate-700">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-3 rounded-full bg-slate-100">
        <div className={`h-3 rounded-full bg-gradient-to-r ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-500">{value} of {total || 0}</p>
    </div>
  );
}

export function MiniHistogram({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-4 flex items-end gap-3">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end rounded-2xl bg-slate-100 p-2">
              <div
                className="w-full rounded-xl bg-gradient-to-t from-violet-600 via-fuchsia-500 to-cyan-400"
                style={{ height: `${Math.max(10, (item.value / max) * 100)}%` }}
              />
            </div>
            <p className="text-xs font-semibold text-slate-700">{item.value}</p>
            <p className="text-center text-[11px] text-slate-500">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
