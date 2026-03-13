"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import {
  getClassTeacherMyClassroom,
  getReportCardsConsolidated,
  type ClassTeacherConsolidatedPayload,
  type ClassTeacherExamTerm,
} from "@/lib/api";

export default function ClassTeacherResultsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [terms, setTerms] = useState<ClassTeacherExamTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [payload, setPayload] = useState<ClassTeacherConsolidatedPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setLoading(true);
      setError("");
      try {
        const classroomData = await getClassTeacherMyClassroom();
        if (cancelled) return;
        const resolvedClassroomId = classroomData.classroom?.id || "";
        setClassroomId(resolvedClassroomId);
        const termRows = classroomData.exam_terms || [];
        setTerms(termRows);
        if (termRows[0]?.id) {
          setSelectedTermId(termRows[0].id);
        } else {
          setPayload(null);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load class + term lookups");
        setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!classroomId || !selectedTermId) return;
    let cancelled = false;
    async function loadConsolidated() {
      setLoading(true);
      setError("");
      try {
        const data = await getReportCardsConsolidated({
          classroom_id: classroomId,
          exam_term_id: selectedTermId,
        });
        if (!cancelled) setPayload(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load consolidated marks");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadConsolidated();
    return () => {
      cancelled = true;
    };
  }, [classroomId, selectedTermId]);

  const subjectCount = payload?.subjects?.length || 0;
  const studentCount = payload?.summary?.student_count || 0;
  const completion = payload?.summary?.completion_percentage || 0;

  const completionTone = useMemo(() => {
    if (completion >= 80) return "text-emerald-700 bg-emerald-50 border-emerald-200";
    if (completion >= 50) return "text-amber-700 bg-amber-50 border-amber-200";
    return "text-red-700 bg-red-50 border-red-200";
  }, [completion]);

  return (
    <>
      <Header title="Class Results" />
      <div className="space-y-6 p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-500 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.25em] text-purple-100">Consolidated Marks</p>
          <h2 className="mt-3 text-2xl font-bold">Student x Subject Result Grid</h2>
          <p className="mt-2 text-sm text-purple-100">
            Review missing marks before report card generation and track assessment completion for each exam term.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div>
              <label className="label-text">Exam Term</label>
              <select
                className="input-field"
                value={selectedTermId}
                onChange={(event) => setSelectedTermId(event.target.value)}
                disabled={terms.length === 0}
              >
                {terms.length === 0 ? <option value="">No terms found</option> : null}
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} ({term.term_type})
                  </option>
                ))}
              </select>
            </div>
            <article className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Students</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{studentCount}</p>
            </article>
            <article className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Subjects</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{subjectCount}</p>
            </article>
            <article className={`rounded-lg border px-4 py-3 ${completionTone}`}>
              <p className="text-xs uppercase tracking-wide">Completion</p>
              <p className="mt-1 text-xl font-semibold">{completion}%</p>
            </article>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Student</th>
                  {payload?.subjects?.map((subject) => (
                    <th key={subject.subject_id} className="px-4 py-3">
                      {subject.subject_code || subject.subject_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={Math.max(2, subjectCount + 1)} className="px-4 py-6 text-center text-gray-500">
                      Loading consolidated marks...
                    </td>
                  </tr>
                ) : !payload || payload.students.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(2, subjectCount + 1)} className="px-4 py-6 text-center text-gray-500">
                      No marks available for the selected term.
                    </td>
                  </tr>
                ) : (
                  payload.students.map((student) => (
                    <tr key={student.student_id} className="border-b border-gray-100 align-top">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {student.full_name}
                        <p className="text-xs text-gray-500">Roll #{student.roll_no || "-"}</p>
                      </td>
                      {student.subjects.map((subject) => (
                        <td key={subject.subject_id} className="px-4 py-3">
                          <div className="text-sm font-semibold text-gray-900">
                            {subject.marks_obtained}/{subject.max_marks}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {subject.percentage !== null && subject.percentage !== undefined ? `${subject.percentage}%` : "-"}
                          </div>
                          <div
                            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              subject.is_complete
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {subject.is_complete ? "Complete" : "Missing"}
                          </div>
                        </td>
                      ))}
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
