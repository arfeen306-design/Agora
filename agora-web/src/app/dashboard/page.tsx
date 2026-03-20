"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import AdminCommandCenter from "@/components/dashboard/admin/AdminCommandCenter";
import ClassroomWeeklyTimetableBoard from "@/components/timetable/ClassroomWeeklyTimetableBoard";
import { useAuth } from "@/lib/auth";
import {
  getAttendance,
  getClassroomManualTimetableBoard,
  getEvents,
  getMyReportCardHistory,
  getHomework,
  getNotifications,
  getPeopleMyStudents,
  getPeopleStudentAcademicSummary,
  getPeopleStudentTimeline,
  getStudentMarksSummary,
  type ClassroomWeeklyTimetableBoardPayload,
  type FamilyReportCardHistoryItem,
  type MyLinkedStudentRecord,
} from "@/lib/api";

interface DashboardStats {
  attendanceValue: string;
  attendanceHint: string;
  attendanceCardLabel: string;
  homeworkValue: string;
  homeworkHint: string;
  homeworkCardLabel: string;
  upcomingEventsValue: string;
  notificationsValue: string;
}

interface ProgressPanel {
  attendanceRate: number;
  homeworkCompletionRate: number;
  marksAverage: number;
  progressLoopMessage: string;
}

interface FamilyTimelineItem {
  id: string;
  title: string;
  subtitle: string;
  occurredAt: string;
  tone: "emerald" | "blue" | "violet" | "amber";
}

interface RecentTest {
  id: string;
  title: string;
  type: string;
  marks: number;
  maxMarks: number;
  percentage: number;
}

interface SchoolNotice {
  id: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
}

interface FamilyReportCardPreview extends FamilyReportCardHistoryItem {}

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function progressLoopFromTrend(trend: Array<{ average?: number }> = []) {
  if (trend.length < 4) return "Progress trend will appear once enough test data is available.";
  const values = trend.map((point) => Number(point.average || 0));
  const latest = values.slice(-3);
  const previous = values.slice(-6, -3);
  if (previous.length === 0) return "Progress trend is stabilizing.";
  const latestAvg = latest.reduce((a, b) => a + b, 0) / latest.length;
  const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
  const delta = latestAvg - previousAvg;
  if (delta >= 4) return "Improving: recent tests are stronger than earlier results.";
  if (delta <= -4) return "Attention needed: recent tests dropped, revision support recommended.";
  return "Stable: performance is consistent across recent tests.";
}

function statusTone(status: string) {
  switch (status) {
    case "PRESENT":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "LATE":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "ABSENT":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "LEAVE":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-gray-200 bg-gray-50 text-gray-700";
  }
}

function humanizeTimelineType(type: string) {
  return type
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortDateTime(value?: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDate(value?: string | null) {
  if (!value) return "Awaiting publish date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function linkedStudentName(student?: MyLinkedStudentRecord | null) {
  if (!student) return "";
  return [student.first_name, student.last_name].filter(Boolean).join(" ").trim() || student.student_code;
}

function linkedStudentClassroom(student?: MyLinkedStudentRecord | null) {
  if (!student) return "";
  const grade = student.grade_label || "";
  const section = student.section_label ? `Section ${student.section_label}` : "";
  const code = student.classroom_code || "";
  return [grade, section, code].filter(Boolean).join(" • ");
}

function timelineTone(type: string): FamilyTimelineItem["tone"] {
  if (type.includes("attendance") || type.includes("gate")) return "emerald";
  if (type.includes("homework")) return "blue";
  if (type.includes("assessment") || type.includes("mark")) return "violet";
  return "amber";
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const roles = user?.roles || [];

  const isLeadership = hasAnyRole(roles, ["principal", "vice_principal"]);
  const isSectionLeadership = roles.includes("headmistress");
  const isFrontDesk = roles.includes("front_desk");
  const isHrAdmin = roles.includes("hr_admin");
  const isParentOrStudent = hasAnyRole(roles, ["parent", "student"]);
  const canManageAcademic = isAdmin || roles.includes("teacher");

  const [loading, setLoading] = useState(true);
  const [linkedStudents, setLinkedStudents] = useState<MyLinkedStudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [recentTests, setRecentTests] = useState<RecentTest[]>([]);
  const [notices, setNotices] = useState<SchoolNotice[]>([]);
  const [timelineItems, setTimelineItems] = useState<FamilyTimelineItem[]>([]);
  const [reportCards, setReportCards] = useState<FamilyReportCardPreview[]>([]);
  const [familyTimetableBoard, setFamilyTimetableBoard] = useState<ClassroomWeeklyTimetableBoardPayload | null>(null);
  const [panel, setPanel] = useState<ProgressPanel>({
    attendanceRate: 0,
    homeworkCompletionRate: 0,
    marksAverage: 0,
    progressLoopMessage: "Progress trend will appear once enough test data is available.",
  });
  const [stats, setStats] = useState<DashboardStats>({
    attendanceValue: "0",
    attendanceHint: "Today's records",
    attendanceCardLabel: "Attendance Records Today",
    homeworkValue: "0",
    homeworkHint: "Active tasks",
    homeworkCardLabel: "Active Homework",
    upcomingEventsValue: "0",
    notificationsValue: "0",
  });

  useEffect(() => {
    if (isLeadership) {
      router.replace("/dashboard/principal");
      return;
    }
    if (isSectionLeadership) {
      router.replace("/dashboard/section");
      return;
    }
    if (isFrontDesk) {
      router.replace("/dashboard/admissions");
      return;
    }
    if (isHrAdmin) {
      router.replace("/dashboard/hr");
    }
  }, [isFrontDesk, isHrAdmin, isLeadership, isSectionLeadership, router]);

  useEffect(() => {
    if (isLeadership || isSectionLeadership || isFrontDesk || isHrAdmin || !user || (isAdmin && !isParentOrStudent)) {
      setLoading(false);
      return;
    }

    async function loadDashboard() {
      setLoading(true);
      const today = new Date().toISOString().split("T")[0];

      if (isParentOrStudent) {
        const students = await getPeopleMyStudents().catch(() => []);
        setLinkedStudents(students);

        if (students.length === 0) {
          setStats({
            attendanceValue: "PENDING",
            attendanceHint: "No linked child yet",
            attendanceCardLabel: "Today's Attendance",
            homeworkValue: "0",
            homeworkHint: "Pending homework",
            homeworkCardLabel: "Homework Pending",
            upcomingEventsValue: "0",
            notificationsValue: "0",
          });
          setPanel({
            attendanceRate: 0,
            homeworkCompletionRate: 0,
            marksAverage: 0,
            progressLoopMessage: "No linked child found for this account.",
          });
          setRecentTests([]);
          setNotices([]);
          setTimelineItems([]);
          setReportCards([]);
          setFamilyTimetableBoard(null);
          setLoading(false);
          return;
        }

        let resolvedStudentId = selectedStudentId;
        if (!resolvedStudentId || !students.some((student) => student.id === resolvedStudentId)) {
          resolvedStudentId = students[0].id;
        }
        if (resolvedStudentId !== selectedStudentId) {
          setSelectedStudentId(resolvedStudentId);
        }

        const selectedStudentRecord = students.find((student) => student.id === resolvedStudentId) || students[0];
        const [summary, timeline, marksSummary, todayAttendance, events, notifications, reportCardHistory, timetableBoard] =
          await Promise.all([
            getPeopleStudentAcademicSummary(resolvedStudentId).catch(() => null),
            getPeopleStudentTimeline(resolvedStudentId, { max_events: "25" }).catch(() => null),
            getStudentMarksSummary(resolvedStudentId).catch(() => null),
            getAttendance({
              student_id: resolvedStudentId,
              date_from: today,
              date_to: today,
              page_size: "10",
            }).catch(() => null),
            getEvents({ date_from: today, page_size: "1" }).catch(() => null),
            getNotifications({ page_size: "6" }).catch(() => null),
            getMyReportCardHistory({ student_id: resolvedStudentId, page_size: 3 }).catch(() => null),
            selectedStudentRecord?.classroom_id
              ? getClassroomManualTimetableBoard(selectedStudentRecord.classroom_id).catch(() => null)
              : Promise.resolve(null),
          ]);

        const attendanceRows = Array.isArray(todayAttendance?.data) ? todayAttendance.data : [];
        const rawStatus = String(attendanceRows[0]?.status || "pending").toLowerCase();
        const todayStatus =
          rawStatus === "present"
            ? "PRESENT"
            : rawStatus === "absent"
              ? "ABSENT"
              : rawStatus === "late"
                ? "LATE"
                : rawStatus === "leave"
                  ? "LEAVE"
                  : "NOT MARKED";

        const homeworkAssigned = Number(summary?.homework_summary?.total_assigned || 0);
        const homeworkDone = Number(summary?.homework_summary?.submitted || 0);
        const homeworkPending = Math.max(0, homeworkAssigned - homeworkDone);
        const unreadNotifications = (Array.isArray(notifications?.data) ? notifications.data : []).filter(
          (row) => String(row.status || "").toLowerCase() !== "read"
        ).length;

        const timelineEvents = Array.isArray(timeline?.events) ? timeline.events : [];
        const testItems = timelineEvents
          .filter((event) => event.type === "assessment_score")
          .slice(0, 4)
          .map((event, index) => {
            const data = (event.data || {}) as Record<string, unknown>;
            const marks = Number(data.marks_obtained || 0);
            const maxMarks = Number(data.max_marks || 0);
            return {
              id: `${index}-${String(data.assessment_id || "assessment")}`,
              title: String(data.title || "Assessment"),
              type: String(data.assessment_type || "assessment"),
              marks,
              maxMarks,
              percentage: maxMarks > 0 ? Number(((marks / maxMarks) * 100).toFixed(1)) : 0,
            } as RecentTest;
          });

        const studentMarksSummary = marksSummary as
          | {
              data?: {
                trend?: Array<{ average?: number }>;
                overall_average?: number;
              };
            }
          | null;
        const trend = Array.isArray(studentMarksSummary?.data?.trend) ? studentMarksSummary.data.trend : [];
        const progressMessage = progressLoopFromTrend(trend as Array<{ average?: number }>);

        const noticeItems = (Array.isArray(notifications?.data) ? notifications.data : [])
          .slice(0, 4)
          .map((row) => ({
            id: String(row.id || crypto.randomUUID?.() || Math.random()),
            title: String(row.title || "Notification"),
            body: String(row.body || ""),
            status: String(row.status || "queued"),
            createdAt: String(row.created_at || ""),
          })) as SchoolNotice[];

        const activityItems = timelineEvents
          .slice(0, 6)
          .map((event, index) => {
            const data = (event.data || {}) as Record<string, unknown>;
            const type = String(event.type || "activity");
            const fallbackTitle =
              type === "assessment_score"
                ? String(data.title || "Recent assessment")
                : type === "attendance_marked"
                  ? `Attendance marked ${String(data.status || "").toUpperCase() || ""}`.trim()
                  : humanizeTimelineType(type);
            const subtitle =
              type === "assessment_score"
                ? `${Number(data.marks_obtained || 0)}/${Number(data.max_marks || 0)} in ${String(
                    data.assessment_type || "assessment"
                  ).replaceAll("_", " ")}`
                : type === "attendance_marked"
                  ? `Status: ${String(data.status || "pending").replaceAll("_", " ")}`
                  : String(data.note || data.subject || data.status_label || "Recorded by school");
            return {
              id: `${type}-${event.date || "date"}-${event.time || "time"}-${index}`,
              title: fallbackTitle,
              subtitle: subtitle || "Recorded by school",
              occurredAt: [event.date, event.time].filter(Boolean).join(" "),
              tone: timelineTone(type),
            } as FamilyTimelineItem;
          });

        setStats({
          attendanceValue: todayStatus,
          attendanceHint: "Today's attendance status",
          attendanceCardLabel: "Today's Attendance",
          homeworkValue: String(homeworkPending),
          homeworkHint: `Done ${homeworkDone} • Pending ${homeworkPending}`,
          homeworkCardLabel: "Homework Pending",
          upcomingEventsValue: String(events?.meta?.pagination?.total_items ?? 0),
          notificationsValue: String(unreadNotifications),
        });
        setPanel({
          attendanceRate: Number(summary?.attendance_summary?.rate || 0),
          homeworkCompletionRate: Number(summary?.homework_summary?.completion_rate || 0),
          marksAverage: Number(summary?.marks_summary?.average_percentage || studentMarksSummary?.data?.overall_average || 0),
          progressLoopMessage: progressMessage,
        });
        setRecentTests(testItems);
        setNotices(noticeItems);
        setTimelineItems(activityItems);
        setReportCards((reportCardHistory?.data?.items || []).slice(0, 3));
        setFamilyTimetableBoard(timetableBoard);
        setLoading(false);
        return;
      }

      const [attendance, homework, events, notifications] = await Promise.allSettled([
        getAttendance({ date_from: today, date_to: today, page_size: "1" }),
        getHomework({ page_size: "1" }),
        getEvents({ date_from: today, page_size: "1" }),
        getNotifications({ page_size: "1" }),
      ]);

      setStats({
        attendanceValue:
          attendance.status === "fulfilled"
            ? String(attendance.value.meta?.pagination?.total_items ?? 0)
            : "0",
        attendanceHint: "Today's records",
        attendanceCardLabel: "Attendance Records Today",
        homeworkValue:
          homework.status === "fulfilled"
            ? String(homework.value.meta?.pagination?.total_items ?? 0)
            : "0",
        homeworkHint: "Active homework",
        homeworkCardLabel: "Active Homework",
        upcomingEventsValue:
          events.status === "fulfilled"
            ? String(events.value.meta?.pagination?.total_items ?? 0)
            : "0",
        notificationsValue:
          notifications.status === "fulfilled"
            ? String(notifications.value.meta?.pagination?.total_items ?? 0)
            : "0",
      });
      setLoading(false);
    }

    loadDashboard();
  }, [
    isFrontDesk,
    isHrAdmin,
    isAdmin,
    isLeadership,
    isParentOrStudent,
    isSectionLeadership,
    selectedStudentId,
    user,
  ]);

  const selectedStudent = useMemo(
    () => linkedStudents.find((student) => student.id === selectedStudentId) || linkedStudents[0] || null,
    [linkedStudents, selectedStudentId]
  );

  if (isLeadership || isSectionLeadership || isFrontDesk || isHrAdmin) {
    return (
      <>
        <Header title="Dashboard" />
        <div className={`p-6 ${isParentOrStudent ? "family-dashboard" : ""}`}>
          <div className="card flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <p className="text-sm text-gray-600">Opening your role dashboard...</p>
          </div>
        </div>
      </>
    );
  }

  if (isAdmin && !isParentOrStudent) {
    return (
      <>
        <Header title="Dashboard" />
        <div className={`p-6 ${isParentOrStudent ? "family-dashboard" : ""}`}>
          <AdminCommandCenter firstName={user?.first_name} />
        </div>
      </>
    );
  }

  const quickActions = isParentOrStudent
    ? [
        { href: "/dashboard/attendance", label: "View Attendance", color: "text-green-500", hint: "Present, absent, late, leave" },
        { href: "/dashboard/homework", label: "View Homework", color: "text-blue-500", hint: "Done and pending tasks" },
        { href: "/dashboard/marks", label: "View Test Reports", color: "text-purple-500", hint: "Results and report cards" },
        { href: "/dashboard/notifications", label: "View Notices", color: "text-orange-500", hint: "Messages from school" },
      ]
    : canManageAcademic
      ? [
          { href: "/dashboard/attendance", label: "Mark Attendance", color: "text-green-500", hint: "Daily class attendance" },
          { href: "/dashboard/homework", label: "Add Homework", color: "text-blue-500", hint: "Create and publish homework" },
          { href: "/dashboard/marks", label: "Enter Marks", color: "text-purple-500", hint: "Assessments and grading" },
          { href: "/dashboard/messaging", label: "Messages", color: "text-orange-500", hint: "Family communication" },
        ]
      : [
          { href: "/dashboard/reports", label: "Reports", color: "text-indigo-500", hint: "Performance insights" },
          { href: "/dashboard/notifications", label: "Notifications", color: "text-orange-500", hint: "School alerts" },
          { href: "/dashboard/events", label: "Events", color: "text-fuchsia-500", hint: "Calendar and activities" },
          { href: "/dashboard/messaging", label: "Messages", color: "text-sky-500", hint: "School communication" },
        ];

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6">
        {isParentOrStudent ? (
          <section className="relative mb-8 overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,#22053a_0%,#3b0764_38%,#140327_100%)] p-6 text-white shadow-[0_28px_80px_rgba(8,3,18,0.38)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.24),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(99,102,241,0.24),_transparent_32%)]" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-1/3 h-52 w-52 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-100/80">Family Dashboard</p>
                <h2 className="mt-2 text-3xl font-bold">
                  {selectedStudent ? `${linkedStudentName(selectedStudent)}'s School Pulse` : `Welcome back, ${user?.first_name}!`}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-white/[0.78]">
                  Live attendance, homework, test results, and school updates connected to teacher activity.
                </p>
                {linkedStudentClassroom(selectedStudent) && (
                  <p className="mt-3 text-sm text-white/90">
                    {linkedStudentClassroom(selectedStudent)}
                    {selectedStudent?.class_teacher_name
                      ? ` • Class Teacher: ${selectedStudent.class_teacher_name}`
                      : ""}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="family-chip">Live updates from class teacher</span>
                  <span className="family-chip">Attendance + homework + marks</span>
                  <span className="family-chip">Read-only family view</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FamilyHeroBadge label="Today's Attendance" value={stats.attendanceValue} tone={statusTone(stats.attendanceValue)} />
                <FamilyHeroBadge label="Homework Pending" value={stats.homeworkValue} tone="border-blue-200 bg-blue-50 text-blue-700" />
                <FamilyHeroBadge label="Marks Average" value={`${panel.marksAverage.toFixed(1)}%`} tone="border-violet-200 bg-violet-50 text-violet-700" />
                <FamilyHeroBadge label="Unread Notices" value={stats.notificationsValue} tone="border-amber-200 bg-amber-50 text-amber-700" />
              </div>
            </div>
          </section>
        ) : (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back, {user?.first_name}!</h2>
            <p className="text-gray-500 mt-1">
              {isAdmin ? "Here's an overview of your school." : "Here's your classroom overview."}
            </p>
          </div>
        )}

        {isParentOrStudent && linkedStudents.length > 1 && (
          <div className="card mb-6">
            <label className="label-text mb-2 block">Viewing Child</label>
            <select
              className="input-field max-w-md"
              value={selectedStudent?.id || ""}
              onChange={(event) => setSelectedStudentId(event.target.value)}
            >
              {linkedStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {linkedStudentName(student)} ({student.student_code})
                </option>
              ))}
            </select>
            {linkedStudentClassroom(selectedStudent) && (
              <p className="mt-2 text-xs text-gray-500">
                {linkedStudentClassroom(selectedStudent)}
                {selectedStudent?.class_teacher_name
                  ? ` • Class Teacher: ${selectedStudent.class_teacher_name}`
                  : ""}
              </p>
            )}
          </div>
        )}

        {!isParentOrStudent && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { label: stats.attendanceCardLabel, value: stats.attendanceValue, hint: stats.attendanceHint, color: "bg-green-500" },
              { label: stats.homeworkCardLabel, value: stats.homeworkValue, hint: stats.homeworkHint, color: "bg-blue-500" },
              { label: "Upcoming Events", value: stats.upcomingEventsValue, hint: "School calendar", color: "bg-purple-500" },
              { label: "Notifications", value: stats.notificationsValue, hint: "Unread alerts", color: "bg-orange-500" },
            ].map((card) => (
              <div key={card.label} className="card flex items-center gap-4">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.color} text-white shrink-0`} />
                <div>
                  {loading ? (
                    <div className="h-7 w-20 animate-pulse rounded bg-gray-200" />
                  ) : (
                    <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                  )}
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-xs text-gray-400">{card.hint}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {isParentOrStudent && (
          <>
            {familyTimetableBoard ? (
              <div className="mb-8">
                <ClassroomWeeklyTimetableBoard
                  board={familyTimetableBoard}
                  title="Weekly Timetable"
                  subtitle="This is the live class timetable shared by the class teacher for the selected child."
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 mb-8">
              <FamilyStatCard
                title="Today's Attendance"
                value={stats.attendanceValue}
                hint={stats.attendanceHint}
                tone={statusTone(stats.attendanceValue)}
              />
              <FamilyStatCard
                title="Homework Pending"
                value={stats.homeworkValue}
                hint={stats.homeworkHint}
                tone="border-blue-200 bg-blue-50 text-blue-700"
              />
              <FamilyStatCard
                title="Upcoming Events"
                value={stats.upcomingEventsValue}
                hint="School calendar items ahead"
                tone="border-violet-200 bg-violet-50 text-violet-700"
              />
              <FamilyStatCard
                title="Unread Notices"
                value={stats.notificationsValue}
                hint="Unread messages from school"
                tone="border-amber-200 bg-amber-50 text-amber-700"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr_0.9fr] mb-8">
              <div className="family-panel-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Performance Arc</h3>
                    <p className="mt-1 text-sm text-white/[0.58]">Attendance, homework completion, and marks average at a glance.</p>
                  </div>
                  <span className="family-chip">Live</span>
                </div>
                <div className="mt-5 flex items-end gap-3">
                  {[
                    { label: 'Attendance', value: panel.attendanceRate, colors: 'from-emerald-400 to-cyan-400' },
                    { label: 'Homework', value: panel.homeworkCompletionRate, colors: 'from-sky-400 to-indigo-400' },
                    { label: 'Marks', value: panel.marksAverage, colors: 'from-fuchsia-400 to-violet-400' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-32 w-full items-end rounded-[22px] bg-white/[0.06] p-2">
                        <div className={`w-full rounded-[16px] bg-gradient-to-t ${item.colors}`} style={{ height: `${Math.max(12, Math.min(100, item.value))}%` }} />
                      </div>
                      <p className="text-xs font-semibold text-white">{item.value.toFixed(0)}%</p>
                      <p className="text-center text-[11px] text-white/50">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="family-panel-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Recent Test Momentum</h3>
                    <p className="mt-1 text-sm text-white/[0.58]">A quick look at the latest published scores.</p>
                  </div>
                  <span className="family-chip">Recent</span>
                </div>
                <div className="mt-5 flex items-end gap-3">
                  {(recentTests.length ? recentTests.slice(0, 4) : [{ id: 'placeholder', title: 'No tests', percentage: 0, marks: 0, maxMarks: 0, type: 'test' } as RecentTest]).map((test) => (
                    <div key={test.id} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-32 w-full items-end rounded-[22px] bg-white/[0.06] p-2">
                        <div className="w-full rounded-[16px] bg-gradient-to-t from-fuchsia-500 via-violet-500 to-indigo-400" style={{ height: `${Math.max(12, Math.min(100, test.percentage || 0))}%` }} />
                      </div>
                      <p className="text-xs font-semibold text-white">{Number(test.percentage || 0).toFixed(0)}%</p>
                      <p className="text-center text-[11px] text-white/50">{recentTests.length ? test.title : 'Awaiting data'}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="family-panel-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">School Pulse</h3>
                    <p className="mt-1 text-sm text-white/[0.58]">Communication and publishing activity around the child.</p>
                  </div>
                  <span className="family-chip">This week</span>
                </div>
                <div className="mt-5 space-y-3">
                  <FamilySignalRow label="Timeline updates" value={timelineItems.length} />
                  <FamilySignalRow label="Notices from school" value={notices.length} />
                  <FamilySignalRow label="Published report cards" value={reportCards.length} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <div className="card lg:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900">Progress Snapshot</h3>
                <p className="text-sm text-gray-500 mt-1">{panel.progressLoopMessage}</p>
                <div className="mt-5 space-y-4">
                  <ProgressRow label="Attendance Rate" value={panel.attendanceRate} color="bg-emerald-500" />
                  <ProgressRow label="Homework Completion" value={panel.homeworkCompletionRate} color="bg-blue-500" />
                  <ProgressRow label="Marks Average" value={panel.marksAverage} color="bg-violet-500" />
                </div>
              </div>
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900">Today at School</h3>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Attendance Status</p>
                    <p className="mt-1 text-xl font-bold text-gray-900">{stats.attendanceValue}</p>
                    <p className="mt-1 text-sm text-gray-500">{stats.attendanceHint}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Homework Status</p>
                    <p className="mt-1 text-xl font-bold text-gray-900">{stats.homeworkValue} pending</p>
                    <p className="mt-1 text-sm text-gray-500">{stats.homeworkHint}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900">Recent Test Marks</h3>
                {recentTests.length === 0 ? (
                  <p className="text-sm text-gray-500 mt-3">No recent test marks yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {recentTests.map((test) => (
                      <div key={test.id} className="rounded-xl border border-gray-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900">{test.title}</p>
                            <p className="text-xs text-gray-500 mt-1">{test.type.replaceAll("_", " ").toUpperCase()}</p>
                          </div>
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                            {test.percentage.toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-2">
                          {test.marks}/{test.maxMarks}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
                {timelineItems.length === 0 ? (
                  <p className="text-sm text-gray-500 mt-3">No recent school activity has been recorded yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {timelineItems.map((item) => (
                      <FamilyTimelineCard key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card mb-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Report Card History</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Published term cards appear here as soon as the school releases them.
                  </p>
                </div>
                <Link href="/dashboard/marks" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                  View all results
                </Link>
              </div>

              {reportCards.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-gray-200 p-5 text-sm text-gray-500">
                  No published report cards yet.
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {reportCards.map((reportCard) => (
                    <div key={reportCard.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{reportCard.exam_term_name || "Term Result"}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                            {(reportCard.exam_term_type || "term")} • {(reportCard.classroom_label || reportCard.classroom_code || "Classroom")}
                          </p>
                        </div>
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                          {reportCard.percentage !== null && reportCard.percentage !== undefined
                            ? `${Number(reportCard.percentage).toFixed(1)}%`
                            : "Published"}
                        </span>
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-gray-600">
                        <p>Grade: <span className="font-medium text-gray-900">{reportCard.grade || "—"}</span></p>
                        <p>Attendance: <span className="font-medium text-gray-900">
                          {reportCard.attendance_rate !== null && reportCard.attendance_rate !== undefined
                            ? `${Number(reportCard.attendance_rate).toFixed(1)}%`
                            : `${reportCard.attendance_present}/${reportCard.attendance_total}`}
                        </span></p>
                        <p>Published: <span className="font-medium text-gray-900">{shortDate(reportCard.published_at || reportCard.generated_at)}</span></p>
                      </div>
                      <div className="mt-4">
                        <Link
                          href={`/dashboard/marks/report-cards/${reportCard.id}`}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700"
                        >
                          View full report card →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {isParentOrStudent && (
          <div className="card mb-8">
            <h3 className="text-lg font-semibold text-gray-900">School Notifications</h3>
            {notices.length === 0 ? (
              <p className="text-sm text-gray-500 mt-3">No notifications yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {notices.map((notice) => (
                  <div key={notice.id} className="rounded-lg border border-gray-200 p-3">
                    <p className="font-medium text-gray-900">{notice.title}</p>
                    <p className="text-sm text-gray-600 mt-1">{notice.body}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {notice.status.toUpperCase()}
                      {notice.createdAt ? ` • ${new Date(notice.createdAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {isParentOrStudent ? "Read-Only Family Shortcuts" : "Quick Actions"}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors"
              >
                <div className={`h-8 w-8 rounded-full bg-gray-100 ${action.color}`} />
                <span className="text-sm font-medium text-gray-700">{action.label}</span>
                <span className="text-center text-xs text-gray-400">{action.hint}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ProgressRow({ label, value, color }: { label: string; value: number; color: string }) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm font-semibold text-gray-900">{normalized.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

function FamilyHeroBadge({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${tone}`}>
      <p className="text-[11px] uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function FamilyStatCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
      <p className="text-xs uppercase tracking-[0.18em]">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-sm opacity-90">{hint}</p>
    </div>
  );
}

function FamilySignalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3">
      <span className="text-sm text-white/[0.68]">{label}</span>
      <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-1 text-sm font-semibold text-white">
        {value}
      </span>
    </div>
  );
}

function FamilyTimelineCard({ item }: { item: FamilyTimelineItem }) {
  const toneDot: Record<FamilyTimelineItem["tone"], string> = {
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    violet: "bg-violet-500",
    amber: "bg-amber-500",
  };

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-3 w-3 rounded-full ${toneDot[item.tone]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium text-gray-900">{item.title}</p>
            <span className="text-xs text-gray-400">{shortDateTime(item.occurredAt)}</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">{item.subtitle}</p>
        </div>
      </div>
    </div>
  );
}
