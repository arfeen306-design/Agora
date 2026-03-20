"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getAssessments,
  createAssessment,
  bulkScores,
  downloadReportCardPdf,
  getMyReportCardHistory,
  getPeopleMyStudents,
  getLookupClassrooms,
  getLookupSubjects,
  getLookupStudents,
  type FamilyReportCardHistoryItem,
  type LookupClassroom,
  type LookupSubject,
  type LookupStudent,
  type MyLinkedStudentRecord,
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

const MARKS_MANAGE_ROLES = ["school_admin", "teacher"];
const FAMILY_VIEW_ROLES = ["parent", "student"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function assessmentTone(type: string) {
  const map: Record<string, string> = {
    quiz: "border-blue-200 bg-blue-50 text-blue-700",
    assignment: "border-emerald-200 bg-emerald-50 text-emerald-700",
    monthly: "border-amber-200 bg-amber-50 text-amber-700",
    term: "border-rose-200 bg-rose-50 text-rose-700",
    final: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return map[type] || "border-gray-200 bg-gray-50 text-gray-700";
}

function formatDisplayDate(value?: string | null) {
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
  const combined = [student.grade_label, student.section_label].filter(Boolean).join(" • ");
  return combined || student.classroom_code || "";
}

function historyStudentName(item: FamilyReportCardHistoryItem) {
  return [item.first_name, item.last_name].filter(Boolean).join(" ").trim() || item.student_code || "Student";
}

export default function MarksPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isFamilyViewer = hasAnyRole(roles, FAMILY_VIEW_ROLES);
  const canManageMarks = !isFamilyViewer && hasAnyRole(roles, MARKS_MANAGE_ROLES);

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);
  const [scoreStudents, setScoreStudents] = useState<LookupStudent[]>([]);
  const [linkedStudents, setLinkedStudents] = useState<MyLinkedStudentRecord[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [reportCards, setReportCards] = useState<FamilyReportCardHistoryItem[]>([]);
  const [reportCardSummary, setReportCardSummary] = useState({
    total_cards: 0,
    average_percentage: 0,
    latest_published_at: null as string | null,
  });
  const [reportCardsLoading, setReportCardsLoading] = useState(false);
  const [downloadingReportCardId, setDownloadingReportCardId] = useState<string | null>(null);

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
      const data = await getLookupClassrooms({ page_size: 100 });
      setClassrooms(data);
    } catch {
      setClassrooms([]);
    }
  }, []);

  const loadSubjects = useCallback(async (classroomId?: string) => {
    try {
      const data = await getLookupSubjects({
        page_size: 100,
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
        page_size: 100,
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
    if (!isFamilyViewer) return;
    async function loadLinkedStudents() {
      try {
        const students = await getPeopleMyStudents();
        setLinkedStudents(students);
        if (students.length > 0) {
          setSelectedStudentId((current) =>
            current && students.some((student) => student.id === current) ? current : students[0].id
          );
        }
      } catch {
        setLinkedStudents([]);
      }
    }
    loadLinkedStudents();
  }, [isFamilyViewer]);

  useEffect(() => {
    loadSubjects(formData.classroom_id);
  }, [formData.classroom_id, loadSubjects]);

  useEffect(() => {
    loadScoreStudents(selectedAssessment?.classroom_id);
  }, [selectedAssessment?.classroom_id, loadScoreStudents]);

  useEffect(() => {
    if (!isFamilyViewer) return;

    if (linkedStudents.length === 0) {
      setReportCards([]);
      setReportCardSummary({
        total_cards: 0,
        average_percentage: 0,
        latest_published_at: null,
      });
      return;
    }

    const resolvedStudentId =
      selectedStudentId && linkedStudents.some((student) => student.id === selectedStudentId)
        ? selectedStudentId
        : linkedStudents[0].id;

    if (resolvedStudentId !== selectedStudentId) {
      setSelectedStudentId(resolvedStudentId);
      return;
    }

    async function loadReportCards() {
      setReportCardsLoading(true);
      try {
        const res = await getMyReportCardHistory({
          student_id: resolvedStudentId,
          page: 1,
          page_size: 6,
        });
        setReportCards(res.data.items || []);
        setReportCardSummary({
          total_cards: Number(res.data.summary?.total_cards || 0),
          average_percentage: Number(res.data.summary?.average_percentage || 0),
          latest_published_at: res.data.summary?.latest_published_at || null,
        });
      } catch {
        setReportCards([]);
        setReportCardSummary({
          total_cards: 0,
          average_percentage: 0,
          latest_published_at: null,
        });
      } finally {
        setReportCardsLoading(false);
      }
    }

    loadReportCards();
  }, [isFamilyViewer, linkedStudents, selectedStudentId]);

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

  async function handleDownloadReportCard(reportCard: FamilyReportCardHistoryItem) {
    try {
      setDownloadingReportCardId(reportCard.id);
      const blob = await downloadReportCardPdf(reportCard.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportCard.student_code || "student"}-${(reportCard.exam_term_name || "report-card").replace(/\s+/g, "-").toLowerCase()}-report-card.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to download report card");
    } finally {
      setDownloadingReportCardId(null);
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

  const completedAssessments = assessments.filter((assessment) => {
    if (!assessment.assessment_date) return false;
    const date = new Date(assessment.assessment_date);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
  }).length;
  const upcomingAssessments = assessments.filter((assessment) => {
    if (!assessment.assessment_date) return false;
    const date = new Date(assessment.assessment_date);
    return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
  }).length;
  const examHeavyCount = assessments.filter((assessment) => ["monthly", "term", "final"].includes(assessment.assessment_type)).length;
  const familySelectedStudent =
    linkedStudents.find((student) => student.id === selectedStudentId) || linkedStudents[0] || null;

  return (
    <>
      <Header title="Marks & Assessments" />
      <div className={`p-6 ${isFamilyViewer ? "family-workspace" : ""}`}>
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") || message.includes("created") || message.includes("submitted") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        {isFamilyViewer && (
          <section className="mb-6 rounded-3xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 p-6 text-white shadow-lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/80">Marks & Test History</p>
                <h2 className="mt-2 text-3xl font-bold">Child Assessment Feed</h2>
                <p className="mt-2 text-sm text-white/[0.85]">
                  Families can review published assessments and test history here. Detailed score sheets appear once school marks are published.
                </p>
                {familySelectedStudent && linkedStudentClassroom(familySelectedStudent) && (
                  <p className="mt-3 text-sm text-white/90">
                    {linkedStudentName(familySelectedStudent)} • {linkedStudentClassroom(familySelectedStudent)}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FamilyAssessmentBadge label="Completed" value={completedAssessments} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
                <FamilyAssessmentBadge label="Upcoming" value={upcomingAssessments} tone="border-blue-200 bg-blue-50 text-blue-700" />
                <FamilyAssessmentBadge label="Major Exams" value={examHeavyCount} tone="border-rose-200 bg-rose-50 text-rose-700" />
              </div>
            </div>
          </section>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500">
            {canManageMarks ? "Create assessments and enter student marks" : "View assessments and marks"}
          </p>
          {isFamilyViewer && (
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Read-only child marks and test history view.
            </span>
          )}
          {canManageMarks && (
            <button className="btn-primary" onClick={() => setShowCreateForm(!showCreateForm)}>
              {showCreateForm ? "Cancel" : "Create Assessment"}
            </button>
          )}
        </div>

        {isFamilyViewer && linkedStudents.length > 1 && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <label className="text-sm font-medium text-gray-700">Viewing child</label>
            <select
              className="input-field mt-2 max-w-md"
              value={familySelectedStudent?.id || ""}
              onChange={(event) => setSelectedStudentId(event.target.value)}
            >
              {linkedStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {linkedStudentName(student)} ({student.student_code})
                </option>
              ))}
            </select>
          </div>
        )}

        {isFamilyViewer && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
            <FamilyAssessmentCard title="Completed Assessments" value={completedAssessments} hint="Assessments dated in the past." tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
            <FamilyAssessmentCard title="Upcoming Assessments" value={upcomingAssessments} hint="Tests scheduled in the future." tone="border-blue-200 bg-blue-50 text-blue-700" />
            <FamilyAssessmentCard title="Major Exams" value={examHeavyCount} hint="Monthly, term, and final exam items." tone="border-rose-200 bg-rose-50 text-rose-700" />
          </div>
        )}

        {isFamilyViewer && (
          <section className="mb-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Published Report Cards</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Term-level results already published by school. You can review history here without regenerating cards.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FamilyAssessmentBadge
                  label="Published"
                  value={reportCardSummary.total_cards}
                  tone="border-violet-200 bg-violet-50 text-violet-700"
                />
                <FamilyAssessmentBadge
                  label="Average"
                  value={Number(reportCardSummary.average_percentage || 0).toFixed(1)}
                  tone="border-blue-200 bg-blue-50 text-blue-700"
                />
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 shadow-sm">
                  <p className="text-[11px] uppercase tracking-[0.16em]">Latest Published</p>
                  <p className="mt-1 text-sm font-bold">
                    {formatDisplayDate(reportCardSummary.latest_published_at)}
                  </p>
                </div>
              </div>
            </div>

            {reportCardsLoading ? (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
                Loading published report cards...
              </div>
            ) : reportCards.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-200 p-6 text-center">
                <p className="text-sm font-medium text-gray-700">No published report cards yet.</p>
                <p className="mt-1 text-sm text-gray-500">
                  Published term cards will appear here once the school finalizes and shares them.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {reportCards.map((reportCard) => (
                  <div key={reportCard.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-lg font-semibold text-gray-900">{reportCard.exam_term_name || "Term Result"}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">
                          {reportCard.exam_term_type || "term"} • {reportCard.classroom_label || reportCard.classroom_code || "Classroom"}
                        </p>
                        {linkedStudents.length > 1 && (
                          <p className="mt-2 text-sm text-gray-600">{historyStudentName(reportCard)}</p>
                        )}
                      </div>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        Published
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Percentage</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {reportCard.percentage !== null && reportCard.percentage !== undefined
                            ? `${Number(reportCard.percentage).toFixed(1)}%`
                            : "Pending"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-gray-200 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Grade</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{reportCard.grade || "—"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Attendance</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">
                          {reportCard.attendance_rate !== null && reportCard.attendance_rate !== undefined
                            ? `${Number(reportCard.attendance_rate).toFixed(1)}%`
                            : `${reportCard.attendance_present}/${reportCard.attendance_total}`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-gray-500">
                        Published {formatDisplayDate(reportCard.published_at || reportCard.generated_at)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/marks/report-cards/${reportCard.id}`}
                          className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
                        >
                          View Details
                        </Link>
                        <button
                          className="btn-secondary"
                          onClick={() => handleDownloadReportCard(reportCard)}
                          disabled={downloadingReportCardId === reportCard.id}
                        >
                          {downloadingReportCardId === reportCard.id ? "Preparing PDF..." : "Download Report Card"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {showCreateForm && canManageMarks && (
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
        {selectedAssessment && canManageMarks && (
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

        {isFamilyViewer ? (
          <div className="grid grid-cols-1 gap-4">
            {loading ? (
              <div className="card text-center text-gray-400">Loading...</div>
            ) : assessments.length === 0 ? (
              <div className="card text-center text-gray-400">No assessments found</div>
            ) : (
              assessments.map((assessment) => (
                <div key={assessment.id} className="card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{assessment.title}</p>
                      <p className="mt-2 text-sm text-gray-600">
                        {assessment.assessment_date
                          ? `Assessment date: ${assessment.assessment_date}`
                          : "Assessment date not announced yet"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${assessmentTone(assessment.assessment_type)}`}>
                      {assessment.assessment_type}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Max Marks</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{assessment.max_marks}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Assessment Type</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{assessment.assessment_type}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Family View</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">Waiting for marks publication</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
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
                        {canManageMarks ? (
                          <button className="text-primary-600 hover:text-primary-800 text-sm font-medium" onClick={() => setSelectedAssessment(a)}>
                            Enter Scores
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

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

function FamilyAssessmentBadge({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${tone}`}>
      <p className="text-[11px] uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function FamilyAssessmentCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: number;
  hint: string;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tone}`}>
      <p className="text-xs uppercase tracking-[0.18em]">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-sm opacity-90">{hint}</p>
    </div>
  );
}
