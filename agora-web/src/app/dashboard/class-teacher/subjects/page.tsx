"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import {
  assignClassTeacherSubjectTeacher,
  getClassTeacherMyClassroom,
  getClassTeacherSubjectTeachers,
  getLookupSubjects,
  getPeopleStaff,
  removeClassTeacherSubjectTeacher,
  type LookupSubject,
  type StaffMember,
} from "@/lib/api";

interface SubjectTeacherRow {
  classroom_subject_id: string;
  subject_id: string;
  subject_name: string;
  subject_code?: string | null;
  teacher_id?: string | null;
  teacher_user_id?: string | null;
  teacher_first_name?: string | null;
  teacher_last_name?: string | null;
  teacher_designation?: string | null;
  teacher_employee_code?: string | null;
}

export default function ClassTeacherSubjectsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classroomId, setClassroomId] = useState("");

  const [subjectRows, setSubjectRows] = useState<SubjectTeacherRow[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<LookupSubject[]>([]);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);

  const [subjectId, setSubjectId] = useState("");
  const [teacherUserId, setTeacherUserId] = useState("");

  const teacherOptions = useMemo(
    () =>
      teachers.filter((row) => row.staff_type === "teacher" && row.employment_status === "active" && row.user_id),
    [teachers]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const classroomData = await getClassTeacherMyClassroom();
      const resolvedClassroomId = classroomData.classroom?.id || "";
      setClassroomId(resolvedClassroomId);

      const [assignedRows, staffResponse, lookupSubjects] = await Promise.all([
        getClassTeacherSubjectTeachers(),
        getPeopleStaff({ page_size: "100", staff_type: "teacher", employment_status: "active" }),
        resolvedClassroomId ? getLookupSubjects({ classroom_id: resolvedClassroomId, page_size: 100 }) : Promise.resolve([]),
      ]);
      setSubjectRows(assignedRows as SubjectTeacherRow[]);
      setTeachers(staffResponse.data || []);
      setAvailableSubjects(lookupSubjects);

      if (lookupSubjects.length > 0) setSubjectId((prev) => prev || lookupSubjects[0].id);
      if ((staffResponse.data || []).length > 0) {
        const teacher = (staffResponse.data || []).find((row) => row.user_id);
        if (teacher?.user_id) setTeacherUserId((prev) => prev || teacher.user_id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load subject assignment data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveAssignment() {
    if (!subjectId || !teacherUserId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await assignClassTeacherSubjectTeacher({
        subject_id: subjectId,
        teacher_user_id: teacherUserId,
      });
      setNotice("Subject teacher assignment updated.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign subject teacher");
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(classroomSubjectId: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await removeClassTeacherSubjectTeacher(classroomSubjectId);
      setNotice("Subject assignment removed.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove assignment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Class Subjects" />
      <div className="space-y-6 p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.25em] text-blue-100">Subject Allocation</p>
          <h2 className="mt-3 text-2xl font-bold">Subject-Teacher Assignment</h2>
          <p className="mt-2 text-sm text-blue-100">
            Assign subject teachers for your class and keep ownership clear for marks entry and report cards.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Assign Teacher</h3>
          {!classroomId ? (
            <p className="mt-2 text-sm text-gray-600">No homeroom classroom found for your account.</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="label-text">Subject</label>
                <select className="input-field" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                  {availableSubjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-text">Teacher</label>
                <select className="input-field" value={teacherUserId} onChange={(event) => setTeacherUserId(event.target.value)}>
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.user_id}>
                      {teacher.first_name} {teacher.last_name || ""} ({teacher.staff_code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={saveAssignment}
                  disabled={saving || loading || !subjectId || !teacherUserId}
                >
                  {saving ? "Saving..." : "Save Assignment"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-lg font-semibold text-gray-900">Current Assignments</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                      Loading assignments...
                    </td>
                  </tr>
                ) : subjectRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                      No subject assignments found.
                    </td>
                  </tr>
                ) : (
                  subjectRows.map((row) => (
                    <tr key={row.classroom_subject_id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {row.subject_name}
                        {row.subject_code ? <p className="text-xs text-gray-500">{row.subject_code}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {row.teacher_first_name || "-"} {row.teacher_last_name || ""}
                        {row.teacher_employee_code ? (
                          <p className="text-xs text-gray-500">{row.teacher_employee_code}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.teacher_designation || "-"}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => removeAssignment(row.classroom_subject_id)}
                          disabled={saving}
                        >
                          Remove
                        </button>
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
