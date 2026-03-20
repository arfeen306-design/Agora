"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { MiniDonutChart, MiniHistogram, ProgressStripe } from "@/components/dashboard/shared/InsightCharts";
import ClassroomWeeklyTimetableBoard from "@/components/timetable/ClassroomWeeklyTimetableBoard";
import { useAuth } from "@/lib/auth";
import {
  getClassroomManualTimetableBoard,
  getDisciplineIncidents,
  getFeesSummary,
  getLookupClassrooms,
  getNotifications,
  getPrincipalDashboard,
  type ClassroomWeeklyTimetableBoardPayload,
  type LookupClassroom,
  type PrincipalDashboardData,
} from "@/lib/api";

const LEADERSHIP_ROLES = ["school_admin", "principal", "vice_principal"];

function hasLeadershipAccess(roles: string[] = []) {
  return LEADERSHIP_ROLES.some((role) => roles.includes(role));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function money(value: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function shortDate(value?: string | null) {
  if (!value) return "No term yet";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function labelize(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "Unassigned";
}

export default function PrincipalDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<PrincipalDashboardData | null>(null);
  const [financeSummary, setFinanceSummary] = useState<any>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [escalatedIncidents, setEscalatedIncidents] = useState(0);
  const [classroomOptions, setClassroomOptions] = useState<LookupClassroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [timetableBoard, setTimetableBoard] = useState<ClassroomWeeklyTimetableBoardPayload | null>(null);
  const [timetableLoading, setTimetableLoading] = useState(false);

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

      const [principalRes, feesRes, notificationsRes, disciplineRes, classroomRes] = await Promise.allSettled([
        getPrincipalDashboard(),
        getFeesSummary({
          date_from: dateFrom.toISOString().slice(0, 10),
          date_to: today.toISOString().slice(0, 10),
        }),
        getNotifications({ page: "1", page_size: "20" }),
        getDisciplineIncidents({ status: "escalated", page: "1", page_size: "50" }),
        getLookupClassrooms({ page_size: 100 }),
      ]);

      if (cancelled) return;

      if (principalRes.status === "fulfilled") {
        setDashboard(principalRes.value.data);
      } else {
        setDashboard(null);
        setError("Unable to load leadership summary right now.");
      }

      setFinanceSummary(feesRes.status === "fulfilled" ? feesRes.value.data : null);
      setNotificationCount(
        notificationsRes.status === "fulfilled"
          ? (((notificationsRes.value.data as Array<{ status?: string }>) || []).filter((row) => row.status !== "read").length)
          : 0
      );
      setEscalatedIncidents(
        disciplineRes.status === "fulfilled" ? (((disciplineRes.value.data as unknown[]) || []).length) : 0
      );
      const nextClassrooms = classroomRes.status === "fulfilled" ? classroomRes.value : [];
      setClassroomOptions(nextClassrooms);
      setSelectedClassroomId((current) => current || nextClassrooms[0]?.id || "");
      setLoading(false);
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [allowed, user]);

  useEffect(() => {
    if (!allowed || !selectedClassroomId) return;

    let cancelled = false;

    async function loadBoard() {
      setTimetableLoading(true);
      try {
        const nextBoard = await getClassroomManualTimetableBoard(selectedClassroomId);
        if (!cancelled) setTimetableBoard(nextBoard);
      } catch (err) {
        if (!cancelled) {
          setTimetableBoard(null);
          setError(err instanceof Error ? err.message : "Failed to load leadership timetable view.");
        }
      } finally {
        if (!cancelled) setTimetableLoading(false);
      }
    }

    loadBoard();
    return () => {
      cancelled = true;
    };
  }, [allowed, selectedClassroomId]);

  const sectionBlocks = useMemo(() => dashboard?.section_command_blocks || [], [dashboard]);

  const totals = useMemo(() => {
    const totalSections = sectionBlocks.length;
    const studentPresent = sectionBlocks.reduce((sum, block) => sum + (block.student_attendance_today.present_count || 0), 0);
    const studentTotal = sectionBlocks.reduce((sum, block) => sum + (block.student_attendance_today.total || 0), 0);
    const staffPresent = sectionBlocks.reduce((sum, block) => sum + (block.staff_attendance_today.present_count || 0), 0);
    const staffTotal = sectionBlocks.reduce((sum, block) => sum + (block.staff_attendance_today.total || 0), 0);
    const parents = sectionBlocks.reduce((sum, block) => sum + (block.linked_parents || 0), 0);
    const students = sectionBlocks.reduce((sum, block) => sum + (block.active_students || 0), 0);
    const publishedCards = sectionBlocks.reduce((sum, block) => sum + (block.results.published_cards || 0), 0);
    const totalCards = sectionBlocks.reduce((sum, block) => sum + (block.results.total_cards || 0), 0);
    const admissions = sectionBlocks.reduce((sum, block) => sum + (block.admissions.inquiry_count || 0) + (block.admissions.under_review_count || 0) + (block.admissions.accepted_count || 0) + (block.admissions.waitlisted_count || 0), 0);

    return {
      totalSections,
      studentPresent,
      studentTotal,
      staffPresent,
      staffTotal,
      parents,
      students,
      publishedCards,
      totalCards,
      admissions,
    };
  }, [sectionBlocks]);

  const resultHistogram = useMemo(
    () =>
      sectionBlocks.map((block) => ({
        label: block.section_code || block.section_name,
        value: block.results.average_percentage || 0,
      })),
    [sectionBlocks]
  );

  const admissionsBars = useMemo(
    () =>
      sectionBlocks.map((block) => ({
        label: block.section_code,
        value:
          (block.admissions.inquiry_count || 0) +
          (block.admissions.under_review_count || 0) +
          (block.admissions.accepted_count || 0) +
          (block.admissions.waitlisted_count || 0),
      })),
    [sectionBlocks]
  );

  if (!allowed) {
    return (
      <>
        <Header title="Principal Dashboard" />
        <div className="p-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Leadership Access Required</h2>
            <p className="mt-2 text-sm text-slate-600">
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
        <div className="space-y-6 p-6">
          <div className="h-56 animate-pulse rounded-[32px] bg-gradient-to-r from-[#4b1235] to-[#7c3aed]" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-3xl bg-white/80" />
            ))}
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
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-rose-900">Unable to load command center</h2>
            <p className="mt-2 text-sm text-rose-700">{error || "Please refresh and try again."}</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Principal Dashboard" />
      <div className="space-y-6 p-6">
        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
        ) : null}

        <section className="overflow-hidden rounded-[32px] bg-gradient-to-r from-[#4b1235] via-[#5b1c87] to-[#2563eb] p-8 text-white shadow-2xl shadow-violet-950/20">
          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-violet-100/80">Leadership Command Center</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">Every section, HM, attendance signal, and academic pulse in one screen.</h1>
              <p className="mt-3 max-w-3xl text-sm text-violet-100/90">
                Track section managers, student and staff attendance, discipline pressure, admissions movement, report-card publishing, and parent linkage without leaving this command view.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                <Link href="/dashboard/institution" className="rounded-full bg-white/[0.15] px-4 py-2 font-semibold text-white transition hover:bg-white/20">
                  Open institution setup
                </Link>
                <Link href="/dashboard/parents" className="rounded-full bg-white/10 px-4 py-2 font-semibold text-white/95 transition hover:bg-white/20">
                  Parents and families
                </Link>
                <Link href="/dashboard/reports" className="rounded-full bg-white/10 px-4 py-2 font-semibold text-white/95 transition hover:bg-white/20">
                  Results and reports
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-slate-950">
              <HeroStat label="Sections live" value={formatNumber(totals.totalSections)} hint="HM-led operational units" />
              <HeroStat label="Student attendance" value={`${percent(totals.studentPresent, totals.studentTotal)}%`} hint={`${formatNumber(totals.studentPresent)} present today`} />
              <HeroStat label="Staff attendance" value={`${percent(totals.staffPresent, totals.staffTotal)}%`} hint={`${formatNumber(totals.staffPresent)} marked today`} />
              <HeroStat label="Published cards" value={`${percent(totals.publishedCards, totals.totalCards)}%`} hint={`${formatNumber(totals.publishedCards)} of ${formatNumber(totals.totalCards)}`} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <SummaryTile label="Linked parents" value={formatNumber(totals.parents)} helper="Family access covered by sections" tone="rose" />
          <SummaryTile label="Open admissions" value={formatNumber(totals.admissions)} helper="Inquiry, review, accepted, waitlisted" tone="violet" />
          <SummaryTile label="Unread alerts" value={formatNumber(notificationCount)} helper="Leadership notifications awaiting review" tone="amber" />
          <SummaryTile label="Escalated discipline" value={formatNumber(escalatedIncidents)} helper="Needs leadership follow-up" tone="blue" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Section command blocks</h2>
                <p className="text-sm text-slate-500">One block per section with HM, attendance, results, admissions, discipline, and staff visibility.</p>
              </div>
              <Link href="/dashboard/section" className="text-sm font-semibold text-violet-700 hover:text-violet-900">Open HM dashboard</Link>
            </div>
            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
              {sectionBlocks.map((block) => {
                const resultCompletion = block.results.total_cards > 0 ? block.results.published_cards : block.active_students;
                const resultTarget = block.results.total_cards > 0 ? block.results.total_cards : block.active_students;
                const admissionOpen =
                  block.admissions.inquiry_count +
                  block.admissions.under_review_count +
                  block.admissions.accepted_count +
                  block.admissions.waitlisted_count;
                return (
                  <article key={block.section_id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-gradient-to-r from-[#521b3d] via-[#5b21b6] to-[#2563eb] p-5 text-white">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-violet-100/80">{labelize(block.section_type)}</p>
                          <h3 className="mt-2 text-2xl font-semibold">{block.section_name}</h3>
                          <p className="mt-1 text-sm text-violet-100/[0.85]">{block.section_code} • {block.class_count} classes • {block.active_students} students</p>
                        </div>
                        <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm backdrop-blur">
                          <p className="text-xs uppercase tracking-[0.2em] text-violet-100/80">HM / Manager</p>
                          <p className="mt-1 font-semibold">{block.head_name || block.coordinator_name || "Unassigned"}</p>
                          <p className="text-xs text-violet-100/80">{block.coordinator_name ? `Coordinator: ${block.coordinator_name}` : "Leadership seat available"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 p-5 xl:grid-cols-[1.1fr_1fr]">
                      <div className="grid gap-4 md:grid-cols-2">
                        <MiniDonutChart title="Student attendance" breakdown={block.student_attendance_today} tone="blue" />
                        <MiniDonutChart title="Staff attendance" breakdown={block.staff_attendance_today} tone="emerald" />
                      </div>
                      <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <MetricPill label="Staff" value={formatNumber(block.assigned_staff)} tone="violet" />
                          <MetricPill label="Parents linked" value={formatNumber(block.linked_parents)} tone="blue" />
                          <MetricPill label="Discipline open" value={formatNumber(block.discipline.open_count)} tone="rose" />
                          <MetricPill label="Events (14d)" value={formatNumber(block.events.upcoming_count)} tone="amber" />
                        </div>
                        <ProgressStripe
                          label={`Results progress${block.results.latest_term_name ? ` • ${block.results.latest_term_name}` : ""}`}
                          value={resultCompletion}
                          total={resultTarget}
                          hint={`Avg ${block.results.average_percentage.toFixed(1)}% • ${block.results.draft_cards} drafts pending`}
                          colorClass="from-fuchsia-500 via-violet-600 to-blue-500"
                        />
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
                            <span>Admissions & movement</span>
                            <span>{formatNumber(admissionOpen)} open</span>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                            <StatBadge label="Accepted" value={block.admissions.accepted_count} tone="emerald" />
                            <StatBadge label="Admitted" value={block.admissions.admitted_count} tone="blue" />
                            <StatBadge label="Withdrawals" value={block.withdrawals.count} tone="slate" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-5 border-t border-slate-200 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">Section staff profiles</h4>
                          <Link href={`/dashboard/people?section_id=${block.section_id}`} className="text-xs font-semibold text-violet-700 hover:text-violet-900">Open people</Link>
                        </div>
                        <div className="mt-3 space-y-2">
                          {block.staff_preview.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                              No staff assigned yet.
                            </div>
                          ) : (
                            block.staff_preview.map((staff) => (
                              <div key={staff.staff_profile_id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                  <p className="font-semibold text-slate-900">{staff.name}</p>
                                  <p className="text-xs text-slate-500">{staff.designation || labelize(staff.staff_type)} • {staff.department || "Section operations"}</p>
                                </div>
                                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold capitalize text-white">{staff.attendance_status}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <MetricPanel title="Staff coverage" value={formatNumber(block.assigned_staff)} subtitle={`${formatNumber(block.class_count)} classes • ${formatNumber(block.staff_attendance_today.present_count || 0)} staff present today`} />
                        <MetricPanel title="Students & parents" value={`${formatNumber(block.active_students)} / ${formatNumber(block.linked_parents)}`} subtitle="Students and linked guardians in this section" />
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/dashboard/reports?section_id=${block.section_id}`} className="rounded-full bg-violet-100 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-200">Result progress</Link>
                          <Link href={`/dashboard/admissions/pipeline?section_id=${block.section_id}`} className="rounded-full bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-200">Admissions</Link>
                          <Link href={`/dashboard/people?section_id=${block.section_id}`} className="rounded-full bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-200">Staff & people</Link>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <MiniHistogram title="Section result progress" items={resultHistogram.length ? resultHistogram : [{ label: "No data", value: 0 }]} />
            <MiniHistogram title="Admission pressure by section" items={admissionsBars.length ? admissionsBars : [{ label: "No data", value: 0 }]} />
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Finance and alerts</p>
              <div className="mt-4 space-y-3">
                <MetricPanel title="Outstanding dues" value={money(financeSummary?.outstanding_total || 0)} subtitle={`${formatNumber(financeSummary?.overdue_count || 0)} overdue invoices • ${money(financeSummary?.overdue_total || 0)} overdue value`} />
                <MetricPanel title="Paid this cycle" value={money(financeSummary?.amount_paid_total || 0)} subtitle={`${formatNumber(financeSummary?.paid_count || 0)} invoices cleared`} />
                <MetricPanel title="Leadership queue" value={formatNumber(notificationCount + escalatedIncidents)} subtitle={`${formatNumber(notificationCount)} notifications • ${formatNumber(escalatedIncidents)} escalated incidents`} />
              </div>
            </section>
          </div>
        </section>

        <section className="space-y-5 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Timetable</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Leadership timetable view</h2>
              <p className="mt-1 text-sm text-slate-500">Select any class to review the live weekly timetable being shared with teachers, HM, students, and families.</p>
            </div>
            <div className="min-w-[280px]">
              <label className="label-text">Select class</label>
              <select className="input-field mt-2" value={selectedClassroomId} onChange={(e) => setSelectedClassroomId(e.target.value)}>
                {classroomOptions.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {timetableLoading ? (
            <div className="h-96 animate-pulse rounded-2xl bg-slate-100" />
          ) : timetableBoard ? (
            <ClassroomWeeklyTimetableBoard
              board={timetableBoard}
              title="Class timetable"
              subtitle="This principal view stays read-only and mirrors the timetable maintained in the class teacher workspace."
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No timetable board is available for the selected classroom yet.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-3xl bg-white px-5 py-4 shadow-lg shadow-slate-950/10">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  tone: "rose" | "violet" | "amber" | "blue";
}) {
  const tones = {
    rose: "from-rose-500/10 to-fuchsia-500/10 border-rose-200 text-rose-900",
    violet: "from-violet-500/10 to-indigo-500/10 border-violet-200 text-violet-900",
    amber: "from-amber-500/10 to-orange-500/10 border-amber-200 text-amber-900",
    blue: "from-blue-500/10 to-cyan-500/10 border-blue-200 text-blue-900",
  };
  return (
    <div className={`rounded-3xl border bg-gradient-to-r p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{helper}</p>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone: "violet" | "blue" | "rose" | "amber" }) {
  const tones = {
    violet: "bg-violet-100 text-violet-800",
    blue: "bg-blue-100 text-blue-800",
    rose: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
  };
  return (
    <div className="rounded-2xl bg-white px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{value}</span>
    </div>
  );
}

function StatBadge({ label, value, tone }: { label: string; value: number; tone: "emerald" | "blue" | "slate" }) {
  const tones = {
    emerald: "bg-emerald-100 text-emerald-800",
    blue: "bg-blue-100 text-blue-800",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tones[tone]}`}>{value}</span>
    </div>
  );
}

function MetricPanel({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
