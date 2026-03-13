"use client";

import { useCallback, useEffect, useState } from "react";

import Header from "@/components/Header";
import {
  createExamTerm,
  deleteExamTerm,
  getExamTerms,
  getLookupAcademicYears,
  updateExamTerm,
  type ClassTeacherExamTerm,
} from "@/lib/api";

interface AcademicYearOption {
  id: string;
  name: string;
  is_current: boolean;
  label?: string;
}

export default function ExamTermsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [terms, setTerms] = useState<ClassTeacherExamTerm[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);

  const [name, setName] = useState("");
  const [termType, setTermType] = useState<"midterm" | "final" | "monthly">("midterm");
  const [academicYearId, setAcademicYearId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [termsRes, academicYearRows] = await Promise.all([
        getExamTerms({ page_size: "100" }),
        getLookupAcademicYears({ page_size: 100 }),
      ]);
      setTerms(termsRes.data || []);
      const years = academicYearRows as AcademicYearOption[];
      setAcademicYears(years);
      const current = years.find((row) => row.is_current) || years[0];
      if (current && !academicYearId) setAcademicYearId(current.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load exam terms");
    } finally {
      setLoading(false);
    }
  }, [academicYearId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate() {
    if (!name || !academicYearId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createExamTerm({
        academic_year_id: academicYearId,
        name,
        term_type: termType,
        starts_on: startsOn || undefined,
        ends_on: endsOn || undefined,
      });
      setNotice("Exam term created successfully.");
      setName("");
      setStartsOn("");
      setEndsOn("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create exam term");
    } finally {
      setSaving(false);
    }
  }

  async function onToggleLock(term: ClassTeacherExamTerm) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateExamTerm(term.id, { is_locked: !term.is_locked });
      setNotice(term.is_locked ? "Term unlocked." : "Term locked.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update exam term");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(termId: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await deleteExamTerm(termId);
      setNotice("Exam term deleted.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete exam term");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Exam Terms" />
      <div className="space-y-6 p-6">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.25em] text-sky-100">Assessment Calendar</p>
          <h2 className="mt-3 text-2xl font-bold">Exam Term Management</h2>
          <p className="mt-2 text-sm text-sky-100">
            Create midterm, final, and monthly assessment windows used by marks and report cards.
          </p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Create Term</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="label-text">Term Name</label>
              <input
                className="input-field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Midterm, Final Term, Monthly Test - Oct"
              />
            </div>
            <div>
              <label className="label-text">Term Type</label>
              <select
                className="input-field"
                value={termType}
                onChange={(event) => setTermType(event.target.value as "midterm" | "final" | "monthly")}
              >
                <option value="midterm">Midterm</option>
                <option value="final">Final</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="label-text">Academic Year</label>
              <select
                className="input-field"
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
              >
                {academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name} {year.is_current ? "(Current)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-primary w-full"
                onClick={onCreate}
                disabled={saving || !name || !academicYearId}
              >
                {saving ? "Saving..." : "Create"}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label-text">Starts On (optional)</label>
              <input type="date" className="input-field" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </div>
            <div>
              <label className="label-text">Ends On (optional)</label>
              <input type="date" className="input-field" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-lg font-semibold text-gray-900">Configured Terms</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Locked</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                      Loading terms...
                    </td>
                  </tr>
                ) : terms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                      No exam terms configured.
                    </td>
                  </tr>
                ) : (
                  terms.map((term) => (
                    <tr key={term.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{term.name}</td>
                      <td className="px-4 py-3 capitalize text-gray-700">{term.term_type}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {term.starts_on || "-"} {term.ends_on ? `to ${term.ends_on}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            term.is_locked ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {term.is_locked ? "Locked" : "Open"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            onClick={() => onToggleLock(term)}
                            disabled={saving}
                          >
                            {term.is_locked ? "Unlock" : "Lock"}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                            onClick={() => onDelete(term.id)}
                            disabled={saving}
                          >
                            Delete
                          </button>
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
