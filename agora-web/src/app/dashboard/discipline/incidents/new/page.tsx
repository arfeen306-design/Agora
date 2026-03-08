"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createDisciplineIncident,
  getLookupClassrooms,
  getLookupSections,
  getLookupStudents,
  type DisciplineIncidentType,
  type DisciplineSeverity,
} from "@/lib/api";

type Role = "school_admin" | "principal" | "teacher";

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewDisciplineIncidentPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [loadingLookups, setLoadingLookups] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [students, setStudents] = useState<Array<{ id: string; label: string }>>([]);
  const [classrooms, setClassrooms] = useState<Array<{ id: string; label: string }>>([]);
  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);

  const [form, setForm] = useState({
    student_id: "",
    classroom_id: "",
    section_id: "",
    incident_date: todayIso(),
    incident_type: "minor_infraction" as DisciplineIncidentType,
    severity: "medium" as DisciplineSeverity,
    status: "reported" as "reported" | "under_review" | "escalated",
    location: "",
    description: "",
    witnesses: "",
    is_sensitive: false,
  });

  const roles = (user?.roles || []) as Role[];
  const canCreate = hasAnyRole(roles, ["school_admin", "principal", "teacher"]);
  const canSetSensitive = hasAnyRole(roles, ["school_admin", "principal"]);

  useEffect(() => {
    if (!user || !canCreate) {
      setLoadingLookups(false);
      return;
    }

    let cancelled = false;
    async function loadLookups() {
      setLoadingLookups(true);
      setError("");
      try {
        const [studentsRows, classroomRows, sectionRows] = await Promise.all([
          getLookupStudents({ page_size: 200 }),
          getLookupClassrooms({ page_size: 200 }),
          getLookupSections({ page_size: 200 }),
        ]);

        if (cancelled) return;

        setStudents(
          studentsRows.map((row) => ({
            id: row.id,
            label: row.label,
          }))
        );
        setClassrooms(
          classroomRows.map((row) => ({
            id: row.id,
            label: row.label,
          }))
        );
        setSections(
          sectionRows.map((row) => ({
            id: row.id,
            label: row.label,
          }))
        );
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load lookup data");
        }
      } finally {
        if (!cancelled) {
          setLoadingLookups(false);
        }
      }
    }

    loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canCreate, user]);

  const submitDisabled = useMemo(() => {
    return submitting || !form.student_id || !form.incident_date || !form.description.trim();
  }, [form.description, form.incident_date, form.student_id, submitting]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;

    setSubmitting(true);
    setError("");
    try {
      const response = await createDisciplineIncident({
        student_id: form.student_id,
        classroom_id: form.classroom_id || undefined,
        section_id: form.section_id || undefined,
        incident_date: form.incident_date,
        incident_type: form.incident_type,
        severity: form.severity,
        status: form.status,
        location: form.location || undefined,
        description: form.description.trim(),
        witnesses: form.witnesses || undefined,
        is_sensitive: canSetSensitive ? form.is_sensitive : false,
      });

      const incidentId = response.data.id;
      router.replace(`/dashboard/discipline/incidents/${incidentId}`);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to create incident");
      }
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <>
        <Header title="Report Incident" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">Only school_admin, principal, and teacher can report incidents.</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Report Discipline Incident" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 p-6 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">Incident Form</p>
          <h2 className="mt-2 text-3xl font-black">Create New Incident</h2>
          <p className="mt-2 max-w-3xl text-sm text-amber-50">
            Record behavior incidents with clear severity, context, and escalation data for leadership follow-up.
          </p>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <form className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" onSubmit={onSubmit}>
          {loadingLookups ? (
            <p className="text-sm text-gray-600">Loading lookup data...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="block">
                  <span className="label-text">Student</span>
                  <select
                    className="input-field"
                    value={form.student_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, student_id: e.target.value }))}
                    required
                  >
                    <option value="">Select student</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="label-text">Classroom (optional)</span>
                  <select
                    className="input-field"
                    value={form.classroom_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, classroom_id: e.target.value }))}
                  >
                    <option value="">Auto-resolve from enrollment</option>
                    {classrooms.map((classroom) => (
                      <option key={classroom.id} value={classroom.id}>
                        {classroom.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="label-text">Section (optional)</span>
                  <select
                    className="input-field"
                    value={form.section_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, section_id: e.target.value }))}
                  >
                    <option value="">Auto-resolve from classroom/enrollment</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="label-text">Incident Date</span>
                  <input
                    type="date"
                    className="input-field"
                    value={form.incident_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, incident_date: e.target.value }))}
                    required
                  />
                </label>

                <label className="block">
                  <span className="label-text">Type</span>
                  <select
                    className="input-field"
                    value={form.incident_type}
                    onChange={(e) => setForm((prev) => ({ ...prev, incident_type: e.target.value as DisciplineIncidentType }))}
                  >
                    <option value="minor_infraction">Minor infraction</option>
                    <option value="major_infraction">Major infraction</option>
                    <option value="positive_behavior">Positive behavior</option>
                    <option value="bullying">Bullying</option>
                    <option value="safety_concern">Safety concern</option>
                  </select>
                </label>

                <label className="block">
                  <span className="label-text">Severity</span>
                  <select
                    className="input-field"
                    value={form.severity}
                    onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value as DisciplineSeverity }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>

                <label className="block md:col-span-2 xl:col-span-3">
                  <span className="label-text">Status at report time</span>
                  <select
                    className="input-field"
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        status: e.target.value as "reported" | "under_review" | "escalated",
                      }))
                    }
                  >
                    <option value="reported">Reported</option>
                    <option value="under_review">Under review</option>
                    <option value="escalated">Escalated</option>
                  </select>
                </label>

                <label className="block md:col-span-2 xl:col-span-3">
                  <span className="label-text">Location</span>
                  <input
                    className="input-field"
                    value={form.location}
                    onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
                    placeholder="Classroom, corridor, playground, bus, etc"
                  />
                </label>

                <label className="block md:col-span-2 xl:col-span-3">
                  <span className="label-text">Description</span>
                  <textarea
                    className="input-field min-h-32"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Write what happened with objective details"
                    required
                  />
                </label>

                <label className="block md:col-span-2 xl:col-span-3">
                  <span className="label-text">Witnesses (internal)</span>
                  <textarea
                    className="input-field min-h-24"
                    value={form.witnesses}
                    onChange={(e) => setForm((prev) => ({ ...prev, witnesses: e.target.value }))}
                    placeholder="Internal witness list or notes"
                  />
                </label>

                {canSetSensitive && (
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2 xl:col-span-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={form.is_sensitive}
                      onChange={(e) => setForm((prev) => ({ ...prev, is_sensitive: e.target.checked }))}
                    />
                    Mark as sensitive (hidden from parent/student views)
                  </label>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                <button type="submit" className="btn-primary" disabled={submitDisabled}>
                  {submitting ? "Submitting..." : "Create Incident"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => router.push("/dashboard/discipline")}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </>
  );
}
