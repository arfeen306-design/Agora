"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  downloadReportCardPdf,
  getMyReportCardHistory,
  getReportCard,
  type FamilyReportCardHistoryItem,
  type ClassTeacherReportCardDetail,
} from "@/lib/api";
import { getCommentCategoryLabel, type ReportCardCommentCategory } from "@/lib/report-card-comment-presets";

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function historyTimestamp(item: {
  published_at?: string | null;
  generated_at?: string | null;
}) {
  return new Date(item.published_at || item.generated_at || 0).getTime() || 0;
}

function deltaTone(value: number) {
  if (value > 0) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (value < 0) return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function deltaLabel(value: number, suffix = "%") {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}${suffix}`;
}

function trendMessage(delta: number) {
  if (delta >= 5) return "Strong upward movement compared with the previous term.";
  if (delta >= 1) return "Steady improvement compared with the previous term.";
  if (delta <= -5) return "Noticeable drop compared with the previous term. Extra support may help.";
  if (delta <= -1) return "Slight drop compared with the previous term.";
  return "Performance is steady compared with the previous term.";
}

function findPreviousTermCard(
  reportCard: ClassTeacherReportCardDetail | null,
  reportHistory: FamilyReportCardHistoryItem[]
) {
  if (!reportCard || reportHistory.length === 0) return null;
  const sorted = [...reportHistory].sort((left, right) => historyTimestamp(right) - historyTimestamp(left));
  const currentIndex = sorted.findIndex((item) => item.id === reportCard.id);
  if (currentIndex >= 0 && sorted[currentIndex + 1]) return sorted[currentIndex + 1];
  return sorted.find((item) => item.id !== reportCard.id) || null;
}

type SubjectComparison = {
  subject_name: string;
  current_percentage: number;
  previous_percentage: number;
  delta: number;
  current_grade: string;
  previous_grade: string;
};

function isSubjectComparison(value: SubjectComparison | null): value is SubjectComparison {
  return Boolean(value);
}

export default function FamilyReportCardDetailPage() {
  const params = useParams<{ reportCardId: string }>();
  const reportCardId = params?.reportCardId || "";
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isFamilyViewer = hasAnyRole(roles, ["parent", "student"]);

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [reportCard, setReportCard] = useState<ClassTeacherReportCardDetail | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportHistory, setReportHistory] = useState<FamilyReportCardHistoryItem[]>([]);
  const [previousReportCardDetail, setPreviousReportCardDetail] = useState<ClassTeacherReportCardDetail | null>(null);

  useEffect(() => {
    if (!reportCardId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const detail = await getReportCard(reportCardId);
        if (cancelled) return;
        setReportCard(detail);

        if (isFamilyViewer) {
          setHistoryLoading(true);
          try {
            const history = await getMyReportCardHistory({
              student_id: detail.student.id,
              page_size: 12,
            });
            if (!cancelled) {
              const historyItems = history.data.items || [];
              setReportHistory(historyItems);
              const previousItem = findPreviousTermCard(detail, historyItems);
              if (previousItem) {
                try {
                  const previousDetail = await getReportCard(previousItem.id);
                  if (!cancelled) setPreviousReportCardDetail(previousDetail);
                } catch {
                  if (!cancelled) setPreviousReportCardDetail(null);
                }
              } else {
                setPreviousReportCardDetail(null);
              }
            }
          } catch {
            if (!cancelled) {
              setReportHistory([]);
              setPreviousReportCardDetail(null);
            }
          } finally {
            if (!cancelled) setHistoryLoading(false);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load report card");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isFamilyViewer, reportCardId]);

  const attendanceRate = useMemo(() => {
    if (!reportCard) return 0;
    const total = Number(reportCard.summary.attendance_total || 0);
    const present = Number(reportCard.summary.attendance_present || 0);
    if (!total) return 0;
    return Number(((present / total) * 100).toFixed(1));
  }, [reportCard]);

  const historySeries = useMemo(() => {
    return [...reportHistory]
      .sort((left, right) => historyTimestamp(left) - historyTimestamp(right))
      .slice(-6);
  }, [reportHistory]);

  const previousTermCard = useMemo(() => {
    return findPreviousTermCard(reportCard, reportHistory);
  }, [reportCard, reportHistory]);

  const comparison = useMemo(() => {
    if (!reportCard || !previousTermCard) return null;
    const currentPercentage = Number(reportCard.summary.percentage || 0);
    const previousPercentage = Number(previousTermCard.percentage || 0);
    const currentAttendance = attendanceRate;
    const previousAttendance = Number(previousTermCard.attendance_rate || 0);
    return {
      currentPercentage,
      previousPercentage,
      percentageDelta: Number((currentPercentage - previousPercentage).toFixed(1)),
      currentAttendance,
      previousAttendance,
      attendanceDelta: Number((currentAttendance - previousAttendance).toFixed(1)),
    };
  }, [attendanceRate, previousTermCard, reportCard]);

  const subjectComparisons = useMemo(() => {
    if (!reportCard || !previousReportCardDetail) return [];

    const previousByKey = new Map(
      previousReportCardDetail.subjects.map((subject) => [
        subject.subject_id || subject.subject_name.toLowerCase(),
        subject,
      ])
    );

    return reportCard.subjects
      .map((subject) => {
        const key = subject.subject_id || subject.subject_name.toLowerCase();
        const previous = previousByKey.get(key);
        if (!previous) return null;

        const currentPercentage = Number(subject.percentage || 0);
        const previousPercentage = Number(previous.percentage || 0);
        const delta = Number((currentPercentage - previousPercentage).toFixed(1));

        return {
          subject_name: subject.subject_name,
          current_percentage: currentPercentage,
          previous_percentage: previousPercentage,
          delta,
          current_grade: subject.grade || "—",
          previous_grade: previous.grade || "—",
        };
      })
      .filter(isSubjectComparison)
      .sort((left, right) => Number(right.delta) - Number(left.delta));
  }, [previousReportCardDetail, reportCard]);

  const bestImprovedSubject = useMemo(() => {
    return subjectComparisons.length > 0 ? subjectComparisons[0] : null;
  }, [subjectComparisons]);

  const needsSupportSubject = useMemo(() => {
    if (subjectComparisons.length === 0) return null;
    return [...subjectComparisons].sort((left, right) => left.delta - right.delta)[0];
  }, [subjectComparisons]);

  async function handleDownload() {
    if (!reportCard) return;
    try {
      setDownloading(true);
      const blob = await downloadReportCardPdf(reportCard.id);
      downloadBlob(blob, `${reportCard.student.student_code}-${reportCard.exam_term.name.replace(/\s+/g, "-").toLowerCase()}-report-card.pdf`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to download report card");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Header title="Report Card Detail" />
      <div className="p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/marks" className="text-sm font-medium text-primary-600 hover:text-primary-700">
            ← Back to marks
          </Link>
          {reportCard && (
            <button className="btn-secondary" onClick={handleDownload} disabled={downloading}>
              {downloading ? "Preparing PDF..." : "Download PDF"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="card text-center text-gray-400">Loading report card...</div>
        ) : !reportCard ? (
          <div className="card text-center text-gray-500">Report card not found.</div>
        ) : (
          <>
            <section className="mb-6 rounded-3xl bg-gradient-to-r from-violet-700 via-indigo-600 to-cyan-500 p-6 text-white shadow-lg">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-white/80">
                    {isFamilyViewer ? "Family Report Card" : "Report Card"}
                  </p>
                  <h2 className="mt-2 text-3xl font-bold">{reportCard.student.full_name}</h2>
                  <p className="mt-2 text-sm text-white/[0.85]">
                    {reportCard.classroom.grade_label}
                    {reportCard.classroom.section_label ? ` • Section ${reportCard.classroom.section_label}` : ""}
                    {reportCard.classroom.classroom_code ? ` • ${reportCard.classroom.classroom_code}` : ""}
                  </p>
                  <p className="mt-2 text-sm text-white/[0.85]">
                    {reportCard.exam_term.name} ({reportCard.exam_term.term_type})
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <HeroMetric label="Percentage" value={reportCard.summary.percentage !== null && reportCard.summary.percentage !== undefined ? `${Number(reportCard.summary.percentage).toFixed(1)}%` : "—"} />
                  <HeroMetric label="Grade" value={reportCard.summary.grade || "—"} />
                  <HeroMetric label="Attendance" value={`${attendanceRate.toFixed(1)}%`} />
                  <HeroMetric label="Status" value={reportCard.summary.status.toUpperCase()} />
                </div>
              </div>
            </section>

            {isFamilyViewer && (
              <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="card xl:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900">Improvement Trend</h3>
                  {historyLoading ? (
                    <p className="mt-3 text-sm text-gray-500">Loading previous-term comparison...</p>
                  ) : historySeries.length <= 1 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      Trend insights will appear once more published report cards are available for comparison.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm text-gray-600">
                        {comparison ? trendMessage(comparison.percentageDelta) : "Trend insights are building from past report cards."}
                      </p>
                      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {historySeries.map((item) => {
                          const percentage = Number(item.percentage || 0);
                          return (
                            <div key={item.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium text-gray-900">{item.exam_term_name || "Term Result"}</p>
                                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                                    {item.exam_term_type || "term"}
                                  </p>
                                </div>
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                                  {percentage.toFixed(1)}%
                                </span>
                              </div>
                              <div className="mt-4 h-2 rounded-full bg-gray-100">
                                <div
                                  className="h-2 rounded-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500"
                                  style={{ width: `${Math.max(6, Math.min(100, percentage))}%` }}
                                />
                              </div>
                              <p className="mt-2 text-xs text-gray-500">
                                {item.grade || "—"} • Published {formatDate(item.published_at || item.generated_at)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900">Previous Term Comparison</h3>
                  {!comparison || !previousTermCard ? (
                    <p className="mt-3 text-sm text-gray-500">
                      We need at least one earlier published report card to show a comparison.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Compared With</p>
                        <p className="mt-1 font-semibold text-gray-900">{previousTermCard.exam_term_name || "Previous Term"}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {formatDate(previousTermCard.published_at || previousTermCard.generated_at)}
                        </p>
                      </div>
                      <ComparisonStat
                        label="Percentage Change"
                        currentValue={`${comparison.currentPercentage.toFixed(1)}%`}
                        previousValue={`${comparison.previousPercentage.toFixed(1)}%`}
                        delta={deltaLabel(comparison.percentageDelta)}
                        tone={deltaTone(comparison.percentageDelta)}
                      />
                      <ComparisonStat
                        label="Attendance Change"
                        currentValue={`${comparison.currentAttendance.toFixed(1)}%`}
                        previousValue={`${comparison.previousAttendance.toFixed(1)}%`}
                        delta={deltaLabel(comparison.attendanceDelta)}
                        tone={deltaTone(comparison.attendanceDelta)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {isFamilyViewer && (
              <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="card xl:col-span-2">
                  <h3 className="text-lg font-semibold text-gray-900">Subject-Level Comparison</h3>
                  {!previousReportCardDetail || subjectComparisons.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      Subject comparison will appear once we have a previous published report card with matching subjects.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {subjectComparisons.map((subject) => (
                        <div key={subject.subject_name} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="font-semibold text-gray-900">{subject.subject_name}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                                {subject.previous_grade} → {subject.current_grade}
                              </p>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${deltaTone(subject.delta)}`}>
                              {deltaLabel(subject.delta)}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <MetricCard label="Current Term" value={`${subject.current_percentage.toFixed(1)}%`} />
                            <MetricCard label="Previous Term" value={`${subject.previous_percentage.toFixed(1)}%`} />
                          </div>
                          <div className="mt-4">
                            <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
                              Trend Snapshot
                            </p>
                            <div className="mt-3">
                              <SubjectTrendMiniChart
                                currentValue={subject.current_percentage}
                                previousValue={subject.previous_percentage}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="card">
                    <h3 className="text-lg font-semibold text-gray-900">Best Improved Subject</h3>
                    {!bestImprovedSubject ? (
                      <p className="mt-3 text-sm text-gray-500">No subject-level comparison available yet.</p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Top Gain</p>
                          <p className="mt-1 text-lg font-semibold text-emerald-900">{bestImprovedSubject.subject_name}</p>
                          <p className="mt-2 text-sm text-emerald-800">
                            {bestImprovedSubject.previous_percentage.toFixed(1)}% → {bestImprovedSubject.current_percentage.toFixed(1)}%
                          </p>
                          <p className="mt-2 inline-flex rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700">
                            {deltaLabel(bestImprovedSubject.delta)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="card">
                    <h3 className="text-lg font-semibold text-gray-900">Needs Support Subject</h3>
                    {!needsSupportSubject ? (
                      <p className="mt-3 text-sm text-gray-500">No subject-level comparison available yet.</p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Watch Closely</p>
                          <p className="mt-1 text-lg font-semibold text-amber-900">{needsSupportSubject.subject_name}</p>
                          <p className="mt-2 text-sm text-amber-800">
                            {needsSupportSubject.previous_percentage.toFixed(1)}% → {needsSupportSubject.current_percentage.toFixed(1)}%
                          </p>
                          <p className={`mt-2 inline-flex rounded-full border bg-white px-3 py-1 text-xs font-semibold ${deltaTone(needsSupportSubject.delta)}`}>
                            {deltaLabel(needsSupportSubject.delta)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="card xl:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Subject Breakdown</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Subject-by-subject marks, grade, and percentage for this term report.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {reportCard.subjects.map((subject) => {
                    const percent =
                      subject.percentage !== null && subject.percentage !== undefined
                        ? Number(subject.percentage).toFixed(1)
                        : null;
                    return (
                      <div key={subject.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-base font-semibold text-gray-900">{subject.subject_name}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                              Grade {subject.grade || "—"}
                            </p>
                          </div>
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                            {percent ? `${percent}%` : "Pending"}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <MetricCard label="Marks" value={`${subject.marks_obtained}/${subject.max_marks}`} />
                          <MetricCard label="Grade" value={subject.grade || "—"} />
                          <MetricCard label="Percentage" value={percent ? `${percent}%` : "—"} />
                        </div>
                        {subject.teacher_comment ? (
                          <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                                Teacher Recommendation
                              </p>
                              {subject.comment_category ? (
                                <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold text-sky-700">
                                  {getCommentCategoryLabel(subject.comment_category as ReportCardCommentCategory)}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-sky-950">{subject.teacher_comment}</p>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900">Term Summary</h3>
                  <div className="mt-4 space-y-3 text-sm">
                    <SummaryRow label="Generated" value={formatDate(reportCard.summary.generated_at)} />
                    <SummaryRow label="Published" value={formatDate(reportCard.summary.published_at)} />
                    <SummaryRow label="Attendance" value={`${reportCard.summary.attendance_present}/${reportCard.summary.attendance_total}`} />
                    <SummaryRow label="Attendance Rate" value={`${attendanceRate.toFixed(1)}%`} />
                    <SummaryRow label="Grading Scale" value={reportCard.grading_scale?.name || "Default"} />
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-lg font-semibold text-gray-900">Teacher Remarks</h3>
                  <p className="mt-3 text-sm text-gray-600">
                    {reportCard.summary.remarks || "No term remarks were added to this report card."}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/25 bg-white/10 px-4 py-3 shadow-sm backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/80">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function ComparisonStat({
  label,
  currentValue,
  previousValue,
  delta,
  tone,
}: {
  label: string;
  currentValue: string;
  previousValue: string;
  delta: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">Current</p>
          <p className="mt-1 font-semibold text-gray-900">{currentValue}</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">Previous</p>
          <p className="mt-1 font-semibold text-gray-900">{previousValue}</p>
        </div>
      </div>
      <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
        {delta}
      </div>
    </div>
  );
}

function SubjectTrendMiniChart({
  currentValue,
  previousValue,
}: {
  currentValue: number;
  previousValue: number;
}) {
  const highest = Math.max(currentValue, previousValue, 1);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="space-y-3">
        <MiniBar
          label="Previous Term"
          value={previousValue}
          widthPercent={(previousValue / highest) * 100}
          tone="bg-slate-400"
        />
        <MiniBar
          label="Current Term"
          value={currentValue}
          widthPercent={(currentValue / highest) * 100}
          tone="bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-500"
        />
      </div>
    </div>
  );
}

function MiniBar({
  label,
  value,
  widthPercent,
  tone,
}: {
  label: string;
  value: number;
  widthPercent: number;
  tone: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="font-semibold text-gray-900">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-white shadow-inner">
        <div
          className={`h-2.5 rounded-full ${tone}`}
          style={{ width: `${Math.max(8, Math.min(100, widthPercent))}%` }}
        />
      </div>
    </div>
  );
}
