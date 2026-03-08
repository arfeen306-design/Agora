"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import AttendanceTrendArea from "@/components/dashboard/principal/AttendanceTrendArea";
import FinanceSummaryPanel from "@/components/dashboard/principal/FinanceSummaryPanel";
import PendingItemsPanel from "@/components/dashboard/principal/PendingItemsPanel";
import PrincipalHeroCard from "@/components/dashboard/principal/PrincipalHeroCard";
import PrincipalKpiStrip from "@/components/dashboard/principal/PrincipalKpiStrip";
import PriorityAlertsPanel from "@/components/dashboard/principal/PriorityAlertsPanel";
import QuickActionsPanel from "@/components/dashboard/principal/QuickActionsPanel";
import SectionHealthTable from "@/components/dashboard/principal/SectionHealthTable";
import UpcomingEventsPanel from "@/components/dashboard/principal/UpcomingEventsPanel";
import type {
  FinanceSummaryCardData,
  PendingItem,
  PrincipalAlert,
  PrincipalEventItem,
  PrincipalKpiCard,
  SectionHealthRow,
} from "@/components/dashboard/principal/types";
import { useAuth } from "@/lib/auth";
import {
  getDisciplineIncidents,
  getEvents,
  getFeesSummary,
  getNotifications,
  getPrincipalDashboard,
  type DisciplineIncidentRecord,
  type PrincipalDashboardData,
} from "@/lib/api";

interface FeesSummaryResponse {
  total_invoices: number;
  paid_count: number;
  overdue_count: number;
  amount_due_total: number;
  amount_paid_total: number;
  outstanding_total: number;
  overdue_total: number;
}

interface NotificationRow {
  id: string;
  title: string;
  status: string;
}

interface EventRow {
  id: string;
  title: string;
  event_type: string;
  starts_at: string;
  target_scope: string;
}

const LEADERSHIP_ROLES = ["school_admin", "principal", "vice_principal"];

function hasLeadershipAccess(roles: string[] = []) {
  return LEADERSHIP_ROLES.some((role) => roles.includes(role));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function toPercent(value: number, total: number) {
  if (!total) return 0;
  return (value / total) * 100;
}

export default function PrincipalDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<PrincipalDashboardData | null>(null);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummaryCardData | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<PrincipalEventItem[]>([]);
  const [notificationRows, setNotificationRows] = useState<NotificationRow[]>([]);
  const [disciplineRows, setDisciplineRows] = useState<DisciplineIncidentRecord[]>([]);

  const allowed = hasLeadershipAccess(user?.roles || []);

  useEffect(() => {
    if (!user || !allowed) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError("");

      const today = new Date();
      const dateFrom = new Date(today);
      dateFrom.setDate(today.getDate() - 30);

      const [principalRes, feesRes, eventsRes, notificationsRes, disciplineRes] = await Promise.allSettled([
        getPrincipalDashboard(),
        getFeesSummary({
          date_from: dateFrom.toISOString().slice(0, 10),
          date_to: today.toISOString().slice(0, 10),
        }),
        getEvents({
          date_from: today.toISOString(),
          page_size: "8",
          page: "1",
        }),
        getNotifications({
          page_size: "8",
          page: "1",
        }),
        getDisciplineIncidents({
          status: "escalated",
          page: "1",
          page_size: "40",
        }),
      ]);

      if (cancelled) return;

      if (principalRes.status === "fulfilled") {
        setDashboard(principalRes.value.data as PrincipalDashboardData);
      } else {
        setDashboard(null);
        setError("Unable to load leadership summary right now.");
      }

      if (feesRes.status === "fulfilled") {
        const data = feesRes.value.data as FeesSummaryResponse;
        setFinanceSummary({
          totalInvoices: data.total_invoices || 0,
          paidCount: data.paid_count || 0,
          overdueCount: data.overdue_count || 0,
          amountDueTotal: Number(data.amount_due_total || 0),
          amountPaidTotal: Number(data.amount_paid_total || 0),
          outstandingTotal: Number(data.outstanding_total || 0),
          overdueTotal: Number(data.overdue_total || 0),
        });
      } else {
        setFinanceSummary(null);
      }

      if (eventsRes.status === "fulfilled") {
        const rows = (eventsRes.value.data as EventRow[]) || [];
        setUpcomingEvents(
          rows.slice(0, 6).map((row) => ({
            id: row.id,
            title: row.title,
            eventType: row.event_type,
            startsAt: row.starts_at,
            targetScope: row.target_scope,
          }))
        );
      } else {
        setUpcomingEvents([]);
      }

      if (notificationsRes.status === "fulfilled") {
        setNotificationRows(((notificationsRes.value.data as NotificationRow[]) || []).slice(0, 8));
      } else {
        setNotificationRows([]);
      }

      if (disciplineRes.status === "fulfilled") {
        setDisciplineRows(((disciplineRes.value.data as DisciplineIncidentRecord[]) || []).slice(0, 40));
      } else {
        setDisciplineRows([]);
      }

      setLoading(false);
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [allowed, user]);

  const sectionHealthRows = useMemo<SectionHealthRow[]>(() => {
    if (!dashboard) return [];

    const homeworkBySection = new Map(
      dashboard.homework_completion_by_section.map((row) => [
        row.section_code || row.section_name,
        row,
      ])
    );

    return dashboard.section_attendance.map((row) => {
      const hw = homeworkBySection.get(row.section_code || row.section_name);
      const attendanceRate = toPercent(row.present_count, row.attendance_records_today);
      const homeworkCompletionRate = hw
        ? toPercent(hw.completed_submissions, hw.total_submissions)
        : null;

      return {
        sectionId: row.section_id,
        sectionName: row.section_name,
        sectionCode: row.section_code,
        totalRecords: row.attendance_records_today,
        attendanceRate,
        lateCount: row.late_count,
        absentCount: row.absent_count,
        homeworkCompletionRate,
        missingHomework: hw?.missing_submissions || 0,
      };
    });
  }, [dashboard]);

  const kpiCards = useMemo<PrincipalKpiCard[]>(() => {
    if (!dashboard) return [];

    const totalHomework = dashboard.homework_completion_by_section.reduce(
      (sum, row) => sum + (row.total_submissions || 0),
      0
    );
    const completedHomework = dashboard.homework_completion_by_section.reduce(
      (sum, row) => sum + (row.completed_submissions || 0),
      0
    );
    const completionRate = toPercent(completedHomework, totalHomework);

    return [
      {
        label: "Late Students Today",
        value: formatNumber(dashboard.attendance_today.late_count),
        subtext: "Require punctuality follow-up",
        tone: dashboard.attendance_today.late_count > 15 ? "warning" : "primary",
      },
      {
        label: "Absent Students Today",
        value: formatNumber(dashboard.attendance_today.absent_count),
        subtext: "Potential attendance risk",
        tone: dashboard.attendance_today.absent_count > 10 ? "danger" : "warning",
      },
      {
        label: "Homework Completion",
        value: `${completionRate.toFixed(1)}%`,
        subtext: `${formatNumber(completedHomework)} of ${formatNumber(totalHomework)} submissions`,
        tone: completionRate >= 80 ? "success" : "warning",
      },
      {
        label: "Marks Upload Volume",
        value: formatNumber(dashboard.marks_upload_status.score_count),
        subtext: `${formatNumber(dashboard.marks_upload_status.assessment_count)} assessments`,
        tone: dashboard.marks_upload_status.score_count > 0 ? "primary" : "danger",
      },
      {
        label: "Escalated Incidents",
        value: formatNumber(disciplineRows.length),
        subtext: "Needs principal review",
        tone: disciplineRows.length > 0 ? "danger" : "success",
      },
    ];
  }, [dashboard, disciplineRows.length]);

  const alerts = useMemo<PrincipalAlert[]>(() => {
    if (!dashboard) return [];

    const rows: PrincipalAlert[] = [];
    const absentCount = dashboard.attendance_today.absent_count || 0;
    const lateCount = dashboard.attendance_today.late_count || 0;
    const defaulters = dashboard.finance_and_alerts.defaulter_invoices || 0;
    const atRiskSections = sectionHealthRows.filter(
      (row) => row.attendanceRate < 75 || row.missingHomework > 10
    ).length;
    const unreadNotifications = notificationRows.filter((row) => row.status !== "read").length;
    const escalatedCount = disciplineRows.length;

    if (absentCount > 20) {
      rows.push({
        id: "alert_absent_critical",
        title: "High Student Absence",
        message: `${absentCount} students are absent today. Immediate section review is recommended.`,
        severity: "danger",
        href: "/dashboard/attendance",
        actionLabel: "Inspect attendance",
      });
    }

    if (lateCount > 10) {
      rows.push({
        id: "alert_late",
        title: "Late Arrival Spike",
        message: `${lateCount} late entries recorded today. Check gate and section punctuality action plan.`,
        severity: "warning",
        href: "/dashboard/reports",
        actionLabel: "View attendance report",
      });
    }

    if (defaulters > 0) {
      rows.push({
        id: "alert_defaulters",
        title: "Fee Defaulters Need Follow-up",
        message: `${defaulters} overdue invoices are active.`,
        severity: "warning",
        href: "/dashboard/fees",
        actionLabel: "Open fee module",
      });
    }

    if (atRiskSections > 0) {
      rows.push({
        id: "alert_sections",
        title: "Section Health Risk",
        message: `${atRiskSections} section(s) show weak attendance or homework completion.`,
        severity: "danger",
        href: "/dashboard/institution",
        actionLabel: "Review section health",
      });
    }

    if (escalatedCount > 0) {
      rows.push({
        id: "alert_discipline_escalated",
        title: "Escalated Discipline Incidents",
        message: `${escalatedCount} escalated incident(s) are waiting for leadership action.`,
        severity: "danger",
        href: "/dashboard/discipline",
        actionLabel: "Open discipline",
      });
    }

    if (unreadNotifications > 0) {
      rows.push({
        id: "alert_notifications",
        title: "Pending Leadership Notifications",
        message: `${unreadNotifications} notifications are awaiting review.`,
        severity: "info",
        href: "/dashboard/notifications",
        actionLabel: "Open notifications",
      });
    }

    return rows.slice(0, 5);
  }, [dashboard, disciplineRows.length, notificationRows, sectionHealthRows]);

  const pendingItems = useMemo<PendingItem[]>(() => {
    if (!dashboard) return [];

    const atRiskSections = sectionHealthRows.filter(
      (row) => row.attendanceRate < 75 || row.missingHomework > 10
    ).length;

    return [
      {
        id: "pending_defaulters",
        label: "Defaulter Invoices",
        value: formatNumber(dashboard.finance_and_alerts.defaulter_invoices || 0),
        tone: (dashboard.finance_and_alerts.defaulter_invoices || 0) > 0 ? "warning" : "primary",
        href: "/dashboard/fees",
      },
      {
        id: "pending_delegations",
        label: "Active Delegations",
        value: formatNumber(dashboard.finance_and_alerts.active_delegations || 0),
        tone: "primary",
        href: "/dashboard/access-control",
      },
      {
        id: "pending_section_flags",
        label: "Section Flags",
        value: formatNumber(atRiskSections),
        tone: atRiskSections > 0 ? "danger" : "primary",
        href: "/dashboard/institution",
      },
    ];
  }, [dashboard, sectionHealthRows]);

  if (!allowed) {
    return (
      <>
        <Header title="Principal Dashboard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Leadership Access Required</h2>
            <p className="mt-2 text-sm text-gray-600">
              This command center is available to School Admin, Principal, and Vice Principal roles.
            </p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Principal Dashboard" />
        <div className="p-6">
          <div className="mb-5 h-52 animate-pulse rounded-2xl bg-blue-100" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
            <div className="h-28 animate-pulse rounded-xl bg-gray-200" />
          </div>
        </div>
      </>
    );
  }

  if (!dashboard) {
    return (
      <>
        <Header title="Principal Dashboard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Unable to load command center</h2>
            <p className="mt-2 text-sm text-gray-600">{error || "Please refresh and try again."}</p>
          </section>
        </div>
      </>
    );
  }

  const attendanceRate = toPercent(dashboard.attendance_today.present_count, dashboard.attendance_today.total);

  return (
    <>
      <Header title="Principal Dashboard" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <PrincipalHeroCard
          title={`Welcome back, ${user?.first_name || "Leader"}`}
          subtitle="Leadership overview of attendance, academic throughput, finance signals, and section-level health."
          attendanceRate={attendanceRate}
          presentCount={dashboard.attendance_today.present_count}
          totalCount={dashboard.attendance_today.total}
          generatedAt={dashboard.generated_at}
        />

        <PrincipalKpiStrip items={kpiCards} />

        <AttendanceTrendArea
          attendance={dashboard.attendance_today}
          sections={dashboard.section_attendance}
        />

        <SectionHealthTable rows={sectionHealthRows} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <PriorityAlertsPanel alerts={alerts} />
            <QuickActionsPanel />
          </div>
          <div className="space-y-5">
            <FinanceSummaryPanel data={financeSummary} />
            <PendingItemsPanel items={pendingItems} />
            <UpcomingEventsPanel events={upcomingEvents} />
          </div>
        </section>
      </div>
    </>
  );
}
