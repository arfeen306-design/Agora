interface PrincipalHeroCardProps {
  title: string;
  subtitle: string;
  attendanceRate: number;
  presentCount: number;
  totalCount: number;
  generatedAt: string;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Updated just now";
  return `Updated ${parsed.toLocaleString()}`;
}

export default function PrincipalHeroCard({
  title,
  subtitle,
  attendanceRate,
  presentCount,
  totalCount,
  generatedAt,
}: PrincipalHeroCardProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 p-6 text-white shadow-lg">
      <div className="absolute -top-20 -right-16 h-48 w-48 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-indigo-900/20 blur-2xl" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-100">Principal Command Center</p>
          <h2 className="mt-2 text-3xl font-extrabold leading-tight">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-blue-100">{subtitle}</p>
          <p className="mt-3 text-xs text-blue-100/90">{formatTimestamp(generatedAt)}</p>
        </div>

        <div className="rounded-xl border border-white/25 bg-white/15 p-4 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100">Today Attendance</p>
          <p className="mt-1 text-3xl font-bold">{attendanceRate.toFixed(1)}%</p>
          <p className="text-sm text-blue-100">{presentCount} present out of {totalCount}</p>
          <div className="mt-3 h-2.5 w-56 rounded-full bg-white/25">
            <div
              className="h-2.5 rounded-full bg-emerald-300"
              style={{ width: `${Math.max(0, Math.min(100, attendanceRate))}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
