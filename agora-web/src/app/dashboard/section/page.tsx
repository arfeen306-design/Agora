"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import ClassAttendanceArea from "@/components/dashboard/section/ClassAttendanceArea";
import LateAbsentStudentsPanel from "@/components/dashboard/section/LateAbsentStudentsPanel";
import SectionAnnouncementsPanel from "@/components/dashboard/section/SectionAnnouncementsPanel";
import SectionHeroCard from "@/components/dashboard/section/SectionHeroCard";
import SectionKpiStrip from "@/components/dashboard/section/SectionKpiStrip";
import SectionQuickActionsPanel from "@/components/dashboard/section/SectionQuickActionsPanel";
import SectionUpcomingEventsPanel from "@/components/dashboard/section/SectionUpcomingEventsPanel";
import TeacherCompletionArea from "@/components/dashboard/section/TeacherCompletionArea";
import type { SectionAnnouncementItem, SectionEventItem, SectionKpiItem } from "@/components/dashboard/section/types";
import { useAuth } from "@/lib/auth";
import {
  getDisciplineIncidents,
  getSectionDashboard,
  type DisciplineIncidentRecord,
  type SectionDashboardData,
} from "@/lib/api";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export default function SectionDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [payload, setPayload] = useState<SectionDashboardData | null>(null);
  const [disciplineRows, setDisciplineRows] = useState<DisciplineIncidentRecord[]>([]);

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
        const effectiveSectionId = selectedSectionId || response.data?.selected_section_id || "";
        if (!selectedSectionId && response.data?.selected_section_id) setSelectedSectionId(response.data.selected_section_id);

        if (effectiveSectionId) {
          try {
            const incidentsResponse = await getDisciplineIncidents({
              section_id: effectiveSectionId,
              page: "1",
              page_size: "8",
            });
            if (!cancelled) {
              setDisciplineRows(Array.isArray(incidentsResponse.data) ? incidentsResponse.data : []);
            }
          } catch {
            if (!cancelled) {
              setDisciplineRows([]);
            }
          }
        } else if (!cancelled) {
          setDisciplineRows([]);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPayload(null);
        setDisciplineRows([]);
        setError(err instanceof Error ? err.message : "Failed to load section dashboard");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isHeadmistress, selectedSectionId, user]);

  const detail = payload?.selected_section_detail || null;
  const selectedSection = detail?.section || payload?.sections?.find((row) => row.section_id === payload?.selected_section_id) || null;

  const attendanceRate = useMemo(() => {
    if (!detail) return 0;
    const totals = detail.class_attendance.reduce(
      (acc, row) => {
        acc.present += row.present_count || 0;
        acc.total += row.attendance_records_today || 0;
        return acc;
      },
      { present: 0, total: 0 }
    );
    return totals.total > 0 ? (totals.present / totals.total) * 100 : 0;
  }, [detail]);

  const kpis = useMemo<SectionKpiItem[]>(() => {
    if (!selectedSection) return [];
    return [
      {
        label: "Active Students",
        value: formatNumber(selectedSection.active_students || 0),
        tone: "primary",
      },
      {
        label: "Classrooms",
        value: formatNumber(selectedSection.class_count || 0),
        tone: "success",
      },
      {
        label: "Late Today",
        value: formatNumber(selectedSection.late_today || 0),
        tone: (selectedSection.late_today || 0) > 5 ? "warning" : "primary",
      },
      {
        label: "Absent Today",
        value: formatNumber(selectedSection.absent_today || 0),
        tone: (selectedSection.absent_today || 0) > 3 ? "danger" : "warning",
      },
    ];
  }, [selectedSection]);

  const announcements = useMemo<SectionAnnouncementItem[]>(() => {
    if (!detail) return [];
    return detail.announcements.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      eventType: item.event_type,
      startsAt: item.starts_at,
      classroomLabel: item.classroom_label,
    }));
  }, [detail]);

  const upcomingEvents = useMemo<SectionEventItem[]>(() => {
    if (!detail) return [];
    return detail.upcoming_events.map((item) => ({
      id: item.id,
      title: item.title,
      eventType: item.event_type,
      startsAt: item.starts_at,
      classroomLabel: item.classroom_label,
    }));
  }, [detail]);

  const disciplineSummary = useMemo(() => {
    return {
      open: disciplineRows.filter((row) => row.status === "reported" || row.status === "under_review").length,
      escalated: disciplineRows.filter((row) => row.status === "escalated").length,
      critical: disciplineRows.filter((row) => row.severity === "critical").length,
    };
  }, [disciplineRows]);

  if (!isHeadmistress) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Headmistress Access Required</h2>
            <p className="mt-2 text-sm text-gray-600">
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
        <div className="p-6">
          <div className="mb-5 h-52 animate-pulse rounded-2xl bg-emerald-100" />
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

  if (!payload || payload.sections.length === 0) {
    return (
      <>
        <Header title="Section Dashboard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">No Section Assigned</h2>
            <p className="mt-2 text-sm text-gray-600">
              Your account is active but not currently linked to any section.
            </p>
            <div className="mt-4 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
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
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Section Detail Unavailable</h2>
            <p className="mt-2 text-sm text-gray-600">
              {error || "Select another section or refresh the page."}
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Section Dashboard" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {payload.sections.length > 1 && (
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <label className="label-text">Viewing Section</label>
            <select
              className="input-field max-w-sm"
              value={selectedSection.section_id}
              onChange={(e) => setSelectedSectionId(e.target.value)}
            >
              {payload.sections.map((row) => (
                <option key={row.section_id} value={row.section_id}>
                  {row.section_name} ({row.section_code})
                </option>
              ))}
            </select>
          </section>
        )}

        <SectionHeroCard
          sectionName={selectedSection.section_name}
          sectionCode={selectedSection.section_code}
          attendanceRate={attendanceRate}
          activeStudents={selectedSection.active_students || 0}
          generatedAt={payload.generated_at}
        />

        <SectionKpiStrip items={kpis} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <ClassAttendanceArea rows={detail.class_attendance} />
            <LateAbsentStudentsPanel rows={detail.late_absent_students} />
            <SectionQuickActionsPanel />
          </div>
          <div className="space-y-5">
            <TeacherCompletionArea data={detail.teacher_completion} />
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Discipline Shortcut</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Section-scoped incidents and escalation activity for rapid HM follow-up.
                  </p>
                </div>
                <Link href="/dashboard/discipline" className="text-sm font-semibold text-primary-700 hover:text-primary-900">
                  Open
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2">
                  <p className="font-semibold text-amber-800">{disciplineSummary.open}</p>
                  <p className="text-amber-700">Open</p>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-2">
                  <p className="font-semibold text-red-800">{disciplineSummary.escalated}</p>
                  <p className="text-red-700">Escalated</p>
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-2">
                  <p className="font-semibold text-violet-800">{disciplineSummary.critical}</p>
                  <p className="text-violet-700">Critical</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {disciplineRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    No recent incidents tagged to this section.
                  </p>
                ) : (
                  disciplineRows.slice(0, 3).map((row) => (
                    <div key={row.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-xs font-semibold capitalize text-gray-800">
                        {row.incident_type.replaceAll("_", " ")} • {row.severity}
                      </p>
                      <p className="mt-1 text-xs text-gray-600">
                        {row.student_first_name} {row.student_last_name}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
            <SectionAnnouncementsPanel rows={announcements} />
            <SectionUpcomingEventsPanel rows={upcomingEvents} />
          </div>
        </section>
      </div>
    </>
  );
}
