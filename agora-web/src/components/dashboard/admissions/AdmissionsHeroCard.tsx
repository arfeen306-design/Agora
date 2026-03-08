interface AdmissionsHeroCardProps {
  activeCount: number;
  totalCount: number;
  conversionRate: number;
  admittedCount: number;
  rejectedCount: number;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function AdmissionsHeroCard({
  activeCount,
  totalCount,
  conversionRate,
  admittedCount,
  rejectedCount,
}: AdmissionsHeroCardProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500 p-6 text-white shadow-lg">
      <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-indigo-900/20 blur-2xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-100">Admissions Center</p>
          <h2 className="mt-2 text-3xl font-extrabold leading-tight">Pipeline Command View</h2>
          <p className="mt-2 max-w-2xl text-sm text-indigo-100">
            Track inquiry flow, stage transitions, and admissions conversion in one place.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/25 bg-white/15 p-4 text-sm backdrop-blur">
          <Metric label="Active Pipeline" value={activeCount} />
          <Metric label="Total Records" value={totalCount} />
          <Metric label="Admitted" value={admittedCount} />
          <Metric label="Rejected" value={rejectedCount} />
          <div className="col-span-2 mt-1 rounded-lg bg-white/20 px-3 py-2 text-center text-sm font-semibold">
            Conversion Rate: {formatPercent(conversionRate)}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-indigo-100">{label}</p>
      <p className="mt-1 text-2xl font-bold">{new Intl.NumberFormat("en-US").format(value || 0)}</p>
    </div>
  );
}
