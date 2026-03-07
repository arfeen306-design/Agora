"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getAttendance,
  getLookupStudents,
  getStudentMarksSummary,
  type LookupStudent,
} from "@/lib/api";

interface StudentView {
  student_id: string;
  attendance_date: string;
  status: string;
}

type SortColumn = "attendance_date" | "status";

const STORAGE_KEY = "agora_web_students_state_v1";

export default function StudentsPage() {
  const { isAdmin } = useAuth();

  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [studentSearchInput, setStudentSearchInput] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [attendanceRecords, setAttendanceRecords] = useState<StudentView[]>([]);
  const [marksSummary, setMarksSummary] = useState<Record<string, unknown> | null>(null);

  const [recordSearchInput, setRecordSearchInput] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("attendance_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"attendance" | "marks">("attendance");
  const [hydrated, setHydrated] = useState(false);

  const loadStudents = useCallback(async () => {
    try {
      const data = await getLookupStudents({
        page_size: 200,
        ...(studentSearch.trim() ? { search: studentSearch.trim() } : {}),
      });
      setStudents(data);
    } catch {
      setStudents([]);
    }
  }, [studentSearch]);

  const searchStudent = useCallback(async () => {
    if (!selectedStudentId) {
      setAttendanceRecords([]);
      setMarksSummary(null);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      if (tab === "attendance") {
        const res = await getAttendance({ student_id: selectedStudentId, page_size: "50" });
        setAttendanceRecords(res.data as StudentView[]);
        setMarksSummary(null);
      } else {
        const res = await getStudentMarksSummary(selectedStudentId);
        setMarksSummary((res.data || null) as Record<string, unknown> | null);
        setAttendanceRecords([]);
      }
    } catch (err: unknown) {
      setAttendanceRecords([]);
      setMarksSummary(null);
      setMessage(err instanceof Error ? err.message : "Failed to load student records");
    } finally {
      setLoading(false);
    }
  }, [selectedStudentId, tab]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          selectedStudentId?: string;
          studentSearchInput?: string;
          recordSearchInput?: string;
          tab?: "attendance" | "marks";
          sortBy?: SortColumn;
          sortDir?: "asc" | "desc";
        };

        if (parsed.selectedStudentId !== undefined) setSelectedStudentId(parsed.selectedStudentId);
        if (parsed.studentSearchInput !== undefined) {
          setStudentSearchInput(parsed.studentSearchInput);
          setStudentSearch(parsed.studentSearchInput);
        }
        if (parsed.recordSearchInput !== undefined) {
          setRecordSearchInput(parsed.recordSearchInput);
          setRecordSearch(parsed.recordSearchInput);
        }
        if (parsed.tab) setTab(parsed.tab);
        if (parsed.sortBy) setSortBy(parsed.sortBy);
        if (parsed.sortDir) setSortDir(parsed.sortDir);
      }
    } catch {
      // ignore bad localStorage payload
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStudentSearch(studentSearchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [studentSearchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecordSearch(recordSearchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [recordSearchInput]);

  useEffect(() => {
    if (!hydrated) return;
    loadStudents();
  }, [hydrated, loadStudents]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedStudentId,
        studentSearchInput,
        recordSearchInput,
        tab,
        sortBy,
        sortDir,
      })
    );
  }, [hydrated, selectedStudentId, studentSearchInput, recordSearchInput, tab, sortBy, sortDir]);

  useEffect(() => {
    if (!hydrated || !selectedStudentId) return;
    searchStudent();
  }, [hydrated, selectedStudentId, tab, searchStudent]);

  function toggleSort(column: SortColumn) {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir(column === "attendance_date" ? "desc" : "asc");
  }

  function sortIndicator(column: SortColumn) {
    if (sortBy !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  function sortHeaderClass(column: SortColumn) {
    return `inline-flex items-center gap-2 transition-colors ${
      sortBy === column ? "text-primary-700 font-semibold" : "text-gray-500 hover:text-gray-700"
    }`;
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

  const viewAttendanceRecords = useMemo(() => {
    const q = recordSearch.trim().toLowerCase();
    const filtered = q
      ? attendanceRecords.filter((item) =>
          [item.attendance_date, item.status, item.student_id].join(" ").toLowerCase().includes(q)
        )
      : attendanceRecords;

    return [...filtered].sort((a, b) => {
      if (sortBy === "attendance_date") {
        const cmp = new Date(a.attendance_date).toISOString().localeCompare(new Date(b.attendance_date).toISOString());
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [attendanceRecords, recordSearch, sortBy, sortDir]);

  if (!isAdmin) {
    return (
      <>
        <Header title="Students" />
        <div className="p-6">
          <div className="card py-12 text-center">
            <p className="text-gray-500">Only school admins can access student management.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Students" />
      <div className="p-6">
        {message && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        <p className="mb-6 text-gray-500">Student record explorer with saved filters and fast lookup.</p>

        <div className="card mb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="label-text">Find Student (debounced)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Search by name/code"
                value={studentSearchInput}
                onChange={(e) => setStudentSearchInput(e.target.value)}
              />
            </div>

            <div>
              <label className="label-text">Student</label>
              <select
                className="input-field"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                <option value="">Select student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button className="btn-primary w-full" onClick={searchStudent} disabled={loading || !selectedStudentId}>
                {loading ? "Searching..." : "Search"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setSelectedStudentId("");
                  setAttendanceRecords([]);
                  setMarksSummary(null);
                  setRecordSearchInput("");
                  setRecordSearch("");
                  setMessage("");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="mb-2 text-sm text-gray-500">
          Selected: <strong>{students.find((s) => s.id === selectedStudentId)?.label || "None"}</strong>
        </div>

        <div className="mb-6 flex gap-1 border-b border-gray-200">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "attendance"
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setTab("attendance")}
          >
            Attendance History
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "marks"
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setTab("marks")}
          >
            Marks Summary
          </button>
        </div>

        {tab === "attendance" && selectedStudentId && (
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label-text">Search records (debounced)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Search date/status"
                value={recordSearchInput}
                onChange={(e) => setRecordSearchInput(e.target.value)}
              />
            </div>
            <div className="flex items-end text-sm text-gray-500">Click headers to sort.</div>
          </div>
        )}

        {tab === "attendance" && selectedStudentId && (
          <div className="mb-4 text-sm text-gray-500">
            Showing <strong>{viewAttendanceRecords.length}</strong> attendance record(s).
          </div>
        )}

        {tab === "attendance" && viewAttendanceRecords.length > 0 && (
          <div className="table-container">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    <button className={sortHeaderClass("attendance_date")} onClick={() => toggleSort("attendance_date")}>
                      Date <span className="text-xs">{sortIndicator("attendance_date")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">
                    <button className={sortHeaderClass("status")} onClick={() => toggleSort("status")}>
                      Status <span className="text-xs">{sortIndicator("status")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {viewAttendanceRecords.map((record, index) => (
                  <tr key={`${record.student_id}-${record.attendance_date}-${index}`} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-900">{record.attendance_date}</td>
                    <td className="px-4 py-3">{statusBadge(record.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "marks" && marksSummary && (
          <div className="card">
            <h3 className="mb-3 text-lg font-semibold">Marks Summary</h3>
            <pre className="overflow-auto rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
              {JSON.stringify(marksSummary, null, 2)}
            </pre>
          </div>
        )}

        {!loading && !viewAttendanceRecords.length && !marksSummary && selectedStudentId && (
          <div className="card py-12 text-center">
            <p className="text-gray-400">No records found for the selected student.</p>
          </div>
        )}

        {!selectedStudentId && (
          <div className="card py-12 text-center">
            <p className="text-gray-400">Select a student to view attendance or marks summary.</p>
          </div>
        )}
      </div>
    </>
  );
}
