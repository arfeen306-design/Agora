"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  getStudentDocuments,
  getStudentDisciplineSummary,
  getFeeInvoices,
  getPeopleStudent,
  getPeopleStudentAcademicSummary,
  getPeopleStudentTimeline,
  getStudentMarksSummary,
  issueDocumentDownloadUrl,
  type DocumentVaultItem,
  type DisciplineIncidentRecord,
  type StudentAcademicSummaryRecord,
  type StudentDetailRecord,
  type StudentDisciplineSummaryRecord,
  type StudentTimelineEvent,
} from "@/lib/api";

type StudentTab = "overview" | "attendance" | "academics" | "finance" | "discipline" | "documents" | "timeline";
type TimelineWindow = "7d" | "30d" | "all";

interface MarksSummaryData {
  overall_average: number;
  subject_averages: Array<{ subject_name: string; average: number }>;
  trend: Array<{ label: string; average: number }>;
}

interface FeeInvoiceItem {
  id: string;
  due_date: string;
  amount_due: number | string;
  amount_paid: number | string;
  status: string;
}

function parseStudentId(input: string | string[] | undefined): string {
  if (Array.isArray(input)) return input[0] || "";
  return input || "";
}

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function getTimelineRange(windowSize: TimelineWindow) {
  if (windowSize === "all") return {};
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - (windowSize === "7d" ? 7 : 30));
  return {
    date_from: dateFrom.toISOString().slice(0, 10),
  };
}

function statusBadge(status: string) {
  const tones: Record<string, string> = {
    active: "badge-green",
    inactive: "badge-gray",
    present: "badge-green",
    absent: "badge-red",
    late: "badge-yellow",
    leave: "badge-blue",
    paid: "badge-green",
    partial: "badge-yellow",
    overdue: "badge-red",
    issued: "badge-blue",
    draft: "badge-gray",
    cancelled: "badge-gray",
  };
  const label = status?.replaceAll("_", " ") || "unknown";
  return <span className={tones[status] || "badge-gray"}>{label}</span>;
}

function disciplineSeverityBadge(severity: string) {
  const tones: Record<string, string> = {
    low: "badge-gray",
    medium: "badge-blue",
    high: "badge-yellow",
    critical: "badge-red",
  };
  return <span className={tones[severity] || "badge-gray"}>{severity.replaceAll("_", " ")}</span>;
}

function timelineMeta(event: StudentTimelineEvent) {
  const data = event.data || {};
  if (event.type === "attendance") {
    const status = String(data.status || "unknown");
    return {
      icon: "🟢",
      title: `Attendance: ${status.toUpperCase()}`,
      subtitle: data.check_in_at ? `Check-in ${formatDateTime(String(data.check_in_at))}` : "Attendance status updated",
    };
  }
  if (event.type === "homework_assigned") {
    return {
      icon: "📘",
      title: String(data.title || "Homework assigned"),
      subtitle: data.due_at ? `Due ${formatDateTime(String(data.due_at))}` : "Homework assigned to class",
    };
  }
  if (event.type === "assessment_score") {
    const obtained = asNumber(data.marks_obtained);
    const max = asNumber(data.max_marks);
    return {
      icon: "📊",
      title: String(data.title || "Assessment score"),
      subtitle: max > 0 ? `Score ${obtained}/${max} (${Math.round((obtained * 100) / max)}%)` : "Assessment score recorded",
    };
  }
  if (event.type === "fee_invoice") {
    const due = asNumber(data.amount_due);
    const paid = asNumber(data.amount_paid);
    return {
      icon: "💳",
      title: `Invoice ${String(data.status || "updated").toUpperCase()}`,
      subtitle: `Due ${currency(due)} • Paid ${currency(paid)}`,
    };
  }

  return {
    icon: "📌",
    title: event.type.replaceAll("_", " "),
    subtitle: "Timeline event",
  };
}

export default function StudentProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ studentId: string }>();
  const studentId = parseStudentId(params?.studentId);
  const roles = user?.roles || [];

  const canOpen = hasAnyRole(
    roles,
    ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk", "hr_admin", "parent", "student"]
  );
  const canViewFinance = hasAnyRole(roles, ["school_admin", "principal", "vice_principal", "accountant", "parent"]);
  const canViewInternalNotes = hasAnyRole(roles, ["school_admin", "principal", "vice_principal", "headmistress", "teacher"]);
  const canViewStudentDocuments = hasAnyRole(roles, [
    "school_admin",
    "principal",
    "vice_principal",
    "headmistress",
    "teacher",
    "parent",
    "student",
  ]);

  const [tab, setTab] = useState<StudentTab>("overview");
  const [timelineWindow, setTimelineWindow] = useState<TimelineWindow>("30d");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [profile, setProfile] = useState<StudentDetailRecord | null>(null);
  const [academic, setAcademic] = useState<StudentAcademicSummaryRecord | null>(null);
  const [disciplineSummary, setDisciplineSummary] = useState<StudentDisciplineSummaryRecord | null>(null);
  const [timeline, setTimeline] = useState<StudentTimelineEvent[]>([]);
  const [marksSummary, setMarksSummary] = useState<MarksSummaryData | null>(null);
  const [feeInvoices, setFeeInvoices] = useState<FeeInvoiceItem[]>([]);
  const [studentDocuments, setStudentDocuments] = useState<DocumentVaultItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!studentId || !canOpen) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const timelineParams: Record<string, string> = {
        max_events: "160",
      };
      const range = getTimelineRange(timelineWindow);
      if (range.date_from) {
        timelineParams.date_from = range.date_from;
      }
      const [studentDetail, academicSummary, studentTimeline] = await Promise.all([
        getPeopleStudent(studentId),
        getPeopleStudentAcademicSummary(studentId),
        getPeopleStudentTimeline(studentId, timelineParams),
      ]);

      setProfile(studentDetail);
      setAcademic(academicSummary);
      setTimeline(studentTimeline.events || []);
      try {
        const summary = await getStudentDisciplineSummary(studentId);
        setDisciplineSummary(summary);
      } catch {
        setDisciplineSummary(null);
      }

      try {
        const marksResponse = await getStudentMarksSummary(studentId);
        const marksData = marksResponse.data as MarksSummaryData;
        if (marksData && typeof marksData === "object") {
          setMarksSummary({
            overall_average: asNumber(marksData.overall_average),
            subject_averages: Array.isArray(marksData.subject_averages) ? marksData.subject_averages : [],
            trend: Array.isArray(marksData.trend) ? marksData.trend : [],
          });
        } else {
          setMarksSummary(null);
        }
      } catch {
        setMarksSummary(null);
      }

      if (canViewStudentDocuments) {
        try {
          setDocumentsLoading(true);
          const docsResponse = await getStudentDocuments(studentId, { page_size: 50 });
          setStudentDocuments(Array.isArray(docsResponse.data) ? docsResponse.data : []);
        } catch {
          setStudentDocuments([]);
        } finally {
          setDocumentsLoading(false);
        }
      } else {
        setStudentDocuments([]);
      }

      if (canViewFinance) {
        try {
          const invoicesResponse = await getFeeInvoices({ student_id: studentId, page_size: "80" });
          const rows = Array.isArray(invoicesResponse.data) ? (invoicesResponse.data as FeeInvoiceItem[]) : [];
          setFeeInvoices(rows);
        } catch (financeErr: unknown) {
          setFeeInvoices([]);
          setNotice(extractErrorMessage(financeErr, "Finance details are restricted for this role."));
        }
      } else {
        setFeeInvoices([]);
      }
    } catch (err: unknown) {
      setProfile(null);
      setAcademic(null);
      setTimeline([]);
      setDisciplineSummary(null);
      setMarksSummary(null);
      setFeeInvoices([]);
      setStudentDocuments([]);
      setError(extractErrorMessage(err, "Failed to load student profile"));
    } finally {
      setLoading(false);
    }
  }, [canOpen, canViewFinance, canViewStudentDocuments, studentId, timelineWindow]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleStudentDocumentDownload(documentId: string) {
    try {
      const data = await issueDocumentDownloadUrl(documentId);
      if (data.download?.url) {
        window.open(data.download.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: unknown) {
      setNotice(extractErrorMessage(err, "Unable to generate document download link."));
    }
  }

  const attendanceEvents = useMemo(
    () => timeline.filter((event) => event.type === "attendance"),
    [timeline]
  );

  const financeOverview = useMemo(() => {
    if (!academic?.fee_summary) {
      return {
        total_due: 0,
        total_paid: 0,
        outstanding: 0,
        overdue_count: 0,
      };
    }
    return academic.fee_summary;
  }, [academic]);

  const studentName = useMemo(() => {
    if (!profile) return "Student";
    return [profile.student.first_name, profile.student.last_name].filter(Boolean).join(" ").trim();
  }, [profile]);

  if (authLoading || loading) {
    return (
      <>
        <Header title="Student Profile" />
        <div className="p-6">
          <section className="card flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <p className="text-sm text-gray-600">Loading student profile...</p>
          </section>
        </div>
      </>
    );
  }

  if (!canOpen) {
    return (
      <>
        <Header title="Student Profile" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">Your role cannot access rich student profiles.</p>
          </section>
        </div>
      </>
    );
  }

  if (!profile || !academic) {
    return (
      <>
        <Header title="Student Profile" />
        <div className="space-y-4 p-6">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Student Not Found</h2>
            <p className="mt-2 text-sm text-gray-600">
              The profile may be unavailable or out of your role scope.
            </p>
          </section>
          <Link className="btn-secondary" href="/dashboard/students">
            Back to Students
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Student Profile" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">Rich Profile</p>
              <h2 className="mt-2 text-3xl font-extrabold">{studentName}</h2>
              <p className="mt-2 text-sm text-violet-100">
                Code {profile.student.student_code} • {profile.enrollment?.classroom.display_name || "Classroom not assigned"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {statusBadge(profile.student.status)}
              {statusBadge(profile.student.admission_status)}
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                Roll No: {profile.enrollment?.roll_no ?? "-"}
              </span>
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                Attendance: {academic.attendance_summary.rate}%
              </span>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{notice}</div>}

        <section className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {[
              { id: "overview", label: "Overview" },
              { id: "attendance", label: "Attendance" },
              { id: "academics", label: "Academics" },
              { id: "finance", label: "Finance" },
              { id: "discipline", label: "Discipline" },
              { id: "documents", label: "Documents" },
              { id: "timeline", label: "Timeline" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as StudentTab)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  tab === item.id ? "bg-primary-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        {tab === "overview" && (
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <article className="space-y-6 xl:col-span-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <DetailRow label="Date of Birth" value={formatDate(profile.student.date_of_birth)} />
                  <DetailRow label="Gender" value={profile.student.gender || "-"} />
                  <DetailRow label="Admission Date" value={formatDate(profile.student.admission_date)} />
                  <DetailRow label="Academic Year" value={profile.enrollment?.academic_year_name || "-"} />
                  <DetailRow label="Classroom" value={profile.enrollment?.classroom.display_name || "Unassigned"} />
                  <DetailRow label="Section" value={profile.enrollment?.section?.name || "-"} />
                  <DetailRow label="Emergency Contact Name" value={profile.student.emergency_contact_name || "Restricted / not available"} />
                  <DetailRow label="Emergency Contact Phone" value={profile.student.emergency_contact_phone || "Restricted / not available"} />
                </div>

                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Medical Alert</p>
                  <p className="mt-1 text-sm text-rose-800">{profile.student.medical_alert || "No medical alert on record or access restricted."}</p>
                </div>

                <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Transport / Placement Notes</p>
                  <p className="mt-1 text-sm text-cyan-900">{profile.student.transport_info || "No transport info captured."}</p>
                </div>

                {canViewInternalNotes && (
                  <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Internal Notes</p>
                    <p className="mt-1 text-sm text-indigo-900">{profile.student.notes || "No internal notes."}</p>
                  </div>
                )}
              </div>
            </article>

            <article className="space-y-6 xl:col-span-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Guardian Cards</h3>
                <div className="mt-4 space-y-3">
                  {profile.parents.length === 0 ? (
                    <p className="text-sm text-gray-500">No guardian linkage recorded.</p>
                  ) : (
                    profile.parents.map((parent) => (
                      <div key={parent.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-gray-900">
                            {[parent.first_name, parent.last_name].filter(Boolean).join(" ")}
                          </p>
                          {parent.is_primary ? <span className="badge-blue">Primary</span> : <span className="badge-gray">Secondary</span>}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 capitalize">{parent.relation_type.replaceAll("_", " ")}</p>
                        <p className="mt-2 text-sm text-gray-700">{parent.email || "Email hidden / unavailable"}</p>
                        <p className="text-sm text-gray-700">{parent.phone || "Phone hidden / unavailable"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Quick Snapshot</h3>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <MiniMetric label="Attendance Rate" value={`${academic.attendance_summary.rate}%`} />
                  <MiniMetric label="Homework Completion" value={`${academic.homework_summary.completion_rate}%`} />
                  <MiniMetric label="Avg Marks" value={`${academic.marks_summary.average_percentage}%`} />
                  <MiniMetric label="Timeline Events" value={String(timeline.length)} />
                </div>
              </div>
            </article>
          </section>
        )}

        {tab === "attendance" && (
          <section className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <MiniMetric label="Total Days" value={String(academic.attendance_summary.total_days)} />
              <MiniMetric label="Present" value={String(academic.attendance_summary.present)} />
              <MiniMetric label="Absent" value={String(academic.attendance_summary.absent)} />
              <MiniMetric label="Late" value={String(academic.attendance_summary.late)} />
              <MiniMetric label="Leave" value={String(academic.attendance_summary.leave)} />
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Attendance Timeline (Recent)</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Check-in</th>
                      <th className="py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceEvents.length === 0 ? (
                      <tr>
                        <td className="py-4 text-gray-400" colSpan={4}>No attendance events in selected range.</td>
                      </tr>
                    ) : (
                      attendanceEvents.slice(0, 30).map((event, idx) => (
                        <tr key={`${event.time}-${idx}`} className="border-b border-gray-100 last:border-b-0">
                          <td className="py-2 pr-3">{formatDate(event.date)}</td>
                          <td className="py-2 pr-3">{statusBadge(String(event.data?.status || "unknown"))}</td>
                          <td className="py-2 pr-3">{formatDateTime(String(event.data?.check_in_at || ""))}</td>
                          <td className="py-2 capitalize text-gray-700">{String(event.data?.source || "-")}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === "academics" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KpiCard title="Homework Assigned" value={String(academic.homework_summary.total_assigned)} tone="blue" />
              <KpiCard title="Homework Submitted" value={String(academic.homework_summary.submitted)} tone="emerald" />
              <KpiCard title="Average Marks" value={`${academic.marks_summary.average_percentage}%`} tone="violet" />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900">Subject Performance</h3>
                <div className="mt-4 space-y-3">
                  {marksSummary?.subject_averages?.length ? (
                    marksSummary.subject_averages.map((subject) => (
                      <div key={subject.subject_name}>
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                          <span>{subject.subject_name}</span>
                          <span>{subject.average}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${Math.max(0, Math.min(100, subject.average))}%` }} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">
                      Subject-wise marks trend is not available for this role yet.
                    </p>
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-3">
                <h3 className="text-lg font-semibold text-gray-900">Monthly Test Trend</h3>
                {marksSummary?.trend?.length ? (
                  <TrendChart trend={marksSummary.trend} />
                ) : (
                  <p className="mt-3 text-sm text-gray-500">
                    Marks trend points are not available for this role.
                  </p>
                )}
              </article>
            </div>
          </section>
        )}

        {tab === "finance" && (
          <section className="space-y-6">
            {!canViewFinance ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                Finance tab is restricted to school_admin, principal, vice_principal, accountant, and parent.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <KpiCard title="Total Due" value={currency(financeOverview.total_due)} tone="slate" />
                  <KpiCard title="Total Paid" value={currency(financeOverview.total_paid)} tone="emerald" />
                  <KpiCard title="Outstanding" value={currency(financeOverview.outstanding)} tone="rose" />
                  <KpiCard title="Overdue Invoices" value={String(financeOverview.overdue_count)} tone="amber" />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">Fee Ledger</h3>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="py-2 pr-3">Invoice</th>
                          <th className="py-2 pr-3">Due Date</th>
                          <th className="py-2 pr-3">Amount Due</th>
                          <th className="py-2 pr-3">Amount Paid</th>
                          <th className="py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feeInvoices.length === 0 ? (
                          <tr>
                            <td className="py-4 text-gray-400" colSpan={5}>No fee invoices available.</td>
                          </tr>
                        ) : (
                          feeInvoices.slice(0, 50).map((invoice) => (
                            <tr key={invoice.id} className="border-b border-gray-100 last:border-b-0">
                              <td className="py-2 pr-3 font-mono text-xs text-gray-700">{invoice.id.slice(0, 8)}</td>
                              <td className="py-2 pr-3 text-gray-700">{formatDate(invoice.due_date)}</td>
                              <td className="py-2 pr-3 text-gray-700">{currency(asNumber(invoice.amount_due))}</td>
                              <td className="py-2 pr-3 text-gray-700">{currency(asNumber(invoice.amount_paid))}</td>
                              <td className="py-2">{statusBadge(invoice.status)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {tab === "discipline" && (
          <section className="space-y-6">
            {!disciplineSummary ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                Discipline summary is unavailable for this role or student scope.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <MiniMetric label="Total Incidents" value={String(disciplineSummary.total_incidents)} />
                  <MiniMetric label="Open Incidents" value={String(disciplineSummary.open_incidents)} />
                  <MiniMetric label="Escalated" value={String(disciplineSummary.escalated_incidents)} />
                  <MiniMetric label="Resolved" value={String(disciplineSummary.resolved_incidents)} />
                  <MiniMetric label="Consequences" value={String(disciplineSummary.consequence_count)} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">Incident History</h3>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Type</th>
                          <th className="py-2 pr-3">Severity</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Notes</th>
                          <th className="py-2">Consequences</th>
                        </tr>
                      </thead>
                      <tbody>
                        {disciplineSummary.incidents.length === 0 ? (
                          <tr>
                            <td className="py-4 text-gray-400" colSpan={6}>
                              No discipline incidents for this student.
                            </td>
                          </tr>
                        ) : (
                          disciplineSummary.incidents.map((incident: DisciplineIncidentRecord) => (
                            <tr key={incident.id} className="border-b border-gray-100 last:border-b-0">
                              <td className="py-2 pr-3 text-gray-700">{formatDate(incident.incident_date)}</td>
                              <td className="py-2 pr-3 capitalize text-gray-700">
                                {incident.incident_type.replaceAll("_", " ")}
                              </td>
                              <td className="py-2 pr-3">{disciplineSeverityBadge(incident.severity)}</td>
                              <td className="py-2 pr-3">{statusBadge(incident.status)}</td>
                              <td className="py-2 pr-3 text-gray-700">
                                {incident.resolution_notes || incident.description || "-"}
                              </td>
                              <td className="py-2">
                                {incident.consequences?.length ? (
                                  <div className="flex flex-wrap gap-1">
                                    {incident.consequences.slice(0, 3).map((cons) => (
                                      <span key={cons.id} className="badge-blue">
                                        {cons.consequence_type.replaceAll("_", " ")}
                                      </span>
                                    ))}
                                    {incident.consequences.length > 3 && (
                                      <span className="badge-gray">+{incident.consequences.length - 3}</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-400">None</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {tab === "documents" && (
          <section className="space-y-4">
            {!canViewStudentDocuments ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                Document visibility is not available for your current role.
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                  <h3 className="text-lg font-semibold text-cyan-900">Student Document Vault</h3>
                  <p className="mt-1 text-sm text-cyan-800">
                    Certificates, report cards, medical records, and official student documents are listed below.
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-lg font-semibold text-gray-900">Documents</h4>
                    <span className="badge-blue">{studentDocuments.length} items</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="py-2 pr-3">Title</th>
                          <th className="py-2 pr-3">Category</th>
                          <th className="py-2 pr-3">Version</th>
                          <th className="py-2 pr-3">Updated</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documentsLoading ? (
                          <tr>
                            <td className="py-4 text-gray-400" colSpan={5}>
                              Loading documents...
                            </td>
                          </tr>
                        ) : studentDocuments.length === 0 ? (
                          <tr>
                            <td className="py-4 text-gray-400" colSpan={5}>
                              No student documents available yet.
                            </td>
                          </tr>
                        ) : (
                          studentDocuments.map((doc) => (
                            <tr key={doc.id} className="border-b border-gray-100 last:border-b-0">
                              <td className="py-2 pr-3">
                                <p className="font-semibold text-gray-900">{doc.title}</p>
                                <p className="text-xs text-gray-500">{doc.file_name}</p>
                              </td>
                              <td className="py-2 pr-3 text-gray-700">{doc.category.replaceAll("_", " ")}</td>
                              <td className="py-2 pr-3 text-gray-700">v{doc.version_no}</td>
                              <td className="py-2 pr-3 text-gray-700">{formatDateTime(doc.updated_at)}</td>
                              <td className="py-2 text-right">
                                <button
                                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                  onClick={() => handleStudentDocumentDownload(doc.id)}
                                >
                                  Download
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {tab === "timeline" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Daily Movement and Activity Timeline</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "7d", label: "Last 7 Days" },
                    { id: "30d", label: "Last 30 Days" },
                    { id: "all", label: "All" },
                  ].map((windowButton) => (
                    <button
                      key={windowButton.id}
                      type="button"
                      onClick={() => setTimelineWindow(windowButton.id as TimelineWindow)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        timelineWindow === windowButton.id
                          ? "bg-primary-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {windowButton.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {timeline.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
                  No timeline events in this range.
                </div>
              ) : (
                timeline.map((event, index) => {
                  const meta = timelineMeta(event);
                  return (
                    <article key={`${event.time}-${event.type}-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-xl">{meta.icon}</div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-gray-900">{meta.title}</p>
                            <p className="text-xs text-gray-500">{formatDateTime(event.time)}</p>
                          </div>
                          <p className="mt-1 text-sm text-gray-600">{meta.subtitle}</p>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function KpiCard({ title, value, tone }: { title: string; value: string; tone: "blue" | "emerald" | "violet" | "rose" | "amber" | "slate" }) {
  const toneClass: Record<string, string> = {
    blue: "from-blue-500 to-cyan-500",
    emerald: "from-emerald-500 to-teal-500",
    violet: "from-violet-500 to-indigo-500",
    rose: "from-rose-500 to-pink-500",
    amber: "from-amber-500 to-orange-500",
    slate: "from-slate-500 to-gray-600",
  };
  return (
    <article className={`rounded-2xl bg-gradient-to-r ${toneClass[tone]} p-4 text-white shadow-sm`}>
      <p className="text-xs uppercase tracking-wide text-white/80">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}

function TrendChart({ trend }: { trend: Array<{ label: string; average: number }> }) {
  const chartPoints = useMemo(() => {
    if (trend.length === 0) return "";
    const width = 560;
    const height = 160;
    const padX = 20;
    const padY = 18;
    const safe = trend.map((point) => ({ ...point, average: Math.max(0, Math.min(100, point.average)) }));
    return safe
      .map((point, index) => {
        const x = safe.length === 1 ? width / 2 : padX + (index * (width - padX * 2)) / (safe.length - 1);
        const y = height - padY - (point.average * (height - padY * 2)) / 100;
        return `${x},${y}`;
      })
      .join(" ");
  }, [trend]);

  const latest = trend.at(-1);
  const first = trend[0];
  const delta = latest && first ? Number((latest.average - first.average).toFixed(2)) : 0;

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Latest Average</span>
          <span className="font-semibold text-gray-900">{latest ? `${latest.average}%` : "-"}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-gray-600">Progress Delta</span>
          <span className={`font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        </div>
      </div>

      <svg viewBox="0 0 560 160" className="h-44 w-full rounded-xl border border-gray-200 bg-white p-2">
        <defs>
          <linearGradient id="agoraTrendStroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="url(#agoraTrendStroke)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={chartPoints}
        />
        {trend.map((point, index) => {
          const x = trend.length === 1 ? 280 : 20 + (index * (560 - 40)) / (trend.length - 1);
          const y = 160 - 18 - (Math.max(0, Math.min(100, point.average)) * (160 - 36)) / 100;
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="3.5" fill="#4f46e5" />;
        })}
      </svg>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 md:grid-cols-4">
        {trend.slice(-8).map((point) => (
          <div key={point.label} className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
            <p className="truncate">{point.label}</p>
            <p className="font-semibold text-gray-800">{point.average}%</p>
          </div>
        ))}
      </div>
    </div>
  );
}
