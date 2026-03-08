import Link from "next/link";

import type { SectionHealthRow } from "./types";

function toneClass(rate: number) {
  if (rate >= 90) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (rate >= 75) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

export default function SectionHealthTable({ rows }: { rows: SectionHealthRow[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Section Health</h3>
          <p className="text-sm text-gray-500">Attendance, punctuality, and homework completion by section.</p>
        </div>
        <Link href="/dashboard/institution" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          Manage Sections
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="p-6">
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
            Section metrics will appear here once attendance and homework records are available.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-5 py-3">Section</th>
                <th className="px-5 py-3">Attendance Rate</th>
                <th className="px-5 py-3">Late</th>
                <th className="px-5 py-3">Absent</th>
                <th className="px-5 py-3">Homework Completion</th>
                <th className="px-5 py-3">Missing Homework</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sectionId} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-gray-900">{row.sectionName}</p>
                    <p className="text-xs text-gray-500">{row.sectionCode}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass(row.attendanceRate)}`}>
                      {row.attendanceRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{row.lateCount}</td>
                  <td className="px-5 py-3 text-gray-700">{row.absentCount}</td>
                  <td className="px-5 py-3 text-gray-700">{formatPercent(row.homeworkCompletionRate)}</td>
                  <td className="px-5 py-3 text-gray-700">{row.missingHomework}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
