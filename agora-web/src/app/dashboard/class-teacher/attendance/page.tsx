"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { getClassTeacherMyClassroom, getClassTeacherStudents, markAttendanceBulk, type ClassTeacherStudentRow } from "@/lib/api";

type AttendanceStatus = "present" | "absent" | "late" | "leave";

const STATUS_OPTIONS: AttendanceStatus[] = ["present", "absent", "late", "leave"];

const ACTIVE_BUTTON_CLASS: Record<AttendanceStatus, string> = {
  present: "border-emerald-500 bg-emerald-100 text-emerald-700",
  absent: "border-red-500 bg-red-100 text-red-700",
  late: "border-amber-500 bg-amber-100 text-amber-700",
  leave: "border-blue-500 bg-blue-100 text-blue-700",
};

export default function ClassTeacherAttendancePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState<ClassTeacherStudentRow[]>([]);
  const [entries, setEntries] = useState<Record<string, AttendanceStatus>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [classroomData, studentsData] = await Promise.all([
          getClassTeacherMyClassroom(),
          getClassTeacherStudents(),
        ]);
        if (cancelled) return;
        setClassroomId(classroomData.classroom?.id || "");
        setStudents(studentsData);
        const seededEntries: Record<string, AttendanceStatus> = {};
        studentsData.forEach((row) => {
          seededEntries[row.id] = "present";
        });
        setEntries(seededEntries);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load attendance list");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const aggregate: Record<AttendanceStatus, number> = {
      present: 0,
      absent: 0,
      late: 0,
      leave: 0,
    };
    Object.values(entries).forEach((status) => {
      aggregate[status] += 1;
    });
    return aggregate;
  }, [entries]);

  function setAll(status: AttendanceStatus) {
    const next: Record<string, AttendanceStatus> = {};
    students.forEach((student) => {
      next[student.id] = status;
    });
    setEntries(next);
  }

  async function saveAttendance() {
    if (!classroomId) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await markAttendanceBulk({
        classroom_id: classroomId,
        attendance_date: date,
        entries: students.map((student) => ({
          student_id: student.id,
          status: entries[student.id] || "present",
        })),
      });
      setNotice("Attendance saved successfully.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Class Attendance" />
      <div className="space-y-6 p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-600 to-teal-500 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-100">Attendance</p>
          <h2 className="mt-3 text-2xl font-bold">Daily Class Register</h2>
          <p className="mt-2 text-sm text-emerald-100">
            Mark today&apos;s student attendance. Parent and student dashboards update from these entries.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label-text">Attendance Date</label>
              <input
                type="date"
                className="input-field"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={loading || saving}
              />
            </div>
            <button type="button" className="btn-secondary" onClick={() => setAll("present")} disabled={loading || saving}>
              Set All Present
            </button>
            <button type="button" className="btn-secondary" onClick={() => setAll("absent")} disabled={loading || saving}>
              Set All Absent
            </button>
            <button type="button" className="btn-primary" onClick={saveAttendance} disabled={loading || saving || students.length === 0}>
              {saving ? "Saving..." : "Save Attendance"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Present: {totals.present}</div>
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Absent: {totals.absent}</div>
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">Late: {totals.late}</div>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">Leave: {totals.leave}</div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Roll No</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                      Loading students...
                    </td>
                  </tr>
                ) : students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                      No active students found in your class.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => (
                    <tr key={student.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 text-gray-600">{student.roll_no ?? "-"}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {student.first_name} {student.last_name || ""}
                        <p className="text-xs text-gray-500">{student.student_code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {STATUS_OPTIONS.map((status) => {
                            const active = (entries[student.id] || "present") === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  active ? ACTIVE_BUTTON_CLASS[status] : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                                }`}
                                onClick={() =>
                                  setEntries((prev) => ({
                                    ...prev,
                                    [student.id]: status,
                                  }))
                                }
                                disabled={saving}
                              >
                                {status}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
