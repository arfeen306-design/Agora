"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import TimetableHeroCard from "@/components/dashboard/timetable/TimetableHeroCard";
import TimetableScheduleGrid from "@/components/dashboard/timetable/TimetableScheduleGrid";
import TimetableSubstitutionsPanel from "@/components/dashboard/timetable/TimetableSubstitutionsPanel";
import { useAuth } from "@/lib/auth";
import {
  createTimetableEntry,
  createTimetablePeriod,
  createTimetableSubstitution,
  generateTimetableSlots,
  getClassroomTimetable,
  getLookupAcademicYears,
  getLookupClassrooms,
  getLookupSubjects,
  getMyTeacherTimetable,
  getTeacherTimetable,
  getTimetableSlots,
  getTimetableSubstitutions,
  getTimetableTeachers,
  revokeTimetableSubstitution,
  type ClassroomTimetablePayload,
  type TeacherTimetablePayload,
  type TimetableEntryRow,
  type TimetableSlotRow,
  type TimetableSubstitutionRow,
} from "@/lib/api";

const MANAGEMENT_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];
const VIEW_ROLES = [...MANAGEMENT_ROLES, "teacher"];

const STANDARD_PERIODS = [
  { period_number: 1, label: "Period 1", starts_at: "08:00:00", ends_at: "08:45:00" },
  { period_number: 2, label: "Period 2", starts_at: "08:50:00", ends_at: "09:35:00" },
  { period_number: 3, label: "Period 3", starts_at: "09:40:00", ends_at: "10:25:00" },
  { period_number: 4, label: "Period 4", starts_at: "10:30:00", ends_at: "11:15:00" },
  { period_number: 5, label: "Period 5", starts_at: "11:25:00", ends_at: "12:10:00" },
  { period_number: 6, label: "Period 6", starts_at: "12:15:00", ends_at: "13:00:00" },
  { period_number: 7, label: "Period 7", starts_at: "13:10:00", ends_at: "13:55:00" },
  { period_number: 8, label: "Period 8", starts_at: "14:00:00", ends_at: "14:45:00" },
];

type TeacherOption = Awaited<ReturnType<typeof getTimetableTeachers>>[number];
type ClassroomOption = Awaited<ReturnType<typeof getLookupClassrooms>>[number];
type SubjectOption = Awaited<ReturnType<typeof getLookupSubjects>>[number];
type AcademicYearOption = Awaited<ReturnType<typeof getLookupAcademicYears>>[number];

function hasAnyRole(roles: string[] = [], expected: string[]) {
  return expected.some((role) => roles.includes(role));
}

function formatTime(value?: string) {
  if (!value) return "";
  return value.slice(0, 5);
}

function firstUsefulMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export default function TimetableDashboardPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState("");
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);

  const [slots, setSlots] = useState<TimetableSlotRow[]>([]);
  const [classroomPayload, setClassroomPayload] = useState<ClassroomTimetablePayload | null>(null);
  const [teacherPayload, setTeacherPayload] = useState<TeacherTimetablePayload | null>(null);
  const [substitutions, setSubstitutions] = useState<TimetableSubstitutionRow[]>([]);

  const [viewMode, setViewMode] = useState<"classroom" | "teacher">("classroom");
  const [entryForm, setEntryForm] = useState({
    classroom_id: "",
    slot_id: "",
    subject_id: "",
    teacher_id: "",
    entry_type: "teaching" as "teaching" | "activity" | "study_hall" | "break",
    room_number: "",
    notes: "",
  });
  const [substitutionForm, setSubstitutionForm] = useState({
    timetable_entry_id: "",
    substitute_teacher_id: "",
    substitution_date: "",
    reason: "",
  });

  const canView = hasAnyRole(user?.roles || [], VIEW_ROLES);
  const canManage = hasAnyRole(user?.roles || [], MANAGEMENT_ROLES);
  const isTeacherOnly = hasAnyRole(user?.roles || [], ["teacher"]) && !canManage;

  useEffect(() => {
    if (isTeacherOnly) {
      setViewMode("teacher");
    }
  }, [isTeacherOnly]);

  const scheduleEntries = useMemo<TimetableEntryRow[]>(() => {
    if (viewMode === "classroom") return classroomPayload?.entries || [];
    return teacherPayload?.entries || [];
  }, [classroomPayload?.entries, teacherPayload?.entries, viewMode]);

  const availableEntryOptions = useMemo(
    () =>
      scheduleEntries.map((entry) => ({
        id: entry.id,
        label: `${entry.day_name || `Day ${entry.day_of_week}`} • ${entry.period_label} • ${entry.subject_name || "General Session"}`,
      })),
    [scheduleEntries]
  );

  const heroAccent = useMemo<"blue" | "emerald" | "amber">(() => {
    if (hasAnyRole(user?.roles || [], ["headmistress"])) return "emerald";
    if (hasAnyRole(user?.roles || [], ["teacher"])) return "amber";
    return "blue";
  }, [user?.roles]);

  async function loadSlots(yearId: string) {
    const rows = await getTimetableSlots({
      academic_year_id: yearId,
      include_inactive: "false",
    });
    setSlots(rows);
  }

  async function loadSubstitutions() {
    const today = new Date().toISOString().slice(0, 10);
    const response = await getTimetableSubstitutions({
      date_from: today,
      page: "1",
      page_size: "30",
    });
    setSubstitutions(response.data || []);
  }

  async function loadClassroomTimetable(yearId: string, classroomId: string) {
    if (!classroomId) {
      setClassroomPayload(null);
      return;
    }
    const payload = await getClassroomTimetable(classroomId, {
      academic_year_id: yearId,
      include_inactive: "false",
    });
    setClassroomPayload(payload);
  }

  async function loadTeacherTimetable(yearId: string, teacherId: string) {
    if (isTeacherOnly) {
      const payload = await getMyTeacherTimetable({
        academic_year_id: yearId,
        include_inactive: "false",
      });
      setTeacherPayload(payload);
      return;
    }
    if (!teacherId) {
      setTeacherPayload(null);
      return;
    }
    const payload = await getTeacherTimetable(teacherId, {
      academic_year_id: yearId,
      include_inactive: "false",
    });
    setTeacherPayload(payload);
  }

  useEffect(() => {
    if (!user || !canView) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadLookups() {
      setLoading(true);
      setError("");
      try {
        const [yearRows, classroomRows, teacherRows] = await Promise.all([
          getLookupAcademicYears({ page_size: 50 }),
          getLookupClassrooms({ page_size: 200 }),
          getTimetableTeachers({ page_size: "200" }),
        ]);
        if (cancelled) return;

        setAcademicYears(yearRows);
        setClassrooms(classroomRows);
        setTeachers(teacherRows);

        const currentYear = yearRows.find((row) => row.is_current) || yearRows[0];
        const yearId = currentYear?.id || "";
        setSelectedYear(yearId);

        const firstClassroom = classroomRows[0]?.id || "";
        setSelectedClassroom(firstClassroom);
        setEntryForm((prev) => ({
          ...prev,
          classroom_id: firstClassroom,
        }));

        const defaultTeacher = isTeacherOnly
          ? (teacherRows[0]?.id || "")
          : (teacherRows[0]?.id || "");
        setSelectedTeacher(defaultTeacher);
        setEntryForm((prev) => ({
          ...prev,
          teacher_id: defaultTeacher,
        }));
      } catch (err: unknown) {
        if (!cancelled) {
          setError(firstUsefulMessage(err, "Failed to load timetable lookups"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canView, isTeacherOnly, user]);

  useEffect(() => {
    if (!selectedYear || !canView) return;
    let cancelled = false;

    async function loadSecondaryData() {
      try {
        const [subjectsRows] = await Promise.all([
          selectedClassroom
            ? getLookupSubjects({ classroom_id: selectedClassroom, page_size: 200 })
            : Promise.resolve([] as SubjectOption[]),
        ]);
        if (cancelled) return;
        setSubjects(subjectsRows);
      } catch (_err) {
        if (!cancelled) {
          setSubjects([]);
        }
      }
    }

    loadSecondaryData();
    return () => {
      cancelled = true;
    };
  }, [canView, selectedClassroom, selectedYear]);

  useEffect(() => {
    if (!selectedYear || !canView) return;
    let cancelled = false;

    async function loadTimetableData() {
      setLoading(true);
      setError("");
      try {
        await Promise.all([
          loadSlots(selectedYear),
          loadSubstitutions(),
          viewMode === "classroom"
            ? loadClassroomTimetable(selectedYear, selectedClassroom)
            : loadTeacherTimetable(selectedYear, selectedTeacher),
        ]);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(firstUsefulMessage(err, "Failed to load timetable data"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTimetableData();
    return () => {
      cancelled = true;
    };
  }, [canView, selectedClassroom, selectedTeacher, selectedYear, viewMode]);

  async function bootstrapSlotsAndPeriods() {
    if (!selectedYear || !canManage) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      for (const period of STANDARD_PERIODS) {
        try {
          await createTimetablePeriod({
            academic_year_id: selectedYear,
            period_number: period.period_number,
            label: period.label,
            starts_at: period.starts_at,
            ends_at: period.ends_at,
            is_break: false,
            is_active: true,
          });
        } catch (error: unknown) {
          const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
          if (!["CONFLICT", "VALIDATION_ERROR"].includes(code)) {
            throw error;
          }
        }
      }

      await generateTimetableSlots({
        academic_year_id: selectedYear,
        weekdays: [1, 2, 3, 4, 5],
      });

      await loadSlots(selectedYear);
      if (viewMode === "classroom") {
        await loadClassroomTimetable(selectedYear, selectedClassroom);
      } else {
        await loadTeacherTimetable(selectedYear, selectedTeacher);
      }
      setNotice("Standard periods and weekday slots are ready.");
    } catch (err: unknown) {
      setError(firstUsefulMessage(err, "Failed to generate timetable periods and slots"));
    } finally {
      setSaving(false);
    }
  }

  async function submitEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    if (!entryForm.classroom_id || !entryForm.slot_id) {
      setError("Select Classroom and slot before creating timetable entry.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createTimetableEntry({
        classroom_id: entryForm.classroom_id,
        slot_id: entryForm.slot_id,
        subject_id: entryForm.subject_id || undefined,
        teacher_id: entryForm.teacher_id || undefined,
        entry_type: entryForm.entry_type,
        room_number: entryForm.room_number || undefined,
        notes: entryForm.notes || undefined,
      });

      if (viewMode === "classroom") {
        await loadClassroomTimetable(selectedYear, selectedClassroom);
      } else {
        await loadTeacherTimetable(selectedYear, selectedTeacher);
      }
      setNotice("Timetable entry added successfully.");
      setEntryForm((prev) => ({
        ...prev,
        notes: "",
      }));
    } catch (err: unknown) {
      setError(firstUsefulMessage(err, "Failed to create timetable entry"));
    } finally {
      setSaving(false);
    }
  }

  async function submitSubstitution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    if (!substitutionForm.timetable_entry_id || !substitutionForm.substitute_teacher_id || !substitutionForm.substitution_date) {
      setError("Select entry, substitute teacher, and substitution date.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createTimetableSubstitution({
        timetable_entry_id: substitutionForm.timetable_entry_id,
        substitute_teacher_id: substitutionForm.substitute_teacher_id,
        substitution_date: substitutionForm.substitution_date,
        reason: substitutionForm.reason || undefined,
      });
      await loadSubstitutions();
      setNotice("Substitution created successfully.");
      setSubstitutionForm({
        timetable_entry_id: "",
        substitute_teacher_id: "",
        substitution_date: "",
        reason: "",
      });
    } catch (err: unknown) {
      setError(firstUsefulMessage(err, "Failed to create substitution"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeSubstitution(substitutionId: string) {
    if (!canManage) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await revokeTimetableSubstitution(substitutionId);
      await loadSubstitutions();
      setNotice("Substitution revoked.");
    } catch (err: unknown) {
      setError(firstUsefulMessage(err, "Failed to revoke substitution"));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Timetable" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Timetable Access Required</h2>
            <p className="mt-2 text-sm text-gray-600">
              This workspace is available for School Leadership, Headmistress, and Teacher roles.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Timetable" />
      <div className="space-y-6 p-6">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        ) : null}

        <TimetableHeroCard
          title={viewMode === "classroom" ? "Classroom Timetable Builder" : "Teacher Timetable View"}
          subtitle={
            viewMode === "classroom"
              ? "Design weekly classroom schedules with conflict-safe assignment controls."
              : "Track teacher load, day-wise periods, and substitution coverage."
          }
          entryCount={scheduleEntries.length}
          slotCount={slots.length}
          substitutionCount={substitutions.length}
          accent={heroAccent}
        />

        <section className="grid grid-cols-1 gap-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:grid-cols-4">
          <div>
            <label className="label-text">Academic Year</label>
            <select
              className="input-field"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text">View</label>
            <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("classroom")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
                  viewMode === "classroom" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
                }`}
              >
                Classroom
              </button>
              <button
                type="button"
                onClick={() => setViewMode("teacher")}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${
                  viewMode === "teacher" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
                }`}
              >
                Teacher
              </button>
            </div>
          </div>

          <div>
            <label className="label-text">Classroom</label>
            <select
              className="input-field"
              value={selectedClassroom}
              onChange={(e) => {
                setSelectedClassroom(e.target.value);
                setEntryForm((prev) => ({ ...prev, classroom_id: e.target.value }));
              }}
              disabled={viewMode !== "classroom"}
            >
              {classrooms.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text">Teacher</label>
            <select
              className="input-field"
              value={selectedTeacher}
              onChange={(e) => {
                setSelectedTeacher(e.target.value);
                setEntryForm((prev) => ({ ...prev, teacher_id: e.target.value }));
              }}
              disabled={viewMode !== "teacher" && !canManage}
            >
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {canManage ? (
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Builder Actions</h3>
                <button
                  type="button"
                  onClick={bootstrapSlotsAndPeriods}
                  className="btn-secondary"
                  disabled={saving || !selectedYear}
                >
                  {saving ? "Processing..." : "Generate Standard Slots"}
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Use the quick setup to generate standard weekday timetable slots.
              </p>

              <form className="mt-4 space-y-3" onSubmit={submitEntry}>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-600">Create Entry</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label-text">Classroom</label>
                    <select
                      className="input-field"
                      value={entryForm.classroom_id}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, classroom_id: e.target.value }))}
                    >
                      {classrooms.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Slot</label>
                    <select
                      className="input-field"
                      value={entryForm.slot_id}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, slot_id: e.target.value }))}
                    >
                      <option value="">Select slot</option>
                      {slots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.day_name} • {slot.period_label} ({formatTime(slot.starts_at)}-{formatTime(slot.ends_at)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Subject</label>
                    <select
                      className="input-field"
                      value={entryForm.subject_id}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, subject_id: e.target.value }))}
                    >
                      <option value="">General Session</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Teacher</label>
                    <select
                      className="input-field"
                      value={entryForm.teacher_id}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, teacher_id: e.target.value }))}
                    >
                      <option value="">Unassigned</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Entry Type</label>
                    <select
                      className="input-field"
                      value={entryForm.entry_type}
                      onChange={(e) =>
                        setEntryForm((prev) => ({
                          ...prev,
                          entry_type: e.target.value as "teaching" | "activity" | "study_hall" | "break",
                        }))
                      }
                    >
                      <option value="teaching">Teaching</option>
                      <option value="activity">Activity</option>
                      <option value="study_hall">Study Hall</option>
                      <option value="break">Break</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Room Number</label>
                    <input
                      className="input-field"
                      value={entryForm.room_number}
                      onChange={(e) => setEntryForm((prev) => ({ ...prev, room_number: e.target.value }))}
                      placeholder="e.g. 201"
                    />
                  </div>
                </div>
                <div>
                  <label className="label-text">Notes</label>
                  <textarea
                    className="input-field min-h-[80px]"
                    value={entryForm.notes}
                    onChange={(e) => setEntryForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Optional context"
                  />
                </div>
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Add Timetable Entry"}
                </button>
              </form>
            </article>

            <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Create Substitution</h3>
              <p className="mt-1 text-sm text-gray-500">
                Assign substitute teachers for planned leave or same-day changes.
              </p>

              <form className="mt-4 space-y-3" onSubmit={submitSubstitution}>
                <div>
                  <label className="label-text">Timetable Entry</label>
                  <select
                    className="input-field"
                    value={substitutionForm.timetable_entry_id}
                    onChange={(e) =>
                      setSubstitutionForm((prev) => ({ ...prev, timetable_entry_id: e.target.value }))
                    }
                  >
                    <option value="">Select entry</option>
                    {availableEntryOptions.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-text">Substitute Teacher</label>
                  <select
                    className="input-field"
                    value={substitutionForm.substitute_teacher_id}
                    onChange={(e) =>
                      setSubstitutionForm((prev) => ({ ...prev, substitute_teacher_id: e.target.value }))
                    }
                  >
                    <option value="">Select teacher</option>
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label-text">Date</label>
                    <input
                      className="input-field"
                      type="date"
                      value={substitutionForm.substitution_date}
                      onChange={(e) =>
                        setSubstitutionForm((prev) => ({ ...prev, substitution_date: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="label-text">Reason</label>
                    <input
                      className="input-field"
                      value={substitutionForm.reason}
                      onChange={(e) => setSubstitutionForm((prev) => ({ ...prev, reason: e.target.value }))}
                      placeholder="Leave / training / emergency"
                    />
                  </div>
                </div>
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Create Substitution"}
                </button>
              </form>

              {substitutions.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick revoke</p>
                  {substitutions.slice(0, 5).map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-2">
                      <p className="text-xs text-gray-600">
                        {row.substitution_date} • {row.classroom_label || "Classroom"}
                      </p>
                      {row.is_active ? (
                        <button
                          type="button"
                          className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                          onClick={() => handleRevokeSubstitution(row.id)}
                          disabled={saving}
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Revoked</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          </section>
        ) : (
          <>
            <TimetableScheduleGrid
              title={viewMode === "classroom" ? "Classroom Weekly Grid" : "Teacher Weekly Grid"}
              subtitle={
                viewMode === "classroom"
                  ? "Period-by-period schedule with teacher, subject, and room mapping."
                  : "Teacher load distribution across weekdays and periods."
              }
              slots={slots}
              entries={scheduleEntries}
            />
            <TimetableSubstitutionsPanel rows={substitutions} />
          </>
        )}
      </div>
    </>
  );
}
