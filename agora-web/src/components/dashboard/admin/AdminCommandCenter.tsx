"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  getAdmissionsPipeline,
  getEvents,
  getExecutiveOverview,
  getFeesFinanceSummary,
  getHrDashboardSummary,
  getInstitutionProfile,
  getInstitutionSections,
  getLookupAcademicYears,
  getNotifications,
  getPrincipalDashboard,
  type AdmissionPipelineData,
  type ExecutiveOverviewRecord,
  type FeesFinanceSummaryRecord,
  type HrDashboardSummary,
  type InstitutionProfile,
  type InstitutionSection,
  type PrincipalDashboardData,
} from "@/lib/api";

interface AdminCommandCenterProps {
  firstName?: string;
}

interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  event_type: string;
}

interface NotificationRow {
  id: string;
  title: string;
  status: string;
}

interface AcademicYearOption {
  id: string;
  name: string;
  is_current: boolean;
  label: string;
}

type DashboardDatePreset = "this_week" | "this_month" | "this_term" | "custom";

interface DashboardFilters {
  preset: DashboardDatePreset;
  date_from: string;
  date_to: string;
  academic_year_id: string;
}

interface ChartPoint {
  label: string;
  value: number;
}

function money(value: number) {
  return `Rs ${Math.round(value || 0).toLocaleString()}`;
}

function percent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function shortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function weekLabel(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function toStageRows(pipeline?: AdmissionPipelineData | null) {
  if (!pipeline?.stages) return [];
  return Object.entries(pipeline.stages).map(([stage, data]) => ({
    stage,
    count: Number((data as { count?: number })?.count || 0),
  }));
}

function toInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeFromPreset(preset: DashboardDatePreset) {
  const today = new Date();
  const start = new Date(today);
  if (preset === "this_week") {
    start.setDate(today.getDate() - 6);
  } else if (preset === "this_month") {
    start.setDate(1);
  } else if (preset === "this_term") {
    start.setDate(today.getDate() - 84);
  }
  return {
    date_from: toInputDate(start),
    date_to: toInputDate(today),
  };
}

function createDefaultFilters(): DashboardFilters {
  return {
    preset: "this_term",
    ...rangeFromPreset("this_term"),
    academic_year_id: "",
  };
}

function buildDashboardQuery(filters: DashboardFilters) {
  const query = new URLSearchParams();
  if (filters.date_from) query.set("date_from", filters.date_from);
  if (filters.date_to) query.set("date_to", filters.date_to);
  if (filters.academic_year_id) query.set("academic_year_id", filters.academic_year_id);
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export default function AdminCommandCenter({ firstName }: AdminCommandCenterProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(() => createDefaultFilters());
  const [filters, setFilters] = useState<DashboardFilters>(() => createDefaultFilters());
  const [profile, setProfile] = useState<InstitutionProfile | null>(null);
  const [sections, setSections] = useState<InstitutionSection[]>([]);
  const [principalDashboard, setPrincipalDashboard] = useState<PrincipalDashboardData | null>(null);
  const [executive, setExecutive] = useState<ExecutiveOverviewRecord | null>(null);
  const [pipeline, setPipeline] = useState<AdmissionPipelineData | null>(null);
  const [hrSummary, setHrSummary] = useState<HrDashboardSummary | null>(null);
  const [finance, setFinance] = useState<FeesFinanceSummaryRecord | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadAcademicYears() {
      const rows = await getLookupAcademicYears({ page_size: 50 }).catch(() => []);
      if (cancelled || !Array.isArray(rows)) return;
      setAcademicYears(rows);
      const defaultYearId = rows.find((year) => year.is_current)?.id || "";
      if (defaultYearId) {
        setDraftFilters((prev) => (prev.academic_year_id ? prev : { ...prev, academic_year_id: defaultYearId }));
        setFilters((prev) => (prev.academic_year_id ? prev : { ...prev, academic_year_id: defaultYearId }));
      }
    }
    loadAcademicYears();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      const dateFrom = filters.date_from;
      const dateTo = filters.date_to;
      const academicYearId = filters.academic_year_id || undefined;
      const monthScope = (dateTo || "").slice(0, 7);

      const [
        profileRes,
        sectionsRes,
        principalRes,
        executiveRes,
        pipelineRes,
        hrRes,
        financeRes,
        eventsRes,
        notificationsRes,
      ] = await Promise.allSettled([
        getInstitutionProfile(),
        getInstitutionSections({ page_size: "100", is_active: "true" }),
        getPrincipalDashboard(),
        getExecutiveOverview({
          date_from: dateFrom,
          date_to: dateTo,
          ...(academicYearId ? { academic_year_id: academicYearId } : {}),
          trend_points: "10",
        }),
        getAdmissionsPipeline({
          limit_per_stage: 50,
          date_from: dateFrom,
          date_to: dateTo,
          ...(academicYearId ? { academic_year_id: academicYearId } : {}),
        }),
        getHrDashboardSummary(monthScope ? { month: monthScope } : {}),
        getFeesFinanceSummary({
          date_from: dateFrom,
          date_to: dateTo,
          ...(academicYearId ? { academic_year_id: academicYearId } : {}),
        }),
        getEvents({
          date_from: `${dateFrom}T00:00:00.000Z`,
          page_size: "8",
          page: "1",
        }),
        getNotifications({
          page_size: "20",
          page: "1",
        }),
      ]);

      if (cancelled) return;

      if (profileRes.status === "fulfilled") setProfile(profileRes.value);
      if (sectionsRes.status === "fulfilled") setSections((sectionsRes.value.data as InstitutionSection[]) || []);
      if (principalRes.status === "fulfilled") setPrincipalDashboard((principalRes.value.data as PrincipalDashboardData) || null);
      if (executiveRes.status === "fulfilled") setExecutive((executiveRes.value.data as ExecutiveOverviewRecord) || null);
      if (pipelineRes.status === "fulfilled") setPipeline((pipelineRes.value.data as AdmissionPipelineData) || null);
      if (hrRes.status === "fulfilled") setHrSummary(hrRes.value || null);
      if (financeRes.status === "fulfilled") setFinance((financeRes.value.data as FeesFinanceSummaryRecord) || null);
      if (eventsRes.status === "fulfilled") setEvents(((eventsRes.value.data as EventRow[]) || []).slice(0, 6));
      if (notificationsRes.status === "fulfilled") {
        const rows = (notificationsRes.value.data as NotificationRow[]) || [];
        setUnreadNotifications(rows.filter((row) => String(row.status || "").toLowerCase() !== "read").length);
      }

      if (
        profileRes.status !== "fulfilled" &&
        principalRes.status !== "fulfilled" &&
        executiveRes.status !== "fulfilled" &&
        pipelineRes.status !== "fulfilled"
      ) {
        setError("Unable to load school command center right now.");
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  function applyFilters() {
    if (draftFilters.date_from && draftFilters.date_to && draftFilters.date_from > draftFilters.date_to) {
      setError("Filter date range is invalid. Date from must be before date to.");
      return;
    }
    setError("");
    setFilters({ ...draftFilters });
  }

  function resetFilters() {
    const base = createDefaultFilters();
    const defaultYearId = academicYears.find((year) => year.is_current)?.id || "";
    const next = {
      ...base,
      academic_year_id: defaultYearId,
    };
    setError("");
    setDraftFilters(next);
    setFilters(next);
  }

  const stageRows = useMemo(() => toStageRows(pipeline), [pipeline]);
  const stageTotal = useMemo(
    () => stageRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    [stageRows]
  );

  const hmCount = useMemo(() => {
    const unique = new Set<string>();
    for (const section of sections) {
      const id = section.head_user_id || section.coordinator_user_id;
      if (id) unique.add(id);
    }
    return unique.size;
  }, [sections]);

  const payrollCost = Number(hrSummary?.current_month_net_payroll || 0);
  const incomeCollected = Number(finance?.totals?.total_paid || 0);
  const netCash = incomeCollected - payrollCost;

  const staffAttendance = hrSummary?.staff_attendance_today || {
    total_active_staff: 0,
    marked_staff: 0,
    unmarked_staff: 0,
    present_count: 0,
    late_count: 0,
    absent_count: 0,
    leave_count: 0,
  };

  const attendanceToday = principalDashboard?.attendance_today || {
    total: 0,
    present_count: 0,
    late_count: 0,
    absent_count: 0,
    leave_count: 0,
  };

  const studentPresentRate =
    Number(attendanceToday.total || 0) > 0
      ? ((Number(attendanceToday.present_count || 0) / Number(attendanceToday.total || 1)) * 100)
      : 0;

  const conversionRate = Number((pipeline?.summary?.conversion_rate || 0) * 100);
  const totalCriticalAlerts = (executive?.alerts || []).filter((alert) => alert.severity === "critical").length;
  const dashboardQuery = useMemo(() => buildDashboardQuery(filters), [filters]);

  const attendanceSeries: ChartPoint[] = useMemo(
    () =>
      (executive?.attendance_trend || []).slice(-10).map((row) => ({
        label: weekLabel(row.period_start),
        value: Number(row.present_rate || 0),
      })),
    [executive]
  );

  const financeSeries: ChartPoint[] = useMemo(
    () => [
      { label: "Collected", value: Number(incomeCollected || 0) },
      { label: "Payroll", value: Number(payrollCost || 0) },
      { label: "Overdue", value: Number(finance?.totals?.overdue_amount || 0) },
      { label: "Net", value: Number(netCash || 0) },
    ],
    [finance?.totals?.overdue_amount, incomeCollected, netCash, payrollCost]
  );

  const staffMix: ChartPoint[] = useMemo(
    () => [
      { label: "Present", value: Number(staffAttendance.present_count || 0) },
      { label: "Late", value: Number(staffAttendance.late_count || 0) },
      { label: "Absent", value: Number(staffAttendance.absent_count || 0) },
      { label: "Leave", value: Number(staffAttendance.leave_count || 0) },
    ],
    [staffAttendance.absent_count, staffAttendance.late_count, staffAttendance.leave_count, staffAttendance.present_count]
  );

  const sectionEnrollmentSeries: ChartPoint[] = useMemo(
    () =>
      [...sections]
        .sort((a, b) => Number(b.active_students || 0) - Number(a.active_students || 0))
        .slice(0, 6)
        .map((section) => ({
          label: section.code || section.name,
          value: Number(section.active_students || 0),
        })),
    [sections]
  );

  const admissionsDistribution: ChartPoint[] = useMemo(
    () => stageRows.filter((row) => row.count > 0).map((row) => ({ label: row.stage.replaceAll("_", " "), value: row.count })),
    [stageRows]
  );

  const sectionHistogramSeries: ChartPoint[] = useMemo(() => {
    const bins = [
      { label: "1-40", min: 1, max: 40, value: 0 },
      { label: "41-80", min: 41, max: 80, value: 0 },
      { label: "81-120", min: 81, max: 120, value: 0 },
      { label: "121+", min: 121, max: Number.POSITIVE_INFINITY, value: 0 },
    ];

    sections.forEach((section) => {
      const students = Number(section.active_students || 0);
      const bin = bins.find((candidate) => students >= candidate.min && students <= candidate.max);
      if (bin) bin.value += 1;
    });

    return bins;
  }, [sections]);

  const unassignedSections = Math.max(0, sections.length - hmCount);
  const leadershipCoverageRate = sections.length > 0 ? (hmCount / sections.length) * 100 : 0;
  const payrollCoverageRate =
    Number(staffAttendance.total_active_staff || 0) > 0
      ? (Number(staffAttendance.marked_staff || 0) / Number(staffAttendance.total_active_staff || 1)) * 100
      : 0;

  const operationsQueue = useMemo(
    () => [
      {
        label: "Open payroll periods",
        value: Number(hrSummary?.open_payroll_periods || 0),
        hint: "Payroll cycles awaiting closure or processing.",
        href: `/dashboard/hr/payroll${dashboardQuery}`,
        tone: "amber" as const,
      },
      {
        label: "Pending HR adjustments",
        value: Number(hrSummary?.pending_adjustments || 0),
        hint: "Salary revisions, deductions, or bonus approvals pending.",
        href: `/dashboard/hr${dashboardQuery}`,
        tone: "violet" as const,
      },
      {
        label: "Leave requests pending",
        value: Number(hrSummary?.pending_leave_requests || 0),
        hint: "Staff leave decisions still waiting for review.",
        href: `/dashboard/hr${dashboardQuery}`,
        tone: "blue" as const,
      },
      {
        label: "Fee defaulters",
        value: Number(finance?.totals?.defaulter_students || 0),
        hint: "Students requiring finance follow-up and reminders.",
        href: `/dashboard/fees${dashboardQuery}`,
        tone: Number(finance?.totals?.defaulter_students || 0) > 0 ? ("rose" as const) : ("emerald" as const),
      },
      {
        label: "Unread notifications",
        value: unreadNotifications,
        hint: "School-wide notifications still not reviewed.",
        href: "/dashboard/notifications",
        tone: unreadNotifications > 0 ? ("teal" as const) : ("emerald" as const),
      },
      {
        label: "Admissions under review",
        value: Number(pipeline?.stages?.under_review?.count || 0),
        hint: "Applicants waiting for the next admissions action.",
        href: `/dashboard/admissions/pipeline${dashboardQuery}`,
        tone: "teal" as const,
      },
    ],
    [
      dashboardQuery,
      finance?.totals?.defaulter_students,
      hrSummary?.open_payroll_periods,
      hrSummary?.pending_adjustments,
      hrSummary?.pending_leave_requests,
      pipeline?.stages?.under_review?.count,
      unreadNotifications,
    ]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] bg-gradient-to-r from-[#5b1634] via-[#6d1f58] to-[#4f46e5] p-6 text-white shadow-[0_24px_60px_rgba(91,22,52,0.24)]">
        <p className="text-xs uppercase tracking-[0.25em] text-white/80">Admin Command Center</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-3xl font-bold">Welcome back, {firstName || "Admin"}!</h2>
            <p className="mt-1 text-sm text-white/[0.85]">
              Full-school operational snapshot: admissions, academics, staffing, finance, and leadership signals.
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.15] px-4 py-2 text-sm">
            <p>School: {profile?.name || "—"}</p>
            <p>Branch: {profile?.branch_name || "Main Campus"}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Date Preset</label>
            <select
              className="mt-1 input-field"
              value={draftFilters.preset}
              onChange={(event) => {
                const preset = event.target.value as DashboardDatePreset;
                setDraftFilters((prev) => ({
                  ...prev,
                  preset,
                  ...(preset === "custom" ? {} : rangeFromPreset(preset)),
                }));
              }}
            >
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="this_term">This Term</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="min-w-[170px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Date From</label>
            <input
              className="mt-1 input-field"
              type="date"
              value={draftFilters.date_from}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  preset: "custom",
                  date_from: event.target.value,
                }))
              }
            />
          </div>
          <div className="min-w-[170px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Date To</label>
            <input
              className="mt-1 input-field"
              type="date"
              value={draftFilters.date_to}
              onChange={(event) =>
                setDraftFilters((prev) => ({
                  ...prev,
                  preset: "custom",
                  date_to: event.target.value,
                }))
              }
            />
          </div>
          <div className="min-w-[230px]">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Academic Year</label>
            <select
              className="mt-1 input-field"
              value={draftFilters.academic_year_id}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, academic_year_id: event.target.value }))}
            >
              <option value="">All Academic Years</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label || year.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              onClick={applyFilters}
            >
              Apply Filters
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={resetFilters}
            >
              Reset
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Showing school operations from <span className="font-semibold text-gray-700">{filters.date_from || "—"}</span> to{" "}
          <span className="font-semibold text-gray-700">{filters.date_to || "—"}</span>
          {filters.academic_year_id
            ? ` • ${academicYears.find((year) => year.id === filters.academic_year_id)?.label || "Selected Year"}`
            : " • All academic years"}
        </p>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SnapshotTile
          label="Students Today"
          value={`${attendanceToday.present_count}/${attendanceToday.total || 0}`}
          hint={`Absent ${attendanceToday.absent_count}`}
          href={`/dashboard/attendance${dashboardQuery}`}
          tone="emerald"
        />
        <SnapshotTile
          label="Staff Today"
          value={`${staffAttendance.present_count + staffAttendance.late_count}/${staffAttendance.total_active_staff || 0}`}
          hint={`Absent ${staffAttendance.absent_count}`}
          href={`/dashboard/hr${dashboardQuery}`}
          tone="blue"
        />
        <SnapshotTile
          label="Admissions"
          value={pipeline?.summary?.total_active || 0}
          hint={`Conversion ${conversionRate.toFixed(1)}%`}
          href={`/dashboard/admissions/pipeline${dashboardQuery}`}
          tone="violet"
        />
        <SnapshotTile
          label="Finance Net"
          value={money(netCash)}
          hint={`Collected ${money(incomeCollected)}`}
          href={`/dashboard/fees${dashboardQuery}`}
          tone={netCash >= 0 ? "teal" : "rose"}
        />
        <SnapshotTile
          label="Critical Alerts"
          value={totalCriticalAlerts}
          hint={totalCriticalAlerts > 0 ? "Needs action" : "All clear"}
          href={`/dashboard/reports${dashboardQuery}`}
          tone={totalCriticalAlerts > 0 ? "rose" : "amber"}
        />
      </section>

      <section className="overflow-hidden rounded-[28px] border border-[#ead6de] bg-[linear-gradient(180deg,#fff8fb_0%,#ffffff_100%)] p-6 shadow-[0_22px_55px_rgba(76,29,149,0.08)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-[#8a4760]">Analytics Studio</p>
            <h3 className="mt-2 text-2xl font-bold text-slate-950">School activity in graphs</h3>
            <p className="mt-1 text-sm text-slate-500">Line, bar, donut, and histogram views for daily leadership decisions.</p>
          </div>
          <Link href={`/dashboard/reports${dashboardQuery}`} className="rounded-full border border-[#d7c0ca] bg-white px-4 py-2 text-sm font-semibold text-[#7a2948] transition hover:border-[#b86a8a] hover:text-[#661d3a]">
            Open executive reports
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="rounded-3xl border border-[#eee2e7] bg-white p-5 shadow-sm">
            <LineTrendChart
              title="Student Present %"
              subtitle="Weekly attendance line"
              points={attendanceSeries}
              strokeClass="stroke-violet-600"
              fillClass="fill-violet-50"
              dotClass="fill-violet-600"
            />
          </div>
          <div className="rounded-3xl border border-[#eee2e7] bg-white p-5 shadow-sm">
            <DonutBreakdownChart title="Admissions Stage Mix" subtitle="Share of applicants by current stage" points={admissionsDistribution} emptyMessage="No active admissions stages yet." />
          </div>
          <div className="rounded-3xl border border-[#eee2e7] bg-white p-5 shadow-sm">
            <div className="mb-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Finance bars</p>
              <p className="text-sm text-gray-500">Collected, payroll, overdue, and net position.</p>
            </div>
            <BarMixChart
              points={financeSeries}
              currency
              toneByLabel={{
                Collected: "bg-emerald-500",
                Payroll: "bg-amber-500",
                Overdue: "bg-rose-500",
                Net: netCash >= 0 ? "bg-violet-600" : "bg-red-600",
              }}
            />
          </div>
          <div className="rounded-3xl border border-[#eee2e7] bg-white p-5 shadow-sm">
            <HistogramChart title="Section Size Histogram" subtitle="How many sections fall into each student-load band" points={sectionHistogramSeries} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Leadership Coverage"
          value={percent(leadershipCoverageRate)}
          hint={`${hmCount}/${sections.length || 0} sections covered • ${unassignedSections} unassigned`}
          tone={unassignedSections > 0 ? "amber" : "emerald"}
          loading={loading}
          href="/dashboard/institution"
        />
        <MetricCard
          title="Staff Marking Coverage"
          value={percent(payrollCoverageRate)}
          hint={`${staffAttendance.marked_staff} marked • ${staffAttendance.unmarked_staff} pending`}
          tone={staffAttendance.unmarked_staff > 0 ? "amber" : "blue"}
          loading={loading}
          href={`/dashboard/hr${dashboardQuery}`}
        />
        <MetricCard
          title="Average Students / Section"
          value={sections.length ? Math.round(Number(profile?.active_students || 0) / sections.length) : 0}
          hint={`${sections.length} active sections in command center scope`}
          tone="violet"
          loading={loading}
          href="/dashboard/institution"
        />
        <MetricCard
          title="Revenue vs Payroll"
          value={payrollCost > 0 ? `${((incomeCollected / payrollCost) * 100).toFixed(0)}%` : "—"}
          hint={payrollCost > 0 ? "Collected income against current payroll load" : "Payroll not available yet"}
          tone={incomeCollected >= payrollCost ? "teal" : "rose"}
          loading={loading}
          href={`/dashboard/fees${dashboardQuery}`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Active Students" value={profile?.active_students ?? 0} hint="Current enrolled student base" tone="emerald" loading={loading} href={`/dashboard/people${dashboardQuery}`} />
        <MetricCard title="Staff Present Today" value={staffAttendance.present_count + staffAttendance.late_count} hint={`Absent ${staffAttendance.absent_count} • Unmarked ${staffAttendance.unmarked_staff}`} tone="blue" loading={loading} href={`/dashboard/hr${dashboardQuery}`} />
        <MetricCard title="Admissions In Funnel" value={pipeline?.summary?.total_active ?? 0} hint={`Conversion ${conversionRate.toFixed(1)}%`} tone="violet" loading={loading} href={`/dashboard/admissions/pipeline${dashboardQuery}`} />
        <MetricCard title="Income Collected" value={money(incomeCollected)} hint={`Overdue ${money(Number(finance?.totals?.overdue_amount || 0))}`} tone="teal" loading={loading} href={`/dashboard/fees${dashboardQuery}`} />
        <MetricCard title="Payroll Expense (Month)" value={money(payrollCost)} hint={`Open payroll periods ${hrSummary?.open_payroll_periods ?? 0}`} tone="amber" loading={loading} href={`/dashboard/hr/payroll${dashboardQuery}`} />
        <MetricCard title="Net Position" value={money(netCash)} hint={netCash >= 0 ? "Positive cash position" : "Expense exceeds collected income"} tone={netCash >= 0 ? "emerald" : "rose"} loading={loading} href={`/dashboard/reports${dashboardQuery}`} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="card xl:col-span-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Student Attendance Trend (Weekly)</h3>
            <Link href="/dashboard/reports" className="text-sm font-medium text-primary-600 hover:underline">
              Open reports
            </Link>
          </div>
          {attendanceSeries.length ? (
            <div className="mt-4 space-y-4">
              <LineTrendChart
                title="Student Present % by Week"
                subtitle="Trend from executive attendance overview"
                points={attendanceSeries}
                strokeClass="stroke-emerald-500"
                fillClass="fill-emerald-50"
                dotClass="fill-emerald-500"
              />
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Staff Attendance Mix (Today)</p>
                <BarMixChart points={staffMix} />
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">Attendance trend will populate once records are available.</p>
          )}
        </div>

        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Admissions Progress</h3>
            <Link href="/dashboard/admissions/pipeline" className="text-sm font-medium text-primary-600 hover:underline">
              Open pipeline
            </Link>
          </div>
          {stageRows.length ? (
            <div className="mt-4 space-y-3">
              {stageRows
                .sort((a, b) => b.count - a.count)
                .slice(0, 6)
                .map((row) => {
                  const width = stageTotal > 0 ? Math.max(12, (row.count / stageTotal) * 100) : 0;
                  return (
                    <div key={row.stage}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="capitalize text-gray-700">{row.stage.replaceAll("_", " ")}</span>
                        <span className="font-semibold text-gray-900">{row.count}</span>
                      </div>
                      <div className="h-8 rounded-xl bg-indigo-50 px-2 py-1">
                        <div
                          className="h-6 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 px-2 text-xs font-semibold leading-6 text-white"
                          style={{ width: `${Math.min(100, width)}%` }}
                        >
                          {row.count > 0 ? row.count : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">No admissions pipeline activity found.</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Finance Trend Snapshot</h3>
            <Link href={`/dashboard/fees${dashboardQuery}`} className="text-sm font-medium text-primary-600 hover:underline">
              Open finance
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">Collected vs payroll and net position for selected filter window.</p>
          <div className="mt-4">
            <BarMixChart
              points={financeSeries}
              currency
              toneByLabel={{
                Collected: "bg-emerald-500",
                Payroll: "bg-amber-500",
                Overdue: "bg-rose-500",
                Net: netCash >= 0 ? "bg-cyan-600" : "bg-red-600",
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Leadership Drilldowns</h3>
            <Link href={`/dashboard/reports${dashboardQuery}`} className="text-sm font-medium text-primary-600 hover:underline">
              Open executive reports
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <DrilldownTile
              href={`/dashboard/admissions/pipeline${dashboardQuery}`}
              title="Admissions Funnel"
              subtitle="Pipeline stages and conversion"
              value={`${pipeline?.summary?.total_active || 0}`}
            />
            <DrilldownTile
              href={`/dashboard/attendance${dashboardQuery}`}
              title="Student Attendance"
              subtitle="Today + trend insights"
              value={percent(studentPresentRate)}
            />
            <DrilldownTile
              href={`/dashboard/hr${dashboardQuery}`}
              title="Staff Presence"
              subtitle="Present/late/absent coverage"
              value={`${staffAttendance.present_count + staffAttendance.late_count}`}
            />
            <DrilldownTile
              href={`/dashboard/fees${dashboardQuery}`}
              title="Fee Health"
              subtitle="Outstanding + defaulters"
              value={`${Number(finance?.totals?.defaulter_students || 0)}`}
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="card xl:col-span-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Section Enrollment Load</h3>
            <Link href="/dashboard/institution" className="text-sm font-medium text-primary-600 hover:underline">
              Open sections
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Compare student distribution across sections so leadership can spot load imbalance quickly.
          </p>
          <div className="mt-4">
            {sectionEnrollmentSeries.length ? (
              <BarMixChart
                points={sectionEnrollmentSeries}
                toneByLabel={Object.fromEntries(
                  sectionEnrollmentSeries.map((point, index) => [
                    point.label,
                    [
                      "bg-indigo-500",
                      "bg-cyan-500",
                      "bg-violet-500",
                      "bg-emerald-500",
                      "bg-amber-500",
                      "bg-rose-500",
                    ][index % 6],
                  ])
                )}
              />
            ) : (
              <p className="text-sm text-gray-500">Section enrollment data will appear after sections are configured.</p>
            )}
          </div>
        </div>

        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Operations Queue</h3>
            <Link href={`/dashboard/reports${dashboardQuery}`} className="text-sm font-medium text-primary-600 hover:underline">
              Executive filters
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Priority operational items across payroll, HR, admissions, finance, and communication.
          </p>
          <div className="mt-4 space-y-3">
            {operationsQueue.map((item) => (
              <QueueTile
                key={item.label}
                href={item.href}
                label={item.label}
                value={item.value}
                hint={item.hint}
                tone={item.tone}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Section Leadership and HM Coverage</h3>
            <Link href="/dashboard/institution" className="text-sm font-medium text-primary-600 hover:underline">
              Open institution
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">Principal: {profile?.principal_first_name ? `${profile.principal_first_name} ${profile.principal_last_name || ""}`.trim() : "Not assigned"} • HM/Coordinators assigned: {hmCount}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Head/Coordinator</th>
                  <th className="py-2 pr-3">Students</th>
                </tr>
              </thead>
              <tbody>
                {sections.length === 0 ? (
                  <tr>
                    <td className="py-4 text-gray-400" colSpan={4}>
                      No active sections found.
                    </td>
                  </tr>
                ) : (
                  sections.slice(0, 8).map((section) => (
                    <tr key={section.id} className="border-t border-gray-100">
                      <td className="py-3 pr-3 font-medium text-gray-900">{section.name}</td>
                      <td className="py-3 pr-3 text-gray-600">{section.code}</td>
                      <td className="py-3 pr-3 text-gray-600">
                        {section.head_first_name
                          ? `${section.head_first_name} ${section.head_last_name || ""}`.trim()
                          : section.coordinator_first_name
                            ? `${section.coordinator_first_name} ${section.coordinator_last_name || ""}`.trim()
                            : "Unassigned"}
                      </td>
                      <td className="py-3 pr-3 text-gray-700">{section.active_students || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900">Operational Alerts</h3>
          <div className="mt-3 space-y-3">
            {(executive?.alerts || []).slice(0, 4).map((alert, index) => (
              <div
                key={`${alert.code || alert.title || alert.message}-${index}`}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  alert.severity === "critical"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {alert.message}
              </div>
            ))}
            {staffAttendance.unmarked_staff > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {staffAttendance.unmarked_staff} staff member(s) still unmarked for today.
              </div>
            )}
            {Number(finance?.totals?.defaulter_students || 0) > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {finance?.totals?.defaulter_students} students are in fee defaulters list.
              </div>
            )}
            {(executive?.alerts || []).length === 0 &&
              staffAttendance.unmarked_staff === 0 &&
              Number(finance?.totals?.defaulter_students || 0) === 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  No critical alerts right now.
                </div>
              )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900">Student Attendance Today</h3>
          <p className="mt-3 text-sm text-gray-600">
            Present {attendanceToday.present_count} / {attendanceToday.total} ({percent(studentPresentRate)})
          </p>
          <div className="mt-3 h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, studentPresentRate))}%` }} />
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Late {attendanceToday.late_count} • Absent {attendanceToday.absent_count} • Leave {attendanceToday.leave_count}
          </p>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900">Staff Attendance Today</h3>
          <p className="mt-3 text-sm text-gray-600">
            Marked {staffAttendance.marked_staff} / {staffAttendance.total_active_staff}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">Present: {staffAttendance.present_count}</div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">Late: {staffAttendance.late_count}</div>
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">Absent: {staffAttendance.absent_count}</div>
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">Leave: {staffAttendance.leave_count}</div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900">Upcoming + Communication</h3>
          <p className="mt-3 text-sm text-gray-600">Unread notifications: {unreadNotifications}</p>
          <div className="mt-3 space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-gray-500">No upcoming events in the next window.</p>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-lg border border-gray-100 p-2">
                  <p className="text-sm font-medium text-gray-900">{event.title}</p>
                  <p className="text-xs text-gray-500">
                    {shortDate(event.starts_at)} • {event.event_type}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="text-lg font-semibold text-gray-900">Quick Admin Actions</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { href: "/dashboard/admissions/pipeline", label: "Admissions" },
            { href: "/dashboard/principal", label: "Principal View" },
            { href: "/dashboard/section", label: "HM Sections" },
            { href: "/dashboard/hr", label: "HR & Payroll" },
            { href: "/dashboard/fees", label: "Finance" },
            { href: "/dashboard/reports", label: "Executive Reports" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg border border-gray-200 px-3 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50">
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
  tone,
  loading,
  href,
}: {
  title: string;
  value: string | number;
  hint: string;
  tone: "emerald" | "blue" | "violet" | "teal" | "amber" | "rose";
  loading?: boolean;
  href?: string;
}) {
  const tones: Record<string, string> = {
    emerald: "from-emerald-500 to-emerald-600",
    blue: "from-blue-500 to-blue-600",
    violet: "from-violet-500 to-violet-600",
    teal: "from-cyan-500 to-blue-500",
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-red-500",
  };

  const content = (
    <div className="card transition hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
      {loading ? (
        <div className="mt-3 h-8 w-32 animate-pulse rounded bg-gray-200" />
      ) : (
        <p className={`mt-2 bg-gradient-to-r ${tones[tone]} bg-clip-text text-2xl font-bold text-transparent`}>{value}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );

  if (!href) return content;
  return <Link href={href}>{content}</Link>;
}

function SnapshotTile({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: "emerald" | "blue" | "violet" | "teal" | "amber" | "rose";
  href: string;
}) {
  const toneStyles: Record<string, string> = {
    emerald: "border-emerald-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.22),_transparent_28%),linear-gradient(135deg,#09372f_0%,#0e6e63_52%,#5eead4_100%)]",
    blue: "border-blue-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.22),_transparent_28%),linear-gradient(135deg,#18285f_0%,#3047a1_54%,#bfdbfe_100%)]",
    violet: "border-violet-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.20),_transparent_28%),linear-gradient(135deg,#32124c_0%,#6d28d9_52%,#f5d0fe_100%)]",
    teal: "border-cyan-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.22),_transparent_28%),linear-gradient(135deg,#0b3350_0%,#0ea5e9_56%,#cffafe_100%)]",
    amber: "border-amber-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.22),_transparent_28%),linear-gradient(135deg,#43210e_0%,#b45309_52%,#fde68a_100%)]",
    rose: "border-rose-300/30 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.2),_transparent_28%),linear-gradient(135deg,#4a1024_0%,#be185d_52%,#fecdd3_100%)]",
  };

  return (
    <Link
      href={href}
      className={`relative overflow-hidden rounded-[24px] border px-5 py-4 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(15,23,42,0.22)] ${toneStyles[tone]}`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_36%)]" />
      <div className="relative">
        <p className="text-[11px] uppercase tracking-[0.28em] text-white/[0.72]">{label}</p>
        <p className="mt-2 text-4xl font-bold leading-none text-white drop-shadow-sm">{value}</p>
        <p className="mt-3 text-sm text-white/[0.78]">{hint}</p>
      </div>
    </Link>
  );
}

function DrilldownTile({
  href,
  title,
  subtitle,
  value,
}: {
  href: string;
  title: string;
  subtitle: string;
  value: string;
}) {
  return (
    <Link href={href} className="rounded-xl border border-gray-200 p-3 transition hover:border-primary-300 hover:bg-primary-50/50">
      <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{title}</p>
      <p className="mt-1 text-lg font-bold text-primary-700">{value}</p>
      <p className="mt-1 text-xs text-gray-600">{subtitle}</p>
    </Link>
  );
}

function QueueTile({
  href,
  label,
  hint,
  value,
  tone,
}: {
  href: string;
  label: string;
  hint: string;
  value: number;
  tone: "emerald" | "blue" | "violet" | "teal" | "amber" | "rose";
}) {
  const toneStyles: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    teal: "border-cyan-200 bg-cyan-50 text-cyan-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };

  return (
    <Link
      href={href}
      className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 p-3 transition hover:border-primary-300 hover:bg-primary-50/40"
    >
      <div>
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="mt-1 text-xs text-gray-600">{hint}</p>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneStyles[tone]}`}>{value}</span>
    </Link>
  );
}

function LineTrendChart({
  title,
  subtitle,
  points,
  strokeClass,
  fillClass,
  dotClass,
}: {
  title: string;
  subtitle: string;
  points: ChartPoint[];
  strokeClass: string;
  fillClass: string;
  dotClass: string;
}) {
  if (!points.length) return null;

  const width = 520;
  const height = 160;
  const paddingX = 24;
  const paddingY = 22;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const minValue = Math.min(...points.map((point) => point.value), 0);
  const range = Math.max(maxValue - minValue, 1);

  const toX = (index: number) => paddingX + (index * (width - paddingX * 2)) / Math.max(points.length - 1, 1);
  const toY = (value: number) => height - paddingY - ((value - minValue) / range) * (height - paddingY * 2);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index)},${toY(point.value)}`)
    .join(" ");

  const areaPath = `${path} L ${toX(points.length - 1)},${height - paddingY} L ${toX(0)},${height - paddingY} Z`;
  const latest = points[points.length - 1]?.value || 0;

  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <p className="text-sm font-semibold text-gray-900">{percent(latest)}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        <path d={areaPath} className={fillClass} />
        <path d={path} className={`fill-none stroke-2 ${strokeClass}`} />
        {points.map((point, index) => (
          <circle key={`${point.label}-${index}`} cx={toX(index)} cy={toY(point.value)} r={3} className={dotClass} />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
        {points.map((point) => (
          <span key={point.label} className="rounded bg-gray-100 px-2 py-0.5">
            {point.label}: {percent(point.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

function BarMixChart({
  points,
  currency = false,
  toneByLabel = {},
}: {
  points: ChartPoint[];
  currency?: boolean;
  toneByLabel?: Record<string, string>;
}) {
  const maxValue = Math.max(...points.map((point) => Number(point.value || 0)), 1);
  return (
    <div className="space-y-2">
      {points.map((point) => {
        const value = Number(point.value || 0);
        const width = Math.max(4, (value / maxValue) * 100);
        const tone = toneByLabel[point.label] || "bg-blue-500";
        return (
          <div key={point.label}>
            <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
              <span>{point.label}</span>
              <span className="font-semibold text-gray-900">{currency ? money(value) : value}</span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100">
              <div className={`h-2.5 rounded-full ${tone}`} style={{ width: `${Math.min(100, width)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function DonutBreakdownChart({
  title,
  subtitle,
  points,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  points: ChartPoint[];
  emptyMessage: string;
}) {
  if (!points.length) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-1 text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  const total = points.reduce((sum, point) => sum + Number(point.value || 0), 0) || 1;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const colors = ["stroke-violet-600", "stroke-fuchsia-500", "stroke-cyan-500", "stroke-amber-500", "stroke-rose-500", "stroke-emerald-500"];
  let offset = 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        <p className="text-sm font-semibold text-slate-900">{total} total</p>
      </div>
      <div className="flex flex-col items-center gap-5 md:flex-row md:items-start">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <svg viewBox="0 0 160 160" className="h-40 w-40 -rotate-90">
            <circle cx="80" cy="80" r={radius} className="fill-none stroke-gray-100" strokeWidth="20" />
            {points.map((point, index) => {
              const segment = (Number(point.value || 0) / total) * circumference;
              const segmentOffset = offset;
              offset += segment;
              return (
                <circle
                  key={`${point.label}-${index}`}
                  cx="80"
                  cy="80"
                  r={radius}
                  className={`fill-none ${colors[index % colors.length]}`}
                  strokeWidth="20"
                  strokeDasharray={`${segment} ${circumference - segment}`}
                  strokeDashoffset={-segmentOffset}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          <div className="absolute text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">Stages</p>
            <p className="text-2xl font-bold text-slate-900">{points.length}</p>
          </div>
        </div>
        <div className="w-full space-y-2">
          {points.map((point, index) => (
            <div key={point.label} className="flex items-center justify-between rounded-2xl bg-gray-50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${colors[index % colors.length].replace("stroke", "bg")}`} />
                <span className="capitalize text-gray-700">{point.label}</span>
              </div>
              <span className="font-semibold text-slate-900">{point.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistogramChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: ChartPoint[];
}) {
  const maxValue = Math.max(...points.map((point) => Number(point.value || 0)), 1);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex h-52 items-end gap-3 rounded-[24px] border border-gray-100 bg-gradient-to-b from-white to-[#fbf7fa] p-4">
        {points.map((point, index) => {
          const height = Math.max(10, (Number(point.value || 0) / maxValue) * 100);
          const tones = [
            "from-[#7c3aed] to-[#4f46e5]",
            "from-[#be185d] to-[#7c3aed]",
            "from-[#0ea5e9] to-[#2563eb]",
            "from-[#f59e0b] to-[#ea580c]",
          ];
          return (
            <div key={point.label} className="flex flex-1 flex-col items-center justify-end gap-2">
              <span className="text-xs font-semibold text-slate-700">{point.value}</span>
              <div className="flex h-full w-full items-end rounded-2xl bg-gray-100 p-1.5">
                <div
                  className={`w-full rounded-xl bg-gradient-to-t ${tones[index % tones.length]} shadow-[0_10px_25px_rgba(79,70,229,0.18)]`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
