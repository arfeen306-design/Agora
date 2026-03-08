"use client";

interface TimetableHeroCardProps {
  title: string;
  subtitle: string;
  entryCount: number;
  slotCount: number;
  substitutionCount: number;
  accent?: "blue" | "emerald" | "amber";
}

const ACCENT_MAP = {
  blue: "from-blue-600 to-indigo-600",
  emerald: "from-emerald-600 to-teal-600",
  amber: "from-amber-600 to-orange-600",
};

export default function TimetableHeroCard({
  title,
  subtitle,
  entryCount,
  slotCount,
  substitutionCount,
  accent = "blue",
}: TimetableHeroCardProps) {
  return (
    <section
      className={`overflow-hidden rounded-2xl bg-gradient-to-r ${ACCENT_MAP[accent]} p-6 text-white shadow-lg`}
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Academic Allocation</p>
          <h2 className="mt-1 text-2xl font-bold">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/85">{subtitle}</p>
        </div>

        <div className="grid min-w-[240px] grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/25 bg-white/10 p-3 text-center backdrop-blur-sm">
            <p className="text-[11px] uppercase tracking-wide text-white/80">Entries</p>
            <p className="mt-1 text-2xl font-bold">{entryCount}</p>
          </div>
          <div className="rounded-xl border border-white/25 bg-white/10 p-3 text-center backdrop-blur-sm">
            <p className="text-[11px] uppercase tracking-wide text-white/80">Slots</p>
            <p className="mt-1 text-2xl font-bold">{slotCount}</p>
          </div>
          <div className="rounded-xl border border-white/25 bg-white/10 p-3 text-center backdrop-blur-sm">
            <p className="text-[11px] uppercase tracking-wide text-white/80">Substitutions</p>
            <p className="mt-1 text-2xl font-bold">{substitutionCount}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
