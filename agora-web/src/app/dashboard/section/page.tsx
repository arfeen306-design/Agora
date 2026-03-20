"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { MiniDonutChart, ProgressStripe } from "@/components/dashboard/shared/InsightCharts";
import ClassroomWeeklyTimetableBoard from "@/components/timetable/ClassroomWeeklyTimetableBoard";
import { useAuth } from "@/lib/auth";
import {
  getClassroomManualTimetableBoard,
  getSectionDashboard,
  type ClassroomWeeklyTimetableBoardPayload,
  type SectionDashboardData,
  type SectionDashboardDetail,
} from "@/lib/api";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "classes", label: "Classes" },
  { key: "staff", label: "Staff" },
  { key: "results", label: "Results" },
  { key: "timetable", label: "Timetable" },
  { key: "admissions", label: "Admissions" },
  { key: "discipline", label: "Discipline & Events" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export default function SectionDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [payload, setPayload] = useState<SectionDashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [timetableBoard, setTimetableBoard] = useState<ClassroomWeeklyTimetableBoardPayload | null>(null);
  const [timetableLoading, setTimetableLoading] = useState(false);

  const isHeadmistress = Boolean(user?.roles?.includes("headmistress"));

  useEffect(() => {
    if (!user || !isHeadmistress) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params: Record<string, string> = { include_detail: "true" };
        if (selectedSectionId) params.section_id = selectedSectionId;
        const response = await getSectionDashboard(params);
        if (cancelled) return;
        setPayload(response.data);
        if (!selectedSectionId && response.data?.selected_section_id) {
          setSelectedSectionId(response.data.selected_section_id);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPayload(null);
        setError(err instanceof Error ? err.message : "Failed to load section dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isHeadmistress, selectedSectionId, user]);

  const detail = payload?.selected_section_detail || null;
  const selectedSection = detail?.section || payload?.sections?.find((row) => row.section_id === payload?.selected_section_id) || null;

  const summaryKpis = useMemo(() => {
    return [
      {
        label: "Students",
        value: formatNumber(selectedSection?.active_students || detail?.parent_access_summary?.active_students || 0),
        helper: "Active learners in this section",
      },
      {
        label: "Staff",
        value: formatNumber(selectedSection?.assigned_staff || detail?.staff_profiles?.length || 0),
        helper: "Teachers and section staff assigned",
      },
      {
        label: "Parents linked",
        value: formatNumber(detail?.parent_access_summary?.linked_parents || 0),
        helper: "Guardian access already mapped",
      },
      {
        label: "Classes",
        value: formatNumber(selectedSection?.class_count || detail?.class_attendance?.length || 0),
        helper: "Classrooms under this HM",
      },
    ];
  }, [detail, selectedSection]);

  useEffect(() => {
    if (!detail?.class_attendance?.length) {
      setSelectedClassroomId("");
      return;
    }
    setSelectedClassroomId((current) => {
      if (current && detail.class_attendance.some((row) => row.classroom_id === current)) {
        return current;
      }
      return detail.class_attendance[0]?.classroom_id || "";
    });
  }, [detail]);

  useEffect(() => {
    if (activeTab !== "timetable" || !selectedClassroomId) return;

    let cancelled = false;

    async function loadBoard() {
      setTimetableLoading(true);
      try {
        const nextBoard = await getClassroomManualTimetableBoard(selectedClassroomId);
        if (!cancelled) setTimetableBoard(nextBoard);
      } catch (err) {
        if (!cancelled) {
          setTimetableBoard(null);
          setError(err instanceof Error ? err.message : "Failed to load timetable");
        }
      } finally {
        if (!cancelled) setTimetableLoading(false);
      }
    }

    loadBoard();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedClassroomId]);

  if (!isHeadmistress) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="p-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Headmistress Access Required</h2>
            <p className="mt-2 text-sm text-slate-600">
              This screen is available for the Headmistress role and only shows assigned section data.
            </p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="space-y-6 p-6">
          <div className="h-56 animate-pulse rounded-[32px] bg-gradient-to-r from-emerald-500 to-cyan-500" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-3xl bg-white/80" />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (!payload || payload.sections.length === 0) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="p-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">No Section Assigned</h2>
            <p className="mt-2 text-sm text-slate-600">
              Your account is active but not currently linked to any section.
            </p>
            <div className="mt-4 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
              Ask School Admin or Principal to assign your user as Headmistress or coordinator for a section in Institution settings.
            </div>
          </section>
        </div>
      </>
    );
  }

  if (!detail || !selectedSection) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="p-6">
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-rose-900">Section detail unavailable</h2>
            <p className="mt-2 text-sm text-rose-700">{error || "Select another section or refresh the page."}</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Section Dashboard" />
      <div className="space-y-6 p-6">
        {error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}

        {payload.sections.length > 1 ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="label-text">Viewing section</label>
            <select className="input-field max-w-sm" value={selectedSection.section_id} onChange={(e) => setSelectedSectionId(e.target.value)}>
              {payload.sections.map((row) => (
                <option key={row.section_id} value={row.section_id}>
                  {row.section_name} ({row.section_code})
                </option>
              ))}
            </select>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-[32px] bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-500 p-8 text-white shadow-2xl shadow-emerald-950/20">
          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-emerald-50/80">Headmistress section workspace</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">{selectedSection.section_name} section operations</h1>
              <p className="mt-3 text-sm text-emerald-50/90">
                Run classes, staff, attendance, report-card progress, admissions, discipline, and section operations from one coordinated dashboard.
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-white/[0.15] px-4 py-2 font-semibold">HM: {detail.leadership?.head_name || "Unassigned"}</span>
                <span className="rounded-full bg-white/10 px-4 py-2 font-semibold">Coordinator: {detail.leadership?.coordinator_name || "Not assigned"}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-slate-950">
              {summaryKpis.map((item) => (
                <div key={item.label} className="rounded-3xl bg-white px-4 py-4 shadow-lg shadow-slate-950/10">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{item.label}</p>
                  <p className="mt-3 text-3xl font-bold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.helper}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_0.95fr_1.1fr]">
          <MiniDonutChart title="Student attendance today" breakdown={detail.student_attendance_today || { total: 0, present_count: 0, late_count: 0, absent_count: 0, leave_count: 0 }} tone="blue" />
          <MiniDonutChart title="Staff attendance today" breakdown={detail.staff_attendance_today || { total: 0, present_count: 0, late_count: 0, absent_count: 0, leave_count: 0 }} tone="emerald" />
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Section command signals</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <SignalTile label="Late students" value={selectedSection.late_today || 0} tone="amber" />
              <SignalTile label="Absent students" value={selectedSection.absent_today || 0} tone="rose" />
              <SignalTile label="Discipline open" value={(detail.late_absent_students || []).length} tone="violet" />
              <SignalTile label="Upcoming events" value={(detail.upcoming_events || []).length} tone="blue" />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${activeTab === tab.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "overview" ? <OverviewTab detail={detail} selectedSection={selectedSection} /> : null}
        {activeTab === "classes" ? <ClassesTab detail={detail} /> : null}
        {activeTab === "staff" ? <StaffTab detail={detail} /> : null}
        {activeTab === "results" ? <ResultsTab detail={detail} selectedSection={selectedSection} /> : null}
        {activeTab === "timetable" ? (
          <TimetableTab
            detail={detail}
            selectedClassroomId={selectedClassroomId}
            onSelectClassroom={setSelectedClassroomId}
            board={timetableBoard}
            loading={timetableLoading}
          />
        ) : null}
        {activeTab === "admissions" ? <AdmissionsTab detail={detail} selectedSection={selectedSection} /> : null}
        {activeTab === "discipline" ? <DisciplineTab detail={detail} /> : null}
      </div>
    </>
  );
}

function OverviewTab({ detail, selectedSection }: { detail: SectionDashboardDetail; selectedSection: NonNullable<SectionDashboardDetail["section"]> }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MetricCard title="Parent access" value={formatNumber(detail.parent_access_summary?.linked_parents || 0)} subtitle={`${formatNumber(detail.parent_access_summary?.active_students || 0)} active students linked to guardians`} />
          <MetricCard title="Discipline follow-up" value={formatNumber(detail.late_absent_students.length || 0)} subtitle={`${formatNumber((detail.announcements || []).length)} announcements • ${formatNumber((detail.upcoming_events || []).length)} upcoming events`} />
          <MetricCard title="Admissions in pipeline" value={formatNumber((detail.admissions_summary?.inquiry_count || 0) + (detail.admissions_summary?.under_review_count || 0) + (detail.admissions_summary?.accepted_count || 0) + (detail.admissions_summary?.waitlisted_count || 0))} subtitle="Inquiry, review, accepted, and waitlisted combined" />
          <MetricCard title="Movements & withdrawals" value={formatNumber(detail.movement_summary?.inactive_enrollments || 0)} subtitle={`${formatNumber(detail.movement_summary?.withdrawn_students || 0)} withdrawn • ${formatNumber(detail.movement_summary?.transferred_students || 0)} transferred`} />
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">All classes in this section</h3>
              <p className="text-sm text-slate-500">Class strength, homeroom, and today’s attendance status.</p>
            </div>
            <Link href="/dashboard/class-teacher" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">Open class teacher view</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {detail.class_attendance.map((row) => (
              <div key={row.classroom_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{row.classroom_label}</p>
                    <p className="text-xs text-slate-500">{row.classroom_code || "No code"} • Room {row.room_number || "TBA"}</p>
                    <p className="mt-1 text-xs text-slate-500">Homeroom: {row.homeroom_teacher_name || "Unassigned"}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{row.attendance_rate.toFixed(0)}%</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                  <span>{formatNumber(row.active_students || 0)} students</span>
                  <span>{formatNumber(row.present_count)} present</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Section staff and managers</h3>
          <p className="text-sm text-slate-500">HM, coordinators, teachers, and support staff assigned to this section.</p>
          <div className="mt-4 space-y-3">
            {(detail.staff_profiles || []).map((staff) => (
              <div key={staff.staff_profile_id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{[staff.first_name, staff.last_name].filter(Boolean).join(" ")}</p>
                  <p className="text-xs text-slate-500">{staff.designation || staff.staff_type} • {staff.department || "Section operations"}</p>
                </div>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold capitalize text-white">{staff.attendance_status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Late & absent today</h3>
          <p className="text-sm text-slate-500">Students who need same-day follow-up or parent contact.</p>
          <div className="mt-4 space-y-2">
            {detail.late_absent_students.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No late or absent students in this section today.
              </div>
            ) : (
              detail.late_absent_students.map((row) => (
                <div key={row.attendance_record_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{row.first_name} {row.last_name}</p>
                      <p className="text-xs text-slate-500">{row.classroom_label} • {row.student_code}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.status === "absent" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{row.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ClassesTab({ detail }: { detail: SectionDashboardDetail }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Attendance record of all classes</h3>
          <p className="text-sm text-slate-500">Daily attendance, homeroom ownership, and class strength across this section.</p>
        </div>
        <Link href="/dashboard/attendance" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">Open attendance module</Link>
      </div>
      <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.22em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Homeroom</th>
              <th className="px-4 py-3">Students</th>
              <th className="px-4 py-3">Present</th>
              <th className="px-4 py-3">Late</th>
              <th className="px-4 py-3">Absent</th>
              <th className="px-4 py-3">Leave</th>
              <th className="px-4 py-3">Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {detail.class_attendance.map((row) => (
              <tr key={row.classroom_id}>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.classroom_label}</td>
                <td className="px-4 py-3 text-slate-600">{row.homeroom_teacher_name || "Unassigned"}</td>
                <td className="px-4 py-3 text-slate-600">{formatNumber(row.active_students || 0)}</td>
                <td className="px-4 py-3 text-slate-600">{formatNumber(row.present_count)}</td>
                <td className="px-4 py-3 text-slate-600">{formatNumber(row.late_count)}</td>
                <td className="px-4 py-3 text-slate-600">{formatNumber(row.absent_count)}</td>
                <td className="px-4 py-3 text-slate-600">{formatNumber(row.leave_count)}</td>
                <td className="px-4 py-3 font-semibold text-emerald-700">{row.attendance_rate.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaffTab({ detail }: { detail: SectionDashboardDetail }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Staff attendance records</h3>
        <p className="text-sm text-slate-500">Present, late, absent, and leave coverage for section staff today.</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <SignalTile label="Present" value={detail.staff_attendance_today?.present_count || 0} tone="emerald" />
          <SignalTile label="Late" value={detail.staff_attendance_today?.late_count || 0} tone="amber" />
          <SignalTile label="Absent" value={detail.staff_attendance_today?.absent_count || 0} tone="rose" />
          <SignalTile label="Leave" value={detail.staff_attendance_today?.leave_count || 0} tone="blue" />
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Staff roster and profiles</h3>
        <p className="text-sm text-slate-500">Profiles, designations, and live attendance status for every section staff member.</p>
        <div className="mt-4 space-y-3">
          {(detail.staff_profiles || []).map((staff) => (
            <div key={staff.staff_profile_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{[staff.first_name, staff.last_name].filter(Boolean).join(" ")}</p>
                  <p className="text-xs text-slate-500">{staff.staff_code} • {staff.designation || staff.staff_type} • {staff.department || "Section operations"}</p>
                  <p className="mt-1 text-xs text-slate-500">{staff.email}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold capitalize text-white">{staff.attendance_status}</span>
                  <p className="mt-2">In: {staff.check_in_at ? new Date(staff.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                  <p>Out: {staff.check_out_at ? new Date(staff.check_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResultsTab({ detail, selectedSection }: { detail: SectionDashboardDetail; selectedSection: NonNullable<SectionDashboardDetail["section"]> }) {
  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <MetricCard title="Monthly / term progress" value={formatNumber((detail.result_progress_by_term || []).length)} subtitle="Assessment windows linked to this section" />
        <MetricCard title="Report cards published" value={formatNumber((detail.result_progress_by_term || []).reduce((sum, row) => sum + row.published_report_cards, 0))} subtitle="Published cards across monthly, midterm, and final terms" />
        <MetricCard title="Section average" value={`${selectedSection.active_students ? ((detail.result_progress_by_term || []).reduce((sum, row) => sum + row.average_percentage, 0) / Math.max((detail.result_progress_by_term || []).length, 1)).toFixed(1) : "0.0"}%`} subtitle="Average published performance across recent terms" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {(detail.result_progress_by_term || []).map((term) => (
          <ProgressStripe
            key={term.exam_term_id}
            label={`${term.term_name} • ${term.term_type}`}
            value={term.published_report_cards}
            total={term.total_report_cards || selectedSection.active_students || 0}
            hint={`Average ${term.average_percentage.toFixed(1)}% • ${term.draft_report_cards} draft cards`}
            colorClass="from-emerald-500 via-cyan-500 to-blue-500"
          />
        ))}
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Result status and report cards</h3>
            <p className="text-sm text-slate-500">Track monthly, midterm, final term, and report-card completion per section.</p>
          </div>
          <Link href="/dashboard/class-teacher/report-cards" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">Open report cards</Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.22em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3">Draft</th>
                <th className="px-4 py-3">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {(detail.result_progress_by_term || []).map((term) => (
                <tr key={term.exam_term_id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{term.term_name}</td>
                  <td className="px-4 py-3 text-slate-600">{term.starts_on || term.ends_on ? `${term.starts_on || "—"} to ${term.ends_on || "—"}` : "Open window"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatNumber(term.published_report_cards)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatNumber(term.draft_report_cards)}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{term.average_percentage.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TimetableTab({
  detail,
  selectedClassroomId,
  onSelectClassroom,
  board,
  loading,
}: {
  detail: SectionDashboardDetail;
  selectedClassroomId: string;
  onSelectClassroom: (value: string) => void;
  board: ClassroomWeeklyTimetableBoardPayload | null;
  loading: boolean;
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Section timetable</h3>
            <p className="text-sm text-slate-500">Choose any class in your section to review the live weekly timetable shared by the class teacher.</p>
          </div>
          <div className="min-w-[280px]">
            <label className="label-text">Select class</label>
            <select className="input-field mt-2" value={selectedClassroomId} onChange={(e) => onSelectClassroom(e.target.value)}>
              {detail.class_attendance.map((row) => (
                <option key={row.classroom_id} value={row.classroom_id}>
                  {row.classroom_label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-96 animate-pulse rounded-2xl bg-slate-100" />
        </section>
      ) : board ? (
        <ClassroomWeeklyTimetableBoard
          board={board}
          title="Section timetable view"
          subtitle="This is the shared board for HM review. Teachers edit it in the class teacher workspace and students see the same weekly view."
        />
      ) : (
        <section className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          No timetable board is available for this classroom yet.
        </section>
      )}
    </section>
  );
}

function AdmissionsTab({
  detail,
  selectedSection,
}: {
  detail: SectionDashboardDetail;
  selectedSection: NonNullable<SectionDashboardDetail["section"]>;
}) {
  const summary = detail.admissions_summary;
  const pipelineHref = `/dashboard/admissions/pipeline?section_id=${encodeURIComponent(selectedSection.section_id)}`;
  return (
    <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <SignalTile label="Inquiry" value={summary?.inquiry_count || 0} tone="blue" />
          <SignalTile label="Applied" value={summary?.applied_count || 0} tone="violet" />
          <SignalTile label="Under review" value={summary?.under_review_count || 0} tone="amber" />
          <SignalTile label="Accepted" value={summary?.accepted_count || 0} tone="emerald" />
          <SignalTile label="Waitlisted" value={summary?.waitlisted_count || 0} tone="slate" />
          <SignalTile label="Rejected" value={summary?.rejected_count || 0} tone="rose" />
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Withdrawals, transfers, promotions</h3>
          <p className="text-sm text-slate-500">Student change records captured from enrollment status transitions.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricCard title="Inactive enrollments" value={formatNumber(detail.movement_summary?.inactive_enrollments || 0)} subtitle="Not currently active in this section" compact />
            <MetricCard title="Withdrawn" value={formatNumber(detail.movement_summary?.withdrawn_students || 0)} subtitle="Students withdrawn from the section" compact />
            <MetricCard title="Transferred" value={formatNumber(detail.movement_summary?.transferred_students || 0)} subtitle="Transfers or section changes" compact />
            <MetricCard title="Promoted" value={formatNumber(detail.movement_summary?.promoted_students || 0)} subtitle="Promotion events recorded in enrollment state" compact />
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Connected section workflow</h3>
          <p className="text-sm text-slate-500">
            Open the admissions pipeline already filtered for {selectedSection.section_name}, so your HM team only sees applicants linked to this section.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={pipelineHref} className="inline-flex rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Open section pipeline
            </Link>
            <Link href="/dashboard/admissions" className="inline-flex rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Admissions command center
            </Link>
          </div>
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Admissions and withdrawals tab</h3>
            <p className="text-sm text-slate-500">Recent applicants linked to this section, ready for front desk or principal follow-up.</p>
          </div>
          <Link href={pipelineHref} className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">Open section pipeline</Link>
        </div>
        <div className="mt-4 space-y-3">
          {(detail.admission_records || []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              No admission records are linked to this section yet.
            </div>
          ) : (
            (detail.admission_records || []).map((record) => (
              <div key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{record.student_name}</p>
                    <p className="text-xs text-slate-500">{record.student_code} • Guardian: {record.guardian_name || "Not set"}</p>
                    <p className="mt-1 text-xs text-slate-500">Desired class: {record.desired_grade_label || "—"} / {record.desired_section_label || "—"}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold capitalize text-white">{record.current_status.replaceAll("_", " ")}</span>
                    <p className="mt-2 text-xs text-slate-500">{new Date(record.created_at).toLocaleDateString("en-GB")}</p>
                    <Link href={`/dashboard/admissions/applicants/${record.student_id}`} className="mt-2 inline-block text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                      Open record
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function DisciplineTab({ detail }: { detail: SectionDashboardDetail }) {
  const disciplineOpen = detail.late_absent_students.length;
  const admissionsOpen =
    (detail.admissions_summary?.inquiry_count || 0) +
    (detail.admissions_summary?.under_review_count || 0) +
    (detail.admissions_summary?.accepted_count || 0) +
    (detail.admissions_summary?.waitlisted_count || 0);

  return (
    <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Discipline and escalation</h3>
          <p className="text-sm text-slate-500">Use this section panel to keep discipline pressure visible.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <SignalTile label="Late/absent follow-up" value={disciplineOpen} tone="amber" />
            <SignalTile label="Announcements" value={(detail.announcements || []).length} tone="blue" />
            <SignalTile label="Upcoming events" value={(detail.upcoming_events || []).length} tone="emerald" />
            <SignalTile label="Parent-linked students" value={detail.parent_access_summary?.linked_parents || 0} tone="violet" />
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Section workflow signals</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <SignalTile label="Admissions open" value={admissionsOpen} tone="blue" />
            <SignalTile label="Withdrawals" value={detail.movement_summary?.withdrawn_students || 0} tone="rose" />
            <SignalTile label="Transfers" value={detail.movement_summary?.transferred_students || 0} tone="violet" />
            <SignalTile label="Inactive enrollments" value={detail.movement_summary?.inactive_enrollments || 0} tone="amber" />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Announcements and events</h3>
          <div className="mt-4 space-y-3">
            {[...(detail.announcements || []), ...(detail.upcoming_events || [])].slice(0, 6).map((item) => (
              <div key={`${item.id}-${item.title}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="font-semibold text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500">{item.classroom_label || "Section-wide"} • {item.event_type.replaceAll("_", " ")}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ title, value, subtitle, compact = false }: { title: string; value: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${compact ? "p-4" : "p-5"}`}>
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function SignalTile({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "rose" | "emerald" | "violet" | "slate" }) {
  const tones = {
    blue: "bg-blue-100 text-blue-800",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-800",
    emerald: "bg-emerald-100 text-emerald-800",
    violet: "bg-violet-100 text-violet-800",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{value}</span>
    </div>
  );
}
