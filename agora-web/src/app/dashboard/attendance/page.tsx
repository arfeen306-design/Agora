"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getAttendance,
  markAttendanceBulk,
  getLookupClassrooms,
  getLookupStudents,
  type LookupClassroom,
  type LookupStudent,
} from "@/lib/api";

interface AttendanceRecord {
  id: string;
  student_id: string;
  classroom_id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  source: string;
  note: string | null;
}

interface BulkEntry {
  student_id: string;
  name: string;
  status: "present" | "absent" | "late" | "leave";
}

const ATTENDANCE_MANAGE_ROLES = ["school_admin", "teacher"];
const FAMILY_VIEW_ROLES = ["parent", "student"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function attendanceTone(status: string) {
  const normalized = String(status || "").toLowerCase();
  const map: Record<string, string> = {
    present: "border-emerald-200 bg-emerald-50 text-emerald-700",
    absent: "border-rose-200 bg-rose-50 text-rose-700",
    late: "border-amber-200 bg-amber-50 text-amber-700",
    leave: "border-blue-200 bg-blue-50 text-blue-700",
  };
  return map[normalized] || "border-gray-200 bg-gray-50 text-gray-700";
}

export default function AttendancePage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isFamilyViewer = hasAnyRole(roles, FAMILY_VIEW_ROLES);
  const canManageAttendance = !isFamilyViewer && hasAnyRole(roles, ATTENDANCE_MANAGE_ROLES);

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [classroomFilter, setClassroomFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);

  // Bulk marking state
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkClassroom, setBulkClassroom] = useState("");
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().split("T")[0]);
  const [bulkEntries, setBulkEntries] = useState<BulkEntry[]>([]);
  const [bulkStudents, setBulkStudents] = useState<LookupStudent[]>([]);
  const [bulkStudentId, setBulkStudentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadClassrooms = useCallback(async () => {
    try {
      const data = await getLookupClassrooms({ page_size: 200 });
      setClassrooms(data);
    } catch {
      setClassrooms([]);
    }
  }, []);

  const loadBulkStudents = useCallback(async (classroomId: string) => {
    if (!classroomId) {
      setBulkStudents([]);
      return;
    }
    try {
      const data = await getLookupStudents({ classroom_id: classroomId, page_size: 200 });
      setBulkStudents(data);
    } catch {
      setBulkStudents([]);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: "20",
      };
      if (dateFilter) params.date_from = dateFilter;
      if (dateFilter) params.date_to = dateFilter;
      if (classroomFilter) params.classroom_id = classroomFilter;

      const res = await getAttendance(params);
      setRecords(res.data as AttendanceRecord[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [page, dateFilter, classroomFilter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    loadBulkStudents(bulkClassroom);
  }, [bulkClassroom, loadBulkStudents]);

  function addBulkEntry() {
    if (!bulkStudentId) return;
    const selectedStudent = bulkStudents.find((s) => s.id === bulkStudentId);
    if (!selectedStudent) return;
    if (bulkEntries.some((entry) => entry.student_id === bulkStudentId)) return;

    setBulkEntries([...bulkEntries, {
      student_id: selectedStudent.id,
      name: selectedStudent.label,
      status: "present",
    }]);
    setBulkStudentId("");
  }

  function updateEntryStatus(index: number, status: BulkEntry["status"]) {
    const updated = [...bulkEntries];
    updated[index].status = status;
    setBulkEntries(updated);
  }

  function removeEntry(index: number) {
    setBulkEntries(bulkEntries.filter((_, i) => i !== index));
  }

  async function submitBulk() {
    if (!bulkClassroom || bulkEntries.length === 0) return;
    setSubmitting(true);
    setMessage("");
    try {
      await markAttendanceBulk({
        classroom_id: bulkClassroom,
        attendance_date: bulkDate,
        entries: bulkEntries.map((e) => ({ student_id: e.student_id, status: e.status })),
      });
      setMessage("Attendance marked successfully!");
      setBulkEntries([]);
      setShowBulkForm(false);
      loadRecords();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to mark attendance");
    } finally {
      setSubmitting(false);
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      present: "badge-green",
      absent: "badge-red",
      late: "badge-yellow",
      leave: "badge-blue",
    };
    return <span className={map[status] || "badge-gray"}>{status}</span>;
  };

  const attendanceSummary = records.reduce(
    (summary, record) => {
      const key = String(record.status || "").toLowerCase();
      if (key === "present") summary.present += 1;
      else if (key === "absent") summary.absent += 1;
      else if (key === "late") summary.late += 1;
      else if (key === "leave") summary.leave += 1;
      return summary;
    },
    { present: 0, absent: 0, late: 0, leave: 0 }
  );

  const familyStatus = records[0]?.status ? String(records[0].status).toUpperCase() : "NOT MARKED";

  return (
    <>
      <Header title="Attendance" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        {isFamilyViewer && (
          <section className="mb-6 rounded-3xl bg-gradient-to-r from-emerald-600 via-green-600 to-cyan-500 p-6 text-white shadow-lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/80">Attendance Status</p>
                <h2 className="mt-2 text-3xl font-bold">Child Attendance View</h2>
                <p className="mt-2 text-sm text-white/85">
                  This page is read-only for families. Attendance is updated by the class teacher and school staff.
                </p>
              </div>
              <div className={`rounded-2xl border px-4 py-3 shadow-sm ${attendanceTone(familyStatus)}`}>
                <p className="text-[11px] uppercase tracking-[0.16em]">Latest Status</p>
                <p className="mt-1 text-xl font-bold">{familyStatus}</p>
              </div>
            </div>
          </section>
        )}

        {/* Filters & Actions */}
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div>
            <label className="label-text">Date</label>
            <input
              type="date"
              className="input-field"
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
            />
          </div>
          {!isFamilyViewer && (
            <div>
              <label className="label-text">Classroom</label>
              <select
                className="input-field"
                value={classroomFilter}
                onChange={(e) => {
                  setClassroomFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All classrooms</option>
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {isFamilyViewer && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Read-only child attendance view. Attendance can only be marked by school staff.
            </div>
          )}
          {canManageAttendance && (
            <button className="btn-primary" onClick={() => setShowBulkForm(!showBulkForm)}>
              {showBulkForm ? "Cancel" : "Mark Attendance"}
            </button>
          )}
        </div>

        {isFamilyViewer && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 mb-6">
            <FamilyAttendanceCard title="Present" value={attendanceSummary.present} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
            <FamilyAttendanceCard title="Late" value={attendanceSummary.late} tone="border-amber-200 bg-amber-50 text-amber-700" />
            <FamilyAttendanceCard title="Absent" value={attendanceSummary.absent} tone="border-rose-200 bg-rose-50 text-rose-700" />
            <FamilyAttendanceCard title="Leave" value={attendanceSummary.leave} tone="border-blue-200 bg-blue-50 text-blue-700" />
          </div>
        )}

        {/* Bulk Form */}
        {showBulkForm && canManageAttendance && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">Bulk Mark Attendance</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label-text">Classroom</label>
                <select
                  className="input-field"
                  value={bulkClassroom}
                  onChange={(e) => setBulkClassroom(e.target.value)}
                >
                  <option value="">Select classroom</option>
                  {classrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>
                      {classroom.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-text">Date</label>
                <input type="date" className="input-field" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <select
                className="input-field flex-1"
                value={bulkStudentId}
                onChange={(e) => setBulkStudentId(e.target.value)}
                disabled={!bulkClassroom}
              >
                <option value="">{bulkClassroom ? "Select student" : "Select classroom first"}</option>
                {bulkStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.label} ({student.student_code})
                  </option>
                ))}
              </select>
              <button className="btn-secondary" onClick={addBulkEntry}>Add</button>
            </div>

            {bulkEntries.length > 0 && (
              <div className="table-container mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Student</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkEntries.map((entry, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-4 py-3 font-medium text-gray-900">{entry.name}</td>
                        <td className="px-4 py-3">
                          <select
                            className="input-field w-auto"
                            value={entry.status}
                            onChange={(e) => updateEntryStatus(i, e.target.value as BulkEntry["status"])}
                          >
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="late">Late</option>
                            <option value="leave">Leave</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-red-500 hover:text-red-700 text-sm" onClick={() => removeEntry(i)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button className="btn-primary" onClick={submitBulk} disabled={submitting || bulkEntries.length === 0}>
              {submitting ? "Submitting..." : `Submit (${bulkEntries.length} students)`}
            </button>
          </div>
        )}

        {/* Records Table */}
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                {!isFamilyViewer && <th className="px-4 py-3 text-left font-medium text-gray-500">Student ID</th>}
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                {!isFamilyViewer && <th className="px-4 py-3 text-left font-medium text-gray-500">Source</th>}
                <th className="px-4 py-3 text-left font-medium text-gray-500">Check-in</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Note</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isFamilyViewer ? 4 : 6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={isFamilyViewer ? 4 : 6} className="px-4 py-8 text-center text-gray-400">No attendance records found</td></tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{r.attendance_date}</td>
                    {!isFamilyViewer && <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.student_id.slice(0, 8)}...</td>}
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                    {!isFamilyViewer && <td className="px-4 py-3 text-gray-600">{r.source}</td>}
                    <td className="px-4 py-3 text-gray-600">{r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.note || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FamilyAttendanceCard({ title, value, tone }: { title: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tone}`}>
      <p className="text-xs uppercase tracking-[0.18em]">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}
