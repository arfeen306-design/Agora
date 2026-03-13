"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import SavedViewsPanel from "@/components/filters/SavedViewsPanel";
import { useAuth } from "@/lib/auth";
import {
  exportReport,
  getAttendanceSummary,
  getExecutiveOverview,
  getFeesSummary,
  getLookupAcademicYears,
  getHomeworkSummary,
  getLookupClassrooms,
  getLookupStudents,
  getLookupSubjects,
  getMarksSummary,
  type ExecutiveOverviewRecord,
  type LookupClassroom,
  type LookupStudent,
  type LookupSubject,
} from "@/lib/api";
import {
  buildShareUrl,
  loadSavedFilterViews,
  persistSavedFilterViews,
  type SavedFilterView,
  upsertSavedView,
} from "@/lib/saved-views";

interface AttendanceSummary {
  total_records: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  leave_count: number;
  present_rate: number;
  absent_rate: number;
}

interface HomeworkSummary {
  distinct_homework_count: number;
  total_assigned: number;
  submitted_count: number;
  reviewed_count: number;
  missing_count: number;
  pending_count: number;
  completion_rate: number;
}

interface MarksSummary {
  score_count: number;
  assessment_count: number;
  avg_marks_obtained: number;
  max_marks_obtained: number;
  min_marks_obtained: number;
  avg_percentage: number;
}

interface FeesSummary {
  total_invoices: number;
  paid_count: number;
  overdue_count: number;
  amount_due_total: number;
  amount_paid_total: number;
  outstanding_total: number;
  overdue_total: number;
}

type ReportKind = "attendance" | "homework" | "marks" | "fees";
type ExportFormat = "csv" | "pdf";

const reportKinds: Array<{ key: ReportKind; label: string }> = [
  { key: "attendance", label: "Attendance" },
  { key: "homework", label: "Homework" },
  { key: "marks", label: "Marks" },
  { key: "fees", label: "Fees" },
];

const REPORT_FILTERS_KEY = "agora_web_reports_filters_v1";
const REPORT_SAVED_VIEW_KEY = "agora_web_reports_saved_view_v1";
const REPORT_SAVED_VIEWS_KEY = "agora_web_reports_saved_views_v1";

const defaultFilters = {
  date_from: "",
  date_to: "",
  academic_year_id: "",
  classroom_id: "",
  student_id: "",
  subject_id: "",
  status: "",
  assessment_type: "",
};

function normalizeReportFilters(value: Partial<typeof defaultFilters> | null | undefined) {
  return {
    date_from: typeof value?.date_from === "string" ? value.date_from : "",
    date_to: typeof value?.date_to === "string" ? value.date_to : "",
    academic_year_id: typeof value?.academic_year_id === "string" ? value.academic_year_id : "",
    classroom_id: typeof value?.classroom_id === "string" ? value.classroom_id : "",
    student_id: typeof value?.student_id === "string" ? value.student_id : "",
    subject_id: typeof value?.subject_id === "string" ? value.subject_id : "",
    status: typeof value?.status === "string" ? value.status : "",
    assessment_type: typeof value?.assessment_type === "string" ? value.assessment_type : "",
  };
}

export default function ReportsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roles = user?.roles || [];
  const canViewExecutiveOverview =
    roles.includes("school_admin") || roles.includes("principal") || roles.includes("vice_principal");

  const [executiveOverview, setExecutiveOverview] = useState<ExecutiveOverviewRecord | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [homework, setHomework] = useState<HomeworkSummary | null>(null);
  const [marks, setMarks] = useState<MarksSummary | null>(null);
  const [fees, setFees] = useState<FeesSummary | null>(null);

  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string }>>([]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [downloadState, setDownloadState] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const [viewMessage, setViewMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);

  const [filters, setFilters] = useState(defaultFilters);

  const buildCommonFilters = useCallback(() => {
    const params: Record<string, string> = {};
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.academic_year_id) params.academic_year_id = filters.academic_year_id;
    if (filters.classroom_id) params.classroom_id = filters.classroom_id;
    if (filters.student_id) params.student_id = filters.student_id;
    if (filters.subject_id) params.subject_id = filters.subject_id;
    return params;
  }, [filters.date_from, filters.date_to, filters.academic_year_id, filters.classroom_id, filters.student_id, filters.subject_id]);

  const loadLookups = useCallback(async () => {
    try {
      const [classroomList, studentList, subjectList] = await Promise.all([
        getLookupClassrooms({ page_size: 100 }),
        getLookupStudents({
          page_size: 100,
          ...(filters.classroom_id ? { classroom_id: filters.classroom_id } : {}),
        }),
        getLookupSubjects({
          page_size: 100,
          ...(filters.classroom_id ? { classroom_id: filters.classroom_id } : {}),
        }),
      ]);
      const academicYearList = await getLookupAcademicYears({ page_size: 100 });
      setClassrooms(classroomList);
      setStudents(studentList);
      setSubjects(subjectList);
      setAcademicYears(academicYearList.map((row) => ({ id: row.id, label: row.label || row.name })));
    } catch {
      setClassrooms([]);
      setStudents([]);
      setSubjects([]);
      setAcademicYears([]);
    }
  }, [filters.classroom_id]);

  const loadSummaries = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const common = buildCommonFilters();

    try {
      const [executiveRes, attRes, hwRes, marksRes, feesRes] = await Promise.all([
        canViewExecutiveOverview ? getExecutiveOverview(common) : Promise.resolve(null),
        getAttendanceSummary(common),
        getHomeworkSummary(common),
        getMarksSummary({
          ...common,
          ...(filters.assessment_type ? { assessment_type: filters.assessment_type } : {}),
        }),
        getFeesSummary({
          ...common,
          ...(filters.status ? { status: filters.status } : {}),
        }),
      ]);

      setExecutiveOverview(executiveRes?.data || null);
      setAttendance(attRes.data as AttendanceSummary);
      setHomework(hwRes.data as HomeworkSummary);
      setMarks(marksRes.data as MarksSummary);
      setFees(feesRes.data as FeesSummary);
    } catch (err: unknown) {
      setExecutiveOverview(null);
      setAttendance(null);
      setHomework(null);
      setMarks(null);
      setFees(null);
      setMessage(err instanceof Error ? err.message : "Failed to load report summaries");
    } finally {
      setLoading(false);
    }
  }, [buildCommonFilters, canViewExecutiveOverview, filters.assessment_type, filters.status]);

  useEffect(() => {
    const existingViews = loadSavedFilterViews(REPORT_SAVED_VIEWS_KEY, REPORT_SAVED_VIEW_KEY);
    setSavedViews(existingViews);
    const searchPrefill = {} as Partial<typeof defaultFilters>;
    const params = new URLSearchParams(searchParams.toString());
    if (!params.toString()) {
      const latestView = existingViews[0];
      if (latestView?.query) {
        const savedParams = new URLSearchParams(latestView.query);
        savedParams.forEach((value, key) => params.set(key, value));
      }
    }
    if (params.has("date_from")) searchPrefill.date_from = params.get("date_from") || "";
    if (params.has("date_to")) searchPrefill.date_to = params.get("date_to") || "";
    if (params.has("academic_year_id")) searchPrefill.academic_year_id = params.get("academic_year_id") || "";
    if (params.has("classroom_id")) searchPrefill.classroom_id = params.get("classroom_id") || "";
    if (params.has("student_id")) searchPrefill.student_id = params.get("student_id") || "";
    if (params.has("subject_id")) searchPrefill.subject_id = params.get("subject_id") || "";
    if (params.has("status")) searchPrefill.status = params.get("status") || "";
    if (params.has("assessment_type")) searchPrefill.assessment_type = params.get("assessment_type") || "";

    try {
      const raw = localStorage.getItem(REPORT_FILTERS_KEY);
      let stored = {} as Partial<typeof defaultFilters>;
      if (raw) {
        stored = JSON.parse(raw) as Partial<typeof defaultFilters>;
      }
      setFilters(normalizeReportFilters({
        ...defaultFilters,
        ...stored,
        ...searchPrefill,
      }));
    } catch {
      setFilters((prev) => normalizeReportFilters({
        ...prev,
        ...searchPrefill,
      }));
    } finally {
      setHydrated(true);
      setUrlSyncReady(true);
    }
  }, [searchParams]);

  const buildCurrentQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.academic_year_id) params.set("academic_year_id", filters.academic_year_id);
    if (filters.classroom_id) params.set("classroom_id", filters.classroom_id);
    if (filters.student_id) params.set("student_id", filters.student_id);
    if (filters.subject_id) params.set("subject_id", filters.subject_id);
    if (filters.status) params.set("status", filters.status);
    if (filters.assessment_type) params.set("assessment_type", filters.assessment_type);
    return params.toString();
  }, [
    filters.date_from,
    filters.date_to,
    filters.academic_year_id,
    filters.classroom_id,
    filters.student_id,
    filters.subject_id,
    filters.status,
    filters.assessment_type,
  ]);

  useEffect(() => {
    if (!hydrated || !urlSyncReady) return;
    setViewMessage("");
    const next = buildCurrentQuery();
    const current = searchParams.toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }, [hydrated, urlSyncReady, buildCurrentQuery, pathname, router, searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(REPORT_FILTERS_KEY, JSON.stringify(filters));
  }, [hydrated, filters]);

  const hasActiveFilters = Object.values(filters).some((value) => String(value || "").trim() !== "");
  const activeFilters = [
    filters.date_from
      ? { key: "date_from", label: `From: ${filters.date_from}`, clear: () => setFilters((prev) => ({ ...prev, date_from: "" })) }
      : null,
    filters.date_to
      ? { key: "date_to", label: `To: ${filters.date_to}`, clear: () => setFilters((prev) => ({ ...prev, date_to: "" })) }
      : null,
    filters.academic_year_id
      ? {
          key: "academic_year_id",
          label: `Academic Year: ${
            academicYears.find((item) => item.id === filters.academic_year_id)?.label || filters.academic_year_id
          }`,
          clear: () => setFilters((prev) => ({ ...prev, academic_year_id: "" })),
        }
      : null,
    filters.classroom_id
      ? {
          key: "classroom_id",
          label: `Classroom: ${classrooms.find((item) => item.id === filters.classroom_id)?.label || filters.classroom_id}`,
          clear: () =>
            setFilters((prev) => ({ ...prev, classroom_id: "", student_id: "", subject_id: "" })),
        }
      : null,
    filters.student_id
      ? {
          key: "student_id",
          label: `Student: ${students.find((item) => item.id === filters.student_id)?.label || filters.student_id}`,
          clear: () => setFilters((prev) => ({ ...prev, student_id: "" })),
        }
      : null,
    filters.subject_id
      ? {
          key: "subject_id",
          label: `Subject: ${subjects.find((item) => item.id === filters.subject_id)?.label || filters.subject_id}`,
          clear: () => setFilters((prev) => ({ ...prev, subject_id: "" })),
        }
      : null,
    filters.assessment_type
      ? {
          key: "assessment_type",
          label: `Assessment: ${filters.assessment_type}`,
          clear: () => setFilters((prev) => ({ ...prev, assessment_type: "" })),
        }
      : null,
    filters.status
      ? {
          key: "status",
          label: `Invoice Status: ${filters.status}`,
          clear: () => setFilters((prev) => ({ ...prev, status: "" })),
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  function clearAllFilters() {
    setFilters(normalizeReportFilters(defaultFilters));
    setMessage("");
    setViewMessage("");
  }

  function saveCurrentView() {
    const query = buildCurrentQuery();
    if (!query) {
      setViewMessage("Add at least one filter before saving a view.");
      return;
    }
    try {
      const nextViews = upsertSavedView(savedViews, query, "Report View");
      setSavedViews(nextViews);
      persistSavedFilterViews(REPORT_SAVED_VIEWS_KEY, nextViews, REPORT_SAVED_VIEW_KEY);
      localStorage.setItem(REPORT_FILTERS_KEY, JSON.stringify(filters));
      setViewMessage("Saved view added.");
    } catch {
      setViewMessage("Unable to save view on this browser.");
    }
  }

  async function copyCurrentLink() {
    const url = buildShareUrl(pathname, buildCurrentQuery());
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Current link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  async function copySavedViewLink(view: SavedFilterView) {
    const url = buildShareUrl(pathname, view.query);
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Saved view link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  function applySavedView(view: SavedFilterView) {
    router.replace(`${pathname}?${view.query}`, { scroll: false });
    setViewMessage(`Applied "${view.name}".`);
  }

  function deleteSavedView(viewId: string) {
    const nextViews = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(nextViews);
    persistSavedFilterViews(REPORT_SAVED_VIEWS_KEY, nextViews, REPORT_SAVED_VIEW_KEY);
    setViewMessage("Saved view removed.");
  }

  useEffect(() => {
    if (!hydrated) return;
    loadLookups();
  }, [hydrated, loadLookups]);

  useEffect(() => {
    if (!hydrated) return;
    loadSummaries();
  }, [hydrated, loadSummaries]);

  async function download(kind: ReportKind, format: ExportFormat) {
    const actionKey = `${kind}_${format}`;
    setDownloadState((prev) => ({ ...prev, [actionKey]: true }));
    setMessage("");

    const common = buildCommonFilters();
    const extra: Record<string, string> = {};
    if (kind === "marks" && filters.assessment_type) extra.assessment_type = filters.assessment_type;
    if (kind === "fees" && filters.status) extra.status = filters.status;

    try {
      const blob = await exportReport(kind, format, {
        ...common,
        ...extra,
        max_rows: "5000",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `agora-${kind}-report-${timestamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloadState((prev) => ({ ...prev, [actionKey]: false }));
    }
  }

  return (
    <>
      <Header title="Reports" />
      <div className="p-6">
        {message && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}
        {viewMessage && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {viewMessage}
          </div>
        )}

        <div className="card mb-6">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Filters</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="label-text">Date From</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date From"
                value={filters.date_from}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Date To</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date To"
                value={filters.date_to}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Academic Year</label>
              <select
                className="input-field"
                aria-label="Academic Year"
                value={filters.academic_year_id}
                onChange={(e) => setFilters((prev) => ({ ...prev, academic_year_id: e.target.value }))}
              >
                <option value="">All Academic Years</option>
                {academicYears.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Classroom</label>
              <select
                className="input-field"
                aria-label="Classroom"
                value={filters.classroom_id}
                onChange={(e) => {
                  const classroomId = e.target.value;
                  setFilters((prev) => ({
                    ...prev,
                    classroom_id: classroomId,
                    student_id: "",
                    subject_id: "",
                  }));
                }}
              >
                <option value="">All classrooms</option>
                {classrooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Student</label>
              <select
                className="input-field"
                aria-label="Student"
                value={filters.student_id}
                onChange={(e) => setFilters((prev) => ({ ...prev, student_id: e.target.value }))}
              >
                <option value="">All students</option>
                {students.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Subject</label>
              <select
                className="input-field"
                aria-label="Subject"
                value={filters.subject_id}
                onChange={(e) => setFilters((prev) => ({ ...prev, subject_id: e.target.value }))}
              >
                <option value="">All subjects</option>
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Assessment Type</label>
              <input
                type="text"
                className="input-field"
                aria-label="Assessment Type"
                placeholder="quiz/monthly"
                value={filters.assessment_type}
                onChange={(e) => setFilters((prev) => ({ ...prev, assessment_type: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Invoice Status</label>
              <select
                className="input-field"
                aria-label="Invoice Status"
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-primary w-full" onClick={loadSummaries} disabled={loading}>
                {loading ? "Loading..." : "Refresh Summaries"}
              </button>
              <button
                className="btn-secondary"
                onClick={clearAllFilters}
              >
                Clear all
              </button>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"
                  onClick={filter.clear}
                  type="button"
                >
                  {filter.label} ×
                </button>
              ))}
            </div>
          )}
          <SavedViewsPanel
            title="Saved Report Views"
            views={savedViews}
            onSaveCurrent={saveCurrentView}
            onCopyCurrent={copyCurrentLink}
            onApply={applySavedView}
            onCopy={copySavedViewLink}
            onDelete={deleteSavedView}
            emptyText="Save report filters to quickly reopen the same analytics window."
          />
        </div>

        {canViewExecutiveOverview && (
          <section className="mb-6 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">Executive Analytics</p>
                <h3 className="mt-2 text-3xl font-extrabold">Leadership Snapshot</h3>
                <p className="mt-2 text-sm text-indigo-100">
                  Attendance, marks, homework, and fee aging trends across the selected window.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <MetricCard
                  label="Attendance"
                  value={executiveOverview ? `${executiveOverview.kpis.attendance_present_rate.toFixed(1)}%` : "—"}
                />
                <MetricCard
                  label="Marks Avg"
                  value={executiveOverview ? `${executiveOverview.kpis.marks_avg_percentage.toFixed(1)}%` : "—"}
                />
                <MetricCard
                  label="Homework"
                  value={executiveOverview ? `${executiveOverview.kpis.homework_completion_rate.toFixed(1)}%` : "—"}
                />
                <MetricCard
                  label="Outstanding"
                  value={
                    executiveOverview
                      ? `Rs ${Math.round(executiveOverview.kpis.fee_outstanding_total).toLocaleString()}`
                      : "—"
                  }
                />
                <MetricCard
                  label="Overdue Invoices"
                  value={executiveOverview ? String(executiveOverview.kpis.fee_overdue_invoices) : "—"}
                />
              </div>
            </div>
            {executiveOverview && executiveOverview.alerts.length > 0 && (
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {executiveOverview.alerts.map((alert, index) => (
                  <div
                    key={`${alert.code || alert.title || alert.message}-${index}`}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      alert.severity === "critical"
                        ? "bg-red-100/95 text-red-700"
                        : "bg-amber-100/95 text-amber-700"
                    }`}
                  >
                    <p className="font-semibold">{alert.message}</p>
                    {alert.value !== null && alert.value !== undefined ? (
                      <p className="text-xs">
                        Current: {typeof alert.value === "number" ? alert.value.toFixed(2) : String(alert.value)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {canViewExecutiveOverview && executiveOverview && (
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card">
              <h4 className="mb-3 text-lg font-semibold">Attendance Trend</h4>
              {executiveOverview.attendance_trend.length === 0 ? (
                <p className="text-sm text-gray-500">No attendance trend data for this window.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {executiveOverview.attendance_trend.slice(-6).map((row) => (
                    <div key={row.period_start} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                      <span>{new Date(row.period_start).toLocaleDateString()}</span>
                      <span className="font-semibold">{row.present_rate.toFixed(1)}% present</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <h4 className="mb-3 text-lg font-semibold">Marks Trend</h4>
              {executiveOverview.marks_trend.length === 0 ? (
                <p className="text-sm text-gray-500">No marks trend data for this window.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {executiveOverview.marks_trend.slice(-6).map((row) => (
                    <div key={row.period_start} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                      <span>{new Date(row.period_start).toLocaleDateString()}</span>
                      <span className="font-semibold">{Number(row.average_percentage ?? row.avg_percentage ?? 0).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card">
            <h4 className="mb-3 text-lg font-semibold">Attendance Summary</h4>
            {loading || !attendance ? (
              <p className="text-gray-400">Loading...</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  Total records: <strong>{attendance.total_records}</strong>
                </p>
                <p>
                  Present: <strong>{attendance.present_count}</strong> ({attendance.present_rate}%)
                </p>
                <p>
                  Absent: <strong>{attendance.absent_count}</strong> ({attendance.absent_rate}%)
                </p>
                <p>
                  Late: <strong>{attendance.late_count}</strong>
                </p>
                <p>
                  Leave: <strong>{attendance.leave_count}</strong>
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h4 className="mb-3 text-lg font-semibold">Homework Summary</h4>
            {loading || !homework ? (
              <p className="text-gray-400">Loading...</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  Total assigned: <strong>{homework.total_assigned}</strong>
                </p>
                <p>
                  Distinct homework: <strong>{homework.distinct_homework_count}</strong>
                </p>
                <p>
                  Submitted: <strong>{homework.submitted_count}</strong>
                </p>
                <p>
                  Reviewed: <strong>{homework.reviewed_count}</strong>
                </p>
                <p>
                  Missing: <strong>{homework.missing_count}</strong>
                </p>
                <p>
                  Completion rate: <strong>{homework.completion_rate}%</strong>
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h4 className="mb-3 text-lg font-semibold">Marks Summary</h4>
            {loading || !marks ? (
              <p className="text-gray-400">Loading...</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  Scores: <strong>{marks.score_count}</strong>
                </p>
                <p>
                  Assessments: <strong>{marks.assessment_count}</strong>
                </p>
                <p>
                  Average marks: <strong>{marks.avg_marks_obtained}</strong>
                </p>
                <p>
                  Average percentage: <strong>{marks.avg_percentage}%</strong>
                </p>
                <p>
                  Highest score: <strong>{marks.max_marks_obtained}</strong>
                </p>
                <p>
                  Lowest score: <strong>{marks.min_marks_obtained}</strong>
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h4 className="mb-3 text-lg font-semibold">Fees Summary</h4>
            {loading || !fees ? (
              <p className="text-gray-400">Loading...</p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  Total invoices: <strong>{fees.total_invoices}</strong>
                </p>
                <p>
                  Paid count: <strong>{fees.paid_count}</strong>
                </p>
                <p>
                  Overdue count: <strong>{fees.overdue_count}</strong>
                </p>
                <p>
                  Total due: <strong>Rs. {fees.amount_due_total.toLocaleString()}</strong>
                </p>
                <p>
                  Total paid: <strong>Rs. {fees.amount_paid_total.toLocaleString()}</strong>
                </p>
                <p>
                  Outstanding: <strong>Rs. {fees.outstanding_total.toLocaleString()}</strong>
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Export Reports</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {reportKinds.map((item) => (
              <div key={item.key} className="rounded-lg border border-gray-200 p-4">
                <p className="mb-3 font-medium text-gray-900">{item.label}</p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary"
                    onClick={() => download(item.key, "csv")}
                    disabled={downloadState[`${item.key}_csv`]}
                  >
                    {downloadState[`${item.key}_csv`] ? "Downloading..." : "Export CSV"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => download(item.key, "pdf")}
                    disabled={downloadState[`${item.key}_pdf`]}
                  >
                    {downloadState[`${item.key}_pdf`] ? "Downloading..." : "Export PDF"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/30 bg-white/15 px-3 py-2 backdrop-blur">
      <p className="text-xs text-indigo-100">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
