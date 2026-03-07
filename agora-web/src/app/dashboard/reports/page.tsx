"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import {
  exportReport,
  getAttendanceSummary,
  getFeesSummary,
  getHomeworkSummary,
  getLookupClassrooms,
  getLookupStudents,
  getLookupSubjects,
  getMarksSummary,
  type LookupClassroom,
  type LookupStudent,
  type LookupSubject,
} from "@/lib/api";

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

const defaultFilters = {
  date_from: "",
  date_to: "",
  classroom_id: "",
  student_id: "",
  subject_id: "",
  status: "",
  assessment_type: "",
};

export default function ReportsPage() {
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [homework, setHomework] = useState<HomeworkSummary | null>(null);
  const [marks, setMarks] = useState<MarksSummary | null>(null);
  const [fees, setFees] = useState<FeesSummary | null>(null);

  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [downloadState, setDownloadState] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  const [filters, setFilters] = useState(defaultFilters);

  const buildCommonFilters = useCallback(() => {
    const params: Record<string, string> = {};
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.classroom_id) params.classroom_id = filters.classroom_id;
    if (filters.student_id) params.student_id = filters.student_id;
    if (filters.subject_id) params.subject_id = filters.subject_id;
    return params;
  }, [filters.date_from, filters.date_to, filters.classroom_id, filters.student_id, filters.subject_id]);

  const loadLookups = useCallback(async () => {
    try {
      const [classroomList, studentList, subjectList] = await Promise.all([
        getLookupClassrooms({ page_size: 200 }),
        getLookupStudents({
          page_size: 200,
          ...(filters.classroom_id ? { classroom_id: filters.classroom_id } : {}),
        }),
        getLookupSubjects({
          page_size: 200,
          ...(filters.classroom_id ? { classroom_id: filters.classroom_id } : {}),
        }),
      ]);
      setClassrooms(classroomList);
      setStudents(studentList);
      setSubjects(subjectList);
    } catch {
      setClassrooms([]);
      setStudents([]);
      setSubjects([]);
    }
  }, [filters.classroom_id]);

  const loadSummaries = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const common = buildCommonFilters();

    try {
      const [attRes, hwRes, marksRes, feesRes] = await Promise.all([
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

      setAttendance(attRes.data as AttendanceSummary);
      setHomework(hwRes.data as HomeworkSummary);
      setMarks(marksRes.data as MarksSummary);
      setFees(feesRes.data as FeesSummary);
    } catch (err: unknown) {
      setAttendance(null);
      setHomework(null);
      setMarks(null);
      setFees(null);
      setMessage(err instanceof Error ? err.message : "Failed to load report summaries");
    } finally {
      setLoading(false);
    }
  }, [buildCommonFilters, filters.assessment_type, filters.status]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(REPORT_FILTERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as typeof defaultFilters;
        setFilters((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore bad localStorage payload
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(REPORT_FILTERS_KEY, JSON.stringify(filters));
  }, [hydrated, filters]);

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

        <div className="card mb-6">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Filters</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="label-text">Date From</label>
              <input
                type="date"
                className="input-field"
                value={filters.date_from}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Date To</label>
              <input
                type="date"
                className="input-field"
                value={filters.date_to}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Classroom</label>
              <select
                className="input-field"
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
                placeholder="quiz/monthly"
                value={filters.assessment_type}
                onChange={(e) => setFilters((prev) => ({ ...prev, assessment_type: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Invoice Status</label>
              <select
                className="input-field"
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
                onClick={() => {
                  setFilters(defaultFilters);
                  setMessage("");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

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
