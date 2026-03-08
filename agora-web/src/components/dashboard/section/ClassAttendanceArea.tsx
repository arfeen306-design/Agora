import type { SectionDashboardClassAttendanceRow } from "@/lib/api";

function toneClass(rate: number) {
  if (rate >= 90) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (rate >= 75) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

export default function ClassAttendanceArea({ rows }: { rows: SectionDashboardClassAttendanceRow[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Class Attendance Area</h3>
        <p className="text-sm text-gray-500">Today attendance quality for classrooms in this section.</p>
      </div>

      {rows.length === 0 ? (
        <div className="p-6">
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
            No classroom attendance records found for today.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-5 py-3">Classroom</th>
                <th className="px-5 py-3">Attendance Rate</th>
                <th className="px-5 py-3">Present</th>
                <th className="px-5 py-3">Late</th>
                <th className="px-5 py-3">Absent</th>
                <th className="px-5 py-3">Leave</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.classroom_id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-gray-900">{row.classroom_label}</p>
                    <p className="text-xs text-gray-500">{row.classroom_code || "No Classroom Code"}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass(row.attendance_rate)}`}>
                      {row.attendance_rate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{row.present_count}</td>
                  <td className="px-5 py-3 text-gray-700">{row.late_count}</td>
                  <td className="px-5 py-3 text-gray-700">{row.absent_count}</td>
                  <td className="px-5 py-3 text-gray-700">{row.leave_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
