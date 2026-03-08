import Link from "next/link";

import type { SectionDashboardLateAbsentStudent } from "@/lib/api";

export default function LateAbsentStudentsPanel({
  rows,
}: {
  rows: SectionDashboardLateAbsentStudent[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Late and Absent Students</h3>
          <p className="text-sm text-gray-500">Critical attendance follow-up list for today.</p>
        </div>
        <Link href="/dashboard/attendance" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          Open Attendance
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="p-6">
          <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
            Great job. No late or absent students in this section today.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Classroom</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Check In</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.attendance_record_id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-gray-900">{row.first_name} {row.last_name || ""}</p>
                    <p className="text-xs text-gray-500">{row.student_code}</p>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{row.classroom_label}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      row.status === "absent"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-700">
                    {row.check_in_at ? new Date(row.check_in_at).toLocaleTimeString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
