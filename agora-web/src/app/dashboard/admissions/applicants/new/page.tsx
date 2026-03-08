"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createAdmissionInquiry,
  getLookupAcademicYears,
  getLookupClassrooms,
} from "@/lib/api";

const ADMISSIONS_CREATE_ROLES = ["school_admin", "front_desk"];
const ADMISSIONS_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];

function hasRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function messageFromError(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function NewApplicantPage() {
  const { user } = useAuth();
  const router = useRouter();
  const roles = user?.roles || [];
  const canView = hasRole(roles, ADMISSIONS_VIEW_ROLES);
  const canCreate = hasRole(roles, ADMISSIONS_CREATE_ROLES);

  const [loadingLookups, setLoadingLookups] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [classrooms, setClassrooms] = useState<Array<{ id: string; label: string }>>([]);
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string; is_current: boolean }>>([]);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    guardian_name: "",
    guardian_phone: "",
    guardian_email: "",
    inquiry_source: "walk_in",
    desired_grade_label: "",
    desired_section_label: "",
    desired_classroom_id: "",
    desired_academic_year_id: "",
    notes: "",
  });

  useEffect(() => {
    if (!canView) {
      setLoadingLookups(false);
      return;
    }
    let cancelled = false;
    async function loadLookups() {
      setLoadingLookups(true);
      try {
        const [classroomRows, yearRows] = await Promise.all([
          getLookupClassrooms({ page_size: 200 }),
          getLookupAcademicYears({ page_size: 100 }),
        ]);
        if (cancelled) return;
        setClassrooms(classroomRows.map((row) => ({ id: row.id, label: row.label })));
        setAcademicYears(yearRows.map((row) => ({ id: row.id, label: row.label, is_current: row.is_current })));

        const currentYear = yearRows.find((row) => row.is_current);
        if (currentYear && !form.desired_academic_year_id) {
          setForm((prev) => ({ ...prev, desired_academic_year_id: currentYear.id }));
        }
      } catch {
        if (cancelled) return;
        setClassrooms([]);
        setAcademicYears([]);
      } finally {
        if (!cancelled) setLoadingLookups(false);
      }
    }
    loadLookups();
    return () => {
      cancelled = true;
    };
  }, [canView, form.desired_academic_year_id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setSaving(true);
    setError("");
    try {
      const result = await createAdmissionInquiry({
        first_name: form.first_name,
        ...(form.last_name.trim() ? { last_name: form.last_name.trim() } : {}),
        guardian_name: form.guardian_name,
        ...(form.guardian_phone.trim() ? { guardian_phone: form.guardian_phone.trim() } : {}),
        ...(form.guardian_email.trim() ? { guardian_email: form.guardian_email.trim() } : {}),
        ...(form.inquiry_source.trim() ? { inquiry_source: form.inquiry_source.trim() } : {}),
        ...(form.desired_grade_label.trim() ? { desired_grade_label: form.desired_grade_label.trim() } : {}),
        ...(form.desired_section_label.trim() ? { desired_section_label: form.desired_section_label.trim() } : {}),
        ...(form.desired_classroom_id ? { desired_classroom_id: form.desired_classroom_id } : {}),
        ...(form.desired_academic_year_id ? { desired_academic_year_id: form.desired_academic_year_id } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });

      const studentId = (result.data as { student: { id: string } })?.student?.id;
      if (studentId) {
        router.push(`/dashboard/admissions/applicants/${studentId}`);
        return;
      }
      router.push("/dashboard/admissions/pipeline");
    } catch (err: unknown) {
      setError(messageFromError(err, "Failed to create applicant inquiry"));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="New Applicant" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">You do not have permission to access admissions pages.</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="New Applicant" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">Admissions Intake</p>
          <h2 className="mt-2 text-3xl font-extrabold">Create Inquiry or Application</h2>
          <p className="mt-2 max-w-3xl text-sm text-purple-100">
            Capture minimal details quickly and move the applicant through verified admission stages.
          </p>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!canCreate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Your role can view admissions but cannot create new inquiries.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Applicant Details</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="First Name" required>
                <input
                  className="input-field"
                  value={form.first_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, first_name: e.target.value }))}
                  required
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Last Name">
                <input
                  className="input-field"
                  value={form.last_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, last_name: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Guardian Contact</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Guardian Name" required>
                <input
                  className="input-field"
                  value={form.guardian_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, guardian_name: e.target.value }))}
                  required
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input-field"
                  value={form.guardian_phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, guardian_phone: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Email">
                <input
                  className="input-field"
                  type="email"
                  value={form.guardian_email}
                  onChange={(e) => setForm((prev) => ({ ...prev, guardian_email: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Placement and Notes</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Inquiry Source">
                <input
                  className="input-field"
                  placeholder="walk_in, referral, website"
                  value={form.inquiry_source}
                  onChange={(e) => setForm((prev) => ({ ...prev, inquiry_source: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Desired Grade Label">
                <input
                  className="input-field"
                  placeholder="Grade 7"
                  value={form.desired_grade_label}
                  onChange={(e) => setForm((prev) => ({ ...prev, desired_grade_label: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Desired Section Label">
                <input
                  className="input-field"
                  placeholder="A"
                  value={form.desired_section_label}
                  onChange={(e) => setForm((prev) => ({ ...prev, desired_section_label: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
              <Field label="Desired Classroom">
                <select
                  className="input-field"
                  value={form.desired_classroom_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, desired_classroom_id: e.target.value }))}
                  disabled={!canCreate || saving || loadingLookups}
                >
                  <option value="">Select Classroom</option>
                  {classrooms.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Academic Year">
                <select
                  className="input-field"
                  value={form.desired_academic_year_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, desired_academic_year_id: e.target.value }))}
                  disabled={!canCreate || saving || loadingLookups}
                >
                  <option value="">Select Academic Year</option>
                  {academicYears.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Notes">
                <textarea
                  className="input-field min-h-[88px]"
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  disabled={!canCreate || saving}
                />
              </Field>
            </div>
          </section>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => router.push("/dashboard/admissions/pipeline")}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!canCreate || saving}>
              {saving ? "Saving..." : "Create Inquiry"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({
  label,
  children,
  required = false,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label-text">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
