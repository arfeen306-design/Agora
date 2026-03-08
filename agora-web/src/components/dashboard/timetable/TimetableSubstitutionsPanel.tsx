"use client";

import type { TimetableSubstitutionRow } from "@/lib/api";

interface TimetableSubstitutionsPanelProps {
  rows: TimetableSubstitutionRow[];
}

function statusPill(isActive: boolean) {
  return isActive ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700";
}

export default function TimetableSubstitutionsPanel({ rows }: TimetableSubstitutionsPanelProps) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">Substitution Manager</h3>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
          {rows.length} records
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Track substitute teacher assignments and same-day coverage.
      </p>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
          No substitution records in this filtered window.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.slice(0, 10).map((row) => (
            <article
              key={row.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">
                  {row.classroom_label || "Classroom"} • {row.day_name || "Day"} • {row.period_label || "Period"}
                </p>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusPill(row.is_active)}`}>
                  {row.is_active ? "Active" : "Revoked"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Original: {row.original_teacher_name || "Unknown"} → Substitute:{" "}
                {row.substitute_teacher_name || "Unknown"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Date: {row.substitution_date}
              </p>
              {row.reason ? <p className="mt-1 text-xs text-gray-500">{row.reason}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
