"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import {
  getAssessments,
  createAssessment,
  bulkScores,
  getLookupClassrooms,
  getLookupSubjects,
  getLookupStudents,
  type LookupClassroom,
  type LookupSubject,
  type LookupStudent,
} from "@/lib/api";

interface Assessment {
  id: string;
  classroom_id: string;
  subject_id: string | null;
  title: string;
  assessment_type: string;
  max_marks: number;
  assessment_date: string | null;
}

interface ScoreEntry {
  student_id: string;
  marks_obtained: number;
  remarks: string;
}

export default function MarksPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);
  const [scoreStudents, setScoreStudents] = useState<LookupStudent[]>([]);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    classroom_id: "",
    subject_id: "",
    title: "",
    assessment_type: "quiz",
    max_marks: "100",
    assessment_date: "",
  });

  // Score entry
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [newScore, setNewScore] = useState({ student_id: "", marks: "", remarks: "" });

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

  const loadSubjects = useCallback(async (classroomId?: string) => {
    try {
      const data = await getLookupSubjects({
        page_size: 200,
        classroom_id: classroomId || undefined,
      });
      setSubjects(data);
    } catch {
      setSubjects([]);
    }
  }, []);

  const loadScoreStudents = useCallback(async (classroomId?: string) => {
    if (!classroomId) {
      setScoreStudents([]);
      return;
    }
    try {
      const data = await getLookupStudents({
        classroom_id: classroomId,
        page_size: 200,
      });
      setScoreStudents(data);
    } catch {
      setScoreStudents([]);
    }
  }, []);

  const loadAssessments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAssessments({ page: String(page), page_size: "20" });
      setAssessments(res.data as Assessment[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch {
      setAssessments([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadAssessments();
  }, [loadAssessments]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    loadSubjects(formData.classroom_id);
  }, [formData.classroom_id, loadSubjects]);

  useEffect(() => {
    loadScoreStudents(selectedAssessment?.classroom_id);
  }, [selectedAssessment?.classroom_id, loadScoreStudents]);

  async function handleCreate() {
    if (!formData.classroom_id || !formData.title) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createAssessment({
        classroom_id: formData.classroom_id,
        subject_id: formData.subject_id || undefined,
        title: formData.title,
        assessment_type: formData.assessment_type,
        max_marks: Number(formData.max_marks),
        assessment_date: formData.assessment_date || undefined,
      });
      setMessage("Assessment created!");
      setFormData({ classroom_id: "", subject_id: "", title: "", assessment_type: "quiz", max_marks: "100", assessment_date: "" });
      setShowCreateForm(false);
      loadAssessments();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create assessment");
    } finally {
      setSubmitting(false);
    }
  }

  function addScore() {
    if (!newScore.student_id || !newScore.marks) return;
    if (scores.some((s) => s.student_id === newScore.student_id)) return;
    setScores([...scores, {
      student_id: newScore.student_id,
      marks_obtained: Number(newScore.marks),
      remarks: newScore.remarks,
    }]);
    setNewScore({ student_id: "", marks: "", remarks: "" });
  }

  async function submitScores() {
    if (!selectedAssessment || scores.length === 0) return;
    setSubmitting(true);
    setMessage("");
    try {
      await bulkScores(selectedAssessment.id, scores);
      setMessage("Scores submitted!");
      setScores([]);
      setSelectedAssessment(null);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to submit scores");
    } finally {
      setSubmitting(false);
    }
  }

  const typeBadge = (type: string) => {
    const map: Record<string, string> = {
      quiz: "badge-blue",
      assignment: "badge-green",
      monthly: "badge-yellow",
      term: "badge-red",
      final: "badge-red",
    };
    return <span className={map[type] || "badge-gray"}>{type}</span>;
  };

  return (
    <>
      <Header title="Marks & Assessments" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") || message.includes("created") || message.includes("submitted") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500">Create assessments and enter student marks</p>
          <button className="btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? "Cancel" : "Create Assessment"}
          </button>
        </div>

        {showCreateForm && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">New Assessment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label-text">Classroom *</label>
                <select
                  className="input-field"
                  value={formData.classroom_id}
                  onChange={(e) => setFormData({ ...formData, classroom_id: e.target.value, subject_id: "" })}
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
                <label className="label-text">Subject</label>
                <select
                  className="input-field"
                  value={formData.subject_id}
                  onChange={(e) => setFormData({ ...formData, subject_id: e.target.value })}
                  disabled={!formData.classroom_id}
                >
                  <option value="">{formData.classroom_id ? "Optional subject" : "Select classroom first"}</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-text">Type</label>
                <select className="input-field" value={formData.assessment_type} onChange={(e) => setFormData({ ...formData, assessment_type: e.target.value })}>
                  <option value="quiz">Quiz</option>
                  <option value="assignment">Assignment</option>
                  <option value="monthly">Monthly</option>
                  <option value="term">Term</option>
                  <option value="final">Final</option>
                </select>
              </div>
              <div>
                <label className="label-text">Title *</label>
                <input type="text" className="input-field" placeholder="Assessment title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div>
                <label className="label-text">Max Marks</label>
                <input type="number" className="input-field" value={formData.max_marks} onChange={(e) => setFormData({ ...formData, max_marks: e.target.value })} />
              </div>
              <div>
                <label className="label-text">Date</label>
                <input type="date" className="input-field" value={formData.assessment_date} onChange={(e) => setFormData({ ...formData, assessment_date: e.target.value })} />
              </div>
            </div>
            <button className="btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Assessment"}
            </button>
          </div>
        )}

        {/* Score entry panel */}
        {selectedAssessment && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Enter Scores: {selectedAssessment.title} (Max: {selectedAssessment.max_marks})</h3>
              <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedAssessment(null); setScores([]); }}>Close</button>
            </div>
            <div className="flex gap-2 mb-4">
              <select
                className="input-field flex-1"
                value={newScore.student_id}
                onChange={(e) => setNewScore({ ...newScore, student_id: e.target.value })}
              >
                <option value="">Select student</option>
                {scoreStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.label} ({student.student_code})
                  </option>
                ))}
              </select>
              <input type="number" className="input-field w-28" placeholder="Marks" max={selectedAssessment.max_marks} value={newScore.marks} onChange={(e) => setNewScore({ ...newScore, marks: e.target.value })} />
              <input type="text" className="input-field flex-1" placeholder="Remarks (optional)" value={newScore.remarks} onChange={(e) => setNewScore({ ...newScore, remarks: e.target.value })} />
              <button className="btn-secondary" onClick={addScore}>Add</button>
            </div>
            {scores.length > 0 && (
              <>
                <div className="table-container mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-4 py-3 text-left font-medium text-gray-500">Student</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500">Marks</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500">Remarks</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scores.map((s, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.student_id.slice(0, 8)}...</td>
                          <td className="px-4 py-3 font-semibold">{s.marks_obtained} / {selectedAssessment.max_marks}</td>
                          <td className="px-4 py-3 text-gray-600">{s.remarks || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <button className="text-red-500 hover:text-red-700 text-sm" onClick={() => setScores(scores.filter((_, idx) => idx !== i))}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="btn-primary" onClick={submitScores} disabled={submitting}>
                  {submitting ? "Submitting..." : `Submit ${scores.length} Scores`}
                </button>
              </>
            )}
          </div>
        )}

        {/* Assessments Table */}
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Max Marks</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : assessments.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No assessments found</td></tr>
              ) : (
                assessments.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.title}</td>
                    <td className="px-4 py-3">{typeBadge(a.assessment_type)}</td>
                    <td className="px-4 py-3 text-gray-600">{a.max_marks}</td>
                    <td className="px-4 py-3 text-gray-600">{a.assessment_date || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-primary-600 hover:text-primary-800 text-sm font-medium" onClick={() => setSelectedAssessment(a)}>Enter Scores</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

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
