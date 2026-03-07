"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getAttendance, getStudentMarksSummary } from "@/lib/api";

interface StudentView {
  student_id: string;
  attendance_date: string;
  status: string;
}

export default function StudentsPage() {
  const { isAdmin } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [attendanceRecords, setAttendanceRecords] = useState<StudentView[]>([]);
  const [marksSummary, setMarksSummary] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"attendance" | "marks">("attendance");

  async function searchStudent() {
    if (!studentId.trim()) return;
    setLoading(true);
    try {
      if (tab === "attendance") {
        const res = await getAttendance({ student_id: studentId, page_size: "50" });
        setAttendanceRecords(res.data as StudentView[]);
        setMarksSummary(null);
      } else {
        const res = await getStudentMarksSummary(studentId);
        setMarksSummary(res.data);
        setAttendanceRecords([]);
      }
    } catch {
      setAttendanceRecords([]);
      setMarksSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (studentId) searchStudent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!isAdmin) {
    return (
      <>
        <Header title="Students" />
        <div className="p-6">
          <div className="card text-center py-12">
            <p className="text-gray-500">Only school admins can access student management.</p>
          </div>
        </div>
      </>
    );
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { present: "badge-green", absent: "badge-red", late: "badge-yellow", leave: "badge-blue" };
    return <span className={map[status] || "badge-gray"}>{status}</span>;
  };

  return (
    <>
      <Header title="Students" />
      <div className="p-6">
        <p className="text-gray-500 mb-6">Look up student records by ID</p>

        <div className="flex gap-3 mb-6">
          <input
            type="text"
            className="input-field flex-1 max-w-md"
            placeholder="Enter Student UUID"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchStudent()}
          />
          <button className="btn-primary" onClick={searchStudent} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "attendance" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            onClick={() => setTab("attendance")}
          >
            Attendance History
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "marks" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            onClick={() => setTab("marks")}
          >
            Marks Summary
          </button>
        </div>

        {tab === "attendance" && attendanceRecords.length > 0 && (
          <div className="table-container">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-gray-900">{r.attendance_date}</td>
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "marks" && marksSummary && (
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Marks Summary</h3>
            <pre className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 overflow-auto">
              {JSON.stringify(marksSummary, null, 2)}
            </pre>
          </div>
        )}

        {!loading && !attendanceRecords.length && !marksSummary && studentId && (
          <div className="card text-center py-12">
            <p className="text-gray-400">No records found. Enter a valid student UUID and search.</p>
          </div>
        )}
      </div>
    </>
  );
}
