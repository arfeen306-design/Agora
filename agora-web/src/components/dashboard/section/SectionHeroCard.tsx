interface SectionHeroCardProps {
  sectionName: string;
  sectionCode: string;
  attendanceRate: number;
  activeStudents: number;
  generatedAt: string;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Updated just now";
  return `Updated ${parsed.toLocaleString()}`;
}

export default function SectionHeroCard({
  sectionName,
  sectionCode,
  attendanceRate,
  activeStudents,
  generatedAt,
}: SectionHeroCardProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-500 p-6 text-white shadow-lg">
      <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-teal-900/25 blur-2xl" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Section Operations Dashboard</p>
          <h2 className="mt-2 text-3xl font-extrabold">{sectionName}</h2>
          <p className="mt-1 text-sm text-emerald-100">Section Code: {sectionCode}</p>
          <p className="mt-3 text-xs text-emerald-100/90">{formatTimestamp(generatedAt)}</p>
        </div>

        <div className="rounded-xl border border-white/30 bg-white/15 p-4 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">Today Attendance</p>
          <p className="mt-1 text-3xl font-bold">{attendanceRate.toFixed(1)}%</p>
          <p className="text-sm text-emerald-100">{activeStudents} active students in this section</p>
          <div className="mt-3 h-2.5 w-56 rounded-full bg-white/25">
            <div className="h-2.5 rounded-full bg-lime-300" style={{ width: `${Math.min(100, attendanceRate)}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
