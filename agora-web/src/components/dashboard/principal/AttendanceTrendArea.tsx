import type { PrincipalAttendanceToday, PrincipalSectionAttendanceRow } from "@/lib/api";

function ratio(value: number, total: number) {
  if (!total) return 0;
  return (value / total) * 100;
}

interface AttendanceTrendAreaProps {
  attendance: PrincipalAttendanceToday;
  sections: PrincipalSectionAttendanceRow[];
}

export default function AttendanceTrendArea({ attendance, sections }: AttendanceTrendAreaProps) {
  const distribution = [
    { key: "present", label: "Present", value: attendance.present_count, color: "bg-emerald-500" },
    { key: "late", label: "Late", value: attendance.late_count, color: "bg-amber-500" },
    { key: "absent", label: "Absent", value: attendance.absent_count, color: "bg-red-500" },
    { key: "leave", label: "Leave", value: attendance.leave_count, color: "bg-slate-400" },
  ];

  const sectionBars = sections.slice(0, 8).map((row) => {
    const total = Math.max(row.attendance_records_today, 0);
    const sectionRate = ratio(row.present_count, total);
    return {
      id: row.section_id,
      label: row.section_code || row.section_name,
      value: sectionRate,
      total,
    };
  });

  return (
    <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Attendance Trend Area</h3>
          <p className="text-sm text-gray-500">
            Daily distribution is live. Historical trend line will expand when time-series endpoint is added.
          </p>
        </div>

        <div className="space-y-3">
          {distribution.map((item) => {
            const width = ratio(item.value, attendance.total);
            return (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">{item.label}</span>
                  <span className="text-gray-500">{item.value}</span>
                </div>
                <div className="h-2.5 rounded-full bg-gray-100">
                  <div className={`h-2.5 rounded-full ${item.color}`} style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Section Attendance Snapshot</h3>
          <p className="text-sm text-gray-500">Top active sections by today attendance quality.</p>
        </div>

        {sectionBars.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
            No section attendance records yet for today.
          </div>
        ) : (
          <div className="space-y-3">
            {sectionBars.map((row) => (
              <div key={row.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">{row.label}</span>
                  <span className="text-gray-500">{row.value.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-blue-100">
                  <div className="h-2 rounded-full bg-blue-500" style={{ width: `${row.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
