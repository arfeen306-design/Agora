import Link from "next/link";

import type { SectionDashboardTeacherCompletion } from "@/lib/api";

function percentage(part: number, total: number) {
  if (!total) return 0;
  return (part / total) * 100;
}

export default function TeacherCompletionArea({
  data,
}: {
  data: SectionDashboardTeacherCompletion;
}) {
  const homeworkRate = percentage(
    data.homework_completed_submissions,
    data.homework_total_submissions
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Teacher Completion Area</h3>
        <Link href="/dashboard/reports" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          Open Reports
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Assigned Staff</p>
          <p className="mt-1 text-xl font-bold text-emerald-900">{data.assigned_staff}</p>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <p className="text-xs uppercase tracking-wide text-cyan-700">Marks Scores Entered</p>
          <p className="mt-1 text-xl font-bold text-cyan-900">{data.marks_scores_count}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs uppercase tracking-wide text-blue-700">Homework Completed</p>
          <p className="mt-1 text-xl font-bold text-blue-900">{data.homework_completed_submissions}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs uppercase tracking-wide text-red-700">Homework Missing</p>
          <p className="mt-1 text-xl font-bold text-red-900">{data.homework_missing_submissions}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
          <span>Homework Completion (30 days)</span>
          <span>{homeworkRate.toFixed(1)}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100">
          <div className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, homeworkRate)}%` }} />
        </div>
      </div>
    </section>
  );
}
