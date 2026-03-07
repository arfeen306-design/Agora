"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { getAttendance, markAttendanceBulk } from "@/lib/api";

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

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [classroomFilter, setClassroomFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Bulk marking state
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkClassroom, setBulkClassroom] = useState("");
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().split("T")[0]);
  const [bulkEntries, setBulkEntries] = useState<BulkEntry[]>([]);
  const [bulkStudentId, setBulkStudentId] = useState("");
  const [bulkStudentName, setBulkStudentName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

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

  function addBulkEntry() {
    if (!bulkStudentId.trim()) return;
    setBulkEntries([...bulkEntries, {
      student_id: bulkStudentId.trim(),
      name: bulkStudentName.trim() || bulkStudentId.trim(),
      status: "present",
    }]);
    setBulkStudentId("");
    setBulkStudentName("");
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

  return (
    <>
      <Header title="Attendance" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
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
          <div>
            <label className="label-text">Classroom ID</label>
            <input
              type="text"
              className="input-field"
              placeholder="Filter by classroom"
              value={classroomFilter}
              onChange={(e) => { setClassroomFilter(e.target.value); setPage(1); }}
            />
          </div>
          <button className="btn-primary" onClick={() => setShowBulkForm(!showBulkForm)}>
            {showBulkForm ? "Cancel" : "Mark Attendance"}
          </button>
        </div>

        {/* Bulk Form */}
        {showBulkForm && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">Bulk Mark Attendance</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label-text">Classroom ID</label>
                <input type="text" className="input-field" value={bulkClassroom} onChange={(e) => setBulkClassroom(e.target.value)} placeholder="Paste classroom UUID" />
              </div>
              <div>
                <label className="label-text">Date</label>
                <input type="date" className="input-field" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <input type="text" className="input-field flex-1" placeholder="Student UUID" value={bulkStudentId} onChange={(e) => setBulkStudentId(e.target.value)} />
              <input type="text" className="input-field flex-1" placeholder="Student name (optional)" value={bulkStudentName} onChange={(e) => setBulkStudentName(e.target.value)} />
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
                <th className="px-4 py-3 text-left font-medium text-gray-500">Student ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Source</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Check-in</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Note</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No attendance records found</td></tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{r.attendance_date}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.student_id.slice(0, 8)}...</td>
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                    <td className="px-4 py-3 text-gray-600">{r.source}</td>
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
