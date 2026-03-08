import Link from "next/link";

import type { FinanceSummaryCardData } from "./types";

function asCurrency(amount: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function FinanceSummaryPanel({ data }: { data: FinanceSummaryCardData | null }) {
  if (!data) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Finance Summary</h3>
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
          Finance summary is unavailable right now. Verify fee summary permissions and report data.
        </div>
      </section>
    );
  }

  const collectionRate = data.amountDueTotal > 0 ? (data.amountPaidTotal / data.amountDueTotal) * 100 : 0;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Finance Summary</h3>
        <Link href="/dashboard/fees" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          Open Finance
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs uppercase tracking-wide text-blue-700">Total Due</p>
          <p className="mt-1 font-semibold text-blue-900">{asCurrency(data.amountDueTotal)}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Collected</p>
          <p className="mt-1 font-semibold text-emerald-900">{asCurrency(data.amountPaidTotal)}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs uppercase tracking-wide text-amber-700">Outstanding</p>
          <p className="mt-1 font-semibold text-amber-900">{asCurrency(data.outstandingTotal)}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs uppercase tracking-wide text-red-700">Overdue</p>
          <p className="mt-1 font-semibold text-red-900">{asCurrency(data.overdueTotal)}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
          <span>Collection Rate</span>
          <span>{collectionRate.toFixed(1)}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100">
          <div className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, collectionRate)}%` }} />
        </div>
      </div>
    </section>
  );
}
