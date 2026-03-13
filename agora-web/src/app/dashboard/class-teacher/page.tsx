"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getClassTeacherMyClassroom, getReportCardHistory, type ClassTeacherMyClassroomPayload } from "@/lib/api";
import { getCommentPresetFamilies } from "@/lib/report-card-comment-presets";

const ALLOWED_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

export default function ClassTeacherDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<ClassTeacherMyClassroomPayload | null>(null);
  const [subjectCommentSummary, setSubjectCommentSummary] = useState({
    latest_term_name: "",
    total_cards: 0,
    published_cards: 0,
    draft_cards: 0,
  });

  const allowed = hasAnyRole(user?.roles || [], ALLOWED_ROLES);

  useEffect(() => {
    if (!user || !allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getClassTeacherMyClassroom();
        if (!cancelled) {
          setPayload(data);
        }
        const latestTerm = data.exam_terms?.[0];
        if (latestTerm && data.classroom?.id) {
          try {
            const history = await getReportCardHistory({
              classroom_id: data.classroom.id,
              exam_term_id: latestTerm.id,
              page: 1,
              page_size: 10,
            });
            if (!cancelled) {
              setSubjectCommentSummary({
                latest_term_name: latestTerm.name,
                total_cards: Number(history.data?.kpis?.total_cards || 0),
                published_cards: Number(history.data?.kpis?.published_cards || 0),
                draft_cards: Number(history.data?.kpis?.draft_cards || 0),
              });
            }
          } catch {
            if (!cancelled) {
              setSubjectCommentSummary({
                latest_term_name: latestTerm.name,
                total_cards: 0,
                published_cards: 0,
                draft_cards: 0,
              });
            }
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load class teacher dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [allowed, user]);

  const attendance = payload?.attendance_today || {
    present_count: 0,
    absent_count: 0,
    late_count: 0,
    leave_count: 0,
    total_marked: 0,
  };

  const attendanceRate = useMemo(() => {
    if (!attendance.total_marked) return 0;
    return Math.round((attendance.present_count / attendance.total_marked) * 100);
  }, [attendance.present_count, attendance.total_marked]);

  const nonPresentCount = useMemo(
    () => attendance.absent_count + attendance.late_count + attendance.leave_count,
    [attendance.absent_count, attendance.late_count, attendance.leave_count]
  );

  const completionAverage = useMemo(() => {
    if (!payload?.marks_completion?.length) return 0;
    const total = payload.marks_completion.reduce((sum, row) => sum + Number(row.completion_percentage || 0), 0);
    return Math.round(total / payload.marks_completion.length);
  }, [payload?.marks_completion]);

  const commentPresetBank = useMemo(() => {
    const families = getCommentPresetFamilies();
    return {
      familyCount: Object.keys(families).length,
      categoryCount: Object.keys(Object.values(families)[0] || {}).length,
      totalComments: Object.values(families).reduce(
        (familyTotal, family) =>
          familyTotal + Object.values(family).reduce((commentTotal, items) => commentTotal + items.length, 0),
        0
      ),
    };
  }, []);

  if (!allowed) {
    return (
      <>
        <Header title="Class Teacher" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              This workspace is available for teaching and leadership roles only.
            </p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Class Teacher" />
        <div className="p-6 space-y-4">
          <div className="h-36 animate-pulse rounded-2xl bg-indigo-100" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-24 animate-pulse rounded-xl bg-gray-200" />
          </div>
        </div>
      </>
    );
  }

  if (!payload?.classroom) {
    return (
      <>
        <Header title="Class Teacher" />
        <div className="p-6 space-y-5">
          <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 to-blue-500 p-6 text-white shadow-lg">
            <h2 className="text-2xl font-bold">Class Teacher Command Center</h2>
            <p className="mt-2 text-sm text-indigo-100">
              Attendance, marks consolidation, subject-teacher mapping, and report card generation.
            </p>
          </section>
          <section className="card">
            <h3 className="text-lg font-semibold text-gray-900">No Active Homeroom Assignment</h3>
            <p className="mt-2 text-sm text-gray-600">
              {payload?.message || "Your account is not currently mapped as homeroom teacher for the active academic year."}
            </p>
            <div className="mt-4 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              Ask School Admin or Principal to assign you as homeroom teacher from Institution settings.
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Class Teacher" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.3em] text-indigo-100">Class Teacher Command Center</p>
          <h2 className="mt-3 text-3xl font-bold">
            {payload.classroom.grade_label} {payload.classroom.section_label}
          </h2>
          <p className="mt-2 text-sm text-indigo-100">
            Academic Year: {payload.classroom.academic_year_name || "-"} • Students: {payload.student_count} • Marks
            Completion Avg: {completionAverage}%
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Present</p>
            <p className="mt-1 text-2xl font-bold text-emerald-800">{attendance.present_count}</p>
          </article>
          <article className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs uppercase tracking-wide text-red-700">Absent</p>
            <p className="mt-1 text-2xl font-bold text-red-800">{attendance.absent_count}</p>
          </article>
          <article className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-700">Late</p>
            <p className="mt-1 text-2xl font-bold text-amber-800">{attendance.late_count}</p>
          </article>
          <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs uppercase tracking-wide text-blue-700">Marked Today</p>
            <p className="mt-1 text-2xl font-bold text-blue-800">{attendance.total_marked}</p>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900">Term Completion</h3>
              <Link href="/dashboard/class-teacher/results" className="text-sm font-semibold text-primary-700 hover:text-primary-900">
                Open Results Grid
              </Link>
            </div>
            {payload.marks_completion.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No exam terms found for this academic year.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {payload.marks_completion.map((row) => (
                  <div key={row.exam_term_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900">{row.term_name}</p>
                      <span className="inline-flex rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                        {row.completion_percentage}% complete
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500"
                        style={{ width: `${Math.max(4, Number(row.completion_percentage || 0))}%` }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-600">
                      <p>Assessments: {row.assessment_count}</p>
                      <p>Scores: {row.score_count}</p>
                      <p>Expected: {row.expected_scores}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Attendance Pulse</h3>
            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-wide text-indigo-700">Present Rate Today</p>
              <p className="mt-1 text-2xl font-bold text-indigo-900">{attendanceRate}%</p>
              <div className="mt-2 h-2 w-full rounded-full bg-white">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-green-400"
                  style={{ width: `${attendanceRate}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-indigo-700">
                {attendance.present_count} present / {attendance.total_marked} marked • {nonPresentCount} not present
              </p>
            </div>
            <h4 className="mt-4 text-sm font-semibold text-gray-900">Quick Actions</h4>
            <div className="mt-4 grid gap-2">
              <Link href="/dashboard/class-teacher/attendance" className="btn-primary text-center">
                Mark Attendance
              </Link>
              <Link href="/dashboard/class-teacher/subjects" className="btn-secondary text-center">
                Assign Subject Teachers
              </Link>
              <Link href="/dashboard/class-teacher/report-cards" className="btn-secondary text-center">
                Generate Report Cards
              </Link>
              <Link href="/dashboard/exam-terms" className="btn-secondary text-center">
                Manage Exam Terms
              </Link>
            </div>
            <div className="mt-5 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-fuchsia-900">Subject Comments Toolkit</h4>
                  <p className="mt-1 text-xs text-fuchsia-800/80">
                    Quick preset summaries for report cards and family-facing feedback.
                  </p>
                </div>
                <Link
                  href="/dashboard/class-teacher/report-cards"
                  className="rounded-md border border-fuchsia-300 bg-white px-3 py-1 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-100"
                >
                  Open
                </Link>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/80 bg-white px-3 py-2 text-fuchsia-900">
                  Presets Ready: {commentPresetBank.totalComments}
                </div>
                <div className="rounded-lg border border-white/80 bg-white px-3 py-2 text-fuchsia-900">
                  Categories: {commentPresetBank.categoryCount}
                </div>
                <div className="rounded-lg border border-white/80 bg-white px-3 py-2 text-fuchsia-900">
                  Latest Term Cards: {subjectCommentSummary.total_cards}
                </div>
                <div className="rounded-lg border border-white/80 bg-white px-3 py-2 text-fuchsia-900">
                  Draft Pending: {subjectCommentSummary.draft_cards}
                </div>
              </div>
              <p className="mt-3 text-xs text-fuchsia-800/80">
                {subjectCommentSummary.latest_term_name
                  ? `Latest term: ${subjectCommentSummary.latest_term_name} • Published: ${subjectCommentSummary.published_cards} • Families: mathematics, languages, science, general`
                  : `Preset families ready: ${commentPresetBank.familyCount}. Generate cards to begin assigning subject comments.`}
              </p>
              <div className="mt-4 rounded-xl border border-white/80 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                    Comment Completion by Subject
                  </h5>
                  <span className="text-[11px] text-fuchsia-700">
                    {payload.subject_comment_completion?.[0]?.term_name || subjectCommentSummary.latest_term_name || "No term"}
                  </span>
                </div>
                {!payload.subject_comment_completion || payload.subject_comment_completion.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-500">
                    Generate report cards for the latest term to unlock subject comment completion tracking.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {payload.subject_comment_completion.map((row) => (
                      <div key={row.subject_id}>
                        <Link
                          href={`/dashboard/class-teacher/report-cards?subject_id=${encodeURIComponent(
                            row.subject_id
                          )}&exam_term_id=${encodeURIComponent(row.exam_term_id)}&comment_status=missing`}
                          className="mb-1 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs transition hover:bg-fuchsia-100"
                        >
                          <span className="font-medium text-gray-700">{row.subject_name}</span>
                          <span className="font-semibold text-fuchsia-900">
                            {row.completion_percentage}% ({row.commented_rows}/{row.total_cards})
                          </span>
                        </Link>
                        <div className="h-2 rounded-full bg-fuchsia-100">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500"
                            style={{ width: `${Math.max(6, row.completion_percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-xl border border-white/80 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                    Comment Completion Trend by Term
                  </h5>
                  <span className="text-[11px] text-fuchsia-700">Across generated report cards</span>
                </div>
                {!payload.subject_comment_completion_trend || payload.subject_comment_completion_trend.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-500">
                    Generate report cards to begin tracking comment completion across terms.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {payload.subject_comment_completion_trend.map((row) => (
                      <div key={row.exam_term_id}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-gray-700">{row.term_name}</span>
                          <span className="font-semibold text-fuchsia-900">
                            {row.completion_percentage}% ({row.commented_rows}/{row.expected_rows})
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-fuchsia-100">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500"
                            style={{ width: `${Math.max(6, row.completion_percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
