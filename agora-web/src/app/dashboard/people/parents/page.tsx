"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createPeopleParent,
  getLookupClassrooms,
  getLookupSections,
  getLookupStudents,
  getPeopleParents,
  type LookupStudent,
  type ParentDirectoryRow,
  type ParentStudentLinkInput,
} from "@/lib/api";

const MANAGE_PARENT_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];
const VIEW_PARENT_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk"];

interface DuplicateWarningState {
  email: ParentDirectoryRow[];
  phone: ParentDirectoryRow[];
  whatsapp: ParentDirectoryRow[];
}

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function hasRole(roles: string[] = [], target: string[]) {
  return target.some((code) => roles.includes(code));
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return parsed.toLocaleString();
}

function labelForParent(row: ParentDirectoryRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.guardian_name || "Parent";
}

function emptyLink(): ParentStudentLinkInput {
  return {
    student_id: "",
    relation_type: "guardian",
    is_primary: false,
  };
}

export default function ParentDirectoryPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasRole(roles, VIEW_PARENT_ROLES);
  const canManage = hasRole(roles, MANAGE_PARENT_ROLES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [rows, setRows] = useState<ParentDirectoryRow[]>([]);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);
  const [classrooms, setClassrooms] = useState<Array<{ id: string; label: string }>>([]);

  const [search, setSearch] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [classroomFilter, setClassroomFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarningState>({
    email: [],
    phone: [],
    whatsapp: [],
  });

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    temporary_password: "ChangeMe123!",
    is_active: true,
    occupation: "",
    guardian_name: "",
    father_name: "",
    mother_name: "",
    whatsapp_number: "",
    address_line: "",
    preferred_channel: "in_app" as "in_app" | "push" | "email" | "sms",
  });
  const [links, setLinks] = useState<ParentStudentLinkInput[]>([emptyLink()]);

  const loadLookups = useCallback(async () => {
    if (!canView) return;
    try {
      const [sectionRows, classroomRows, studentRows] = await Promise.all([
        getLookupSections({ page_size: 200 }),
        getLookupClassrooms({ page_size: 200 }),
        getLookupStudents({ page_size: 400 }),
      ]);
      setSections(sectionRows.map((row) => ({ id: row.id, label: row.label })));
      setClassrooms(classroomRows.map((row) => ({ id: row.id, label: row.label })));
      setStudents(studentRows);
    } catch {
      setSections([]);
      setClassrooms([]);
      setStudents([]);
    }
  }, [canView]);

  const loadParents = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getPeopleParents({
        page: String(page),
        page_size: "20",
        ...(search ? { search } : {}),
        ...(sectionFilter ? { section_id: sectionFilter } : {}),
        ...(classroomFilter ? { classroom_id: classroomFilter } : {}),
      });
      setRows(response.data);
      setTotalPages(response.meta?.pagination?.total_pages ?? 1);
    } catch (err: unknown) {
      setRows([]);
      setTotalPages(1);
      setError(extractErrorMessage(err, "Failed to load parent directory"));
    } finally {
      setLoading(false);
    }
  }, [canView, classroomFilter, page, search, sectionFilter]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadParents();
    }, 280);
    return () => clearTimeout(timer);
  }, [loadParents]);

  useEffect(() => {
    if (!canManage) return;

    const checks = [
      { key: "email" as const, value: form.email.trim() },
      { key: "phone" as const, value: form.phone.trim() },
      { key: "whatsapp" as const, value: form.whatsapp_number.trim() },
    ].filter((item) => item.value.length >= 4);

    if (checks.length === 0) {
      setDuplicateWarnings({ email: [], phone: [], whatsapp: [] });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const updates: DuplicateWarningState = { email: [], phone: [], whatsapp: [] };
        await Promise.all(
          checks.map(async (item) => {
            const response = await getPeopleParents({
              search: item.value,
              page_size: "6",
            });
            updates[item.key] = response.data;
          })
        );
        if (!cancelled) {
          setDuplicateWarnings(updates);
        }
      } catch {
        if (!cancelled) {
          setDuplicateWarnings({ email: [], phone: [], whatsapp: [] });
        }
      }
    }, 420);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canManage, form.email, form.phone, form.whatsapp_number]);

  async function handleCreateParent(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const cleanedLinks = links.filter((link) => link.student_id);
      await createPeopleParent({
        first_name: form.first_name,
        last_name: form.last_name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        temporary_password: form.temporary_password,
        is_active: form.is_active,
        occupation: form.occupation || undefined,
        guardian_name: form.guardian_name || undefined,
        father_name: form.father_name || undefined,
        mother_name: form.mother_name || undefined,
        whatsapp_number: form.whatsapp_number || undefined,
        address_line: form.address_line || undefined,
        preferred_channel: form.preferred_channel,
        linked_students: cleanedLinks,
      });

      setNotice("Parent profile created successfully.");
      setShowCreateForm(false);
      setForm({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        temporary_password: "ChangeMe123!",
        is_active: true,
        occupation: "",
        guardian_name: "",
        father_name: "",
        mother_name: "",
        whatsapp_number: "",
        address_line: "",
        preferred_channel: "in_app",
      });
      setLinks([emptyLink()]);
      setDuplicateWarnings({ email: [], phone: [], whatsapp: [] });
      setPage(1);
      await loadParents();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create parent profile"));
    } finally {
      setSaving(false);
    }
  }

  const metrics = useMemo(() => {
    const total = rows.length;
    const activePortal = rows.filter((row) => row.is_active).length;
    const multiChild = rows.filter((row) => row.linked_students_count > 1).length;
    const noLogin = rows.filter((row) => !row.last_login_at).length;
    return { total, activePortal, multiChild, noLogin };
  }, [rows]);

  if (!canView) {
    return (
      <>
        <Header title="Parent Directory" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              You do not have permission to view the parent directory.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Parent Directory" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">People Management</p>
              <h2 className="mt-2 text-3xl font-extrabold">Parent Directory and Linkage Center</h2>
              <p className="mt-2 max-w-2xl text-sm text-indigo-100">
                Create and manage parent records, link multiple children, and monitor portal access.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Parents" value={metrics.total} />
              <MetricCard label="Portal Active" value={metrics.activePortal} />
              <MetricCard label="Multi Child" value={metrics.multiChild} />
              <MetricCard label="No Login Yet" value={metrics.noLogin} />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="block md:col-span-2">
              <span className="label-text">Search Parent</span>
              <input
                className="input-field"
                placeholder="Name, email, phone, or guardian name"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </label>
            <label className="block">
              <span className="label-text">Section</span>
              <select
                className="input-field"
                value={sectionFilter}
                onChange={(e) => {
                  setPage(1);
                  setSectionFilter(e.target.value);
                }}
              >
                <option value="">All Sections</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>{section.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-text">Classroom</span>
              <select
                className="input-field"
                value={classroomFilter}
                onChange={(e) => {
                  setPage(1);
                  setClassroomFilter(e.target.value);
                }}
              >
                <option value="">All Classrooms</option>
                {classrooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSearch("");
                setSectionFilter("");
                setClassroomFilter("");
                setPage(1);
              }}
            >
              Clear Filters
            </button>
            {canManage && (
              <button type="button" className="btn-primary" onClick={() => setShowCreateForm((prev) => !prev)}>
                {showCreateForm ? "Close Create Form" : "Add Parent"}
              </button>
            )}
          </div>
        </section>

        {showCreateForm && canManage && (
          <form onSubmit={handleCreateParent} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Create Parent Profile</h3>
            <p className="text-sm text-gray-500">
              Entity name is Parent. Link one or multiple children and set relationship per child.
            </p>

            {(duplicateWarnings.email.length > 0 || duplicateWarnings.phone.length > 0 || duplicateWarnings.whatsapp.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold">Possible duplicate contact found</p>
                {duplicateWarnings.email.length > 0 && (
                  <p className="mt-1">
                    Email matches: {duplicateWarnings.email.map((row) => labelForParent(row)).join(", ")}
                  </p>
                )}
                {duplicateWarnings.phone.length > 0 && (
                  <p className="mt-1">
                    Mobile matches: {duplicateWarnings.phone.map((row) => labelForParent(row)).join(", ")}
                  </p>
                )}
                {duplicateWarnings.whatsapp.length > 0 && (
                  <p className="mt-1">
                    WhatsApp matches: {duplicateWarnings.whatsapp.map((row) => labelForParent(row)).join(", ")}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="First Name *"><input className="input-field" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} required /></Field>
              <Field label="Last Name"><input className="input-field" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} /></Field>
              <Field label="Temporary Password *"><input className="input-field" value={form.temporary_password} onChange={(e) => setForm((p) => ({ ...p, temporary_password: e.target.value }))} required /></Field>
              <Field label="Email"><input className="input-field" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
              <Field label="Mobile Number"><input className="input-field" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
              <Field label="WhatsApp Number"><input className="input-field" value={form.whatsapp_number} onChange={(e) => setForm((p) => ({ ...p, whatsapp_number: e.target.value }))} /></Field>
              <Field label="Guardian Name"><input className="input-field" value={form.guardian_name} onChange={(e) => setForm((p) => ({ ...p, guardian_name: e.target.value }))} /></Field>
              <Field label="Father Name"><input className="input-field" value={form.father_name} onChange={(e) => setForm((p) => ({ ...p, father_name: e.target.value }))} /></Field>
              <Field label="Mother Name"><input className="input-field" value={form.mother_name} onChange={(e) => setForm((p) => ({ ...p, mother_name: e.target.value }))} /></Field>
              <Field label="Occupation"><input className="input-field" value={form.occupation} onChange={(e) => setForm((p) => ({ ...p, occupation: e.target.value }))} /></Field>
              <Field label="Preferred Communication">
                <select className="input-field" value={form.preferred_channel} onChange={(e) => setForm((p) => ({ ...p, preferred_channel: e.target.value as "in_app" | "push" | "email" | "sms" }))}>
                  <option value="in_app">In App</option>
                  <option value="push">Push</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </Field>
              <Field label="Portal Access">
                <select className="input-field" value={form.is_active ? "active" : "inactive"} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.value === "active" }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <label className="block md:col-span-3">
                <span className="label-text">Address</span>
                <textarea className="input-field min-h-[92px]" value={form.address_line} onChange={(e) => setForm((p) => ({ ...p, address_line: e.target.value }))} />
              </label>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-sky-900">Linked Children</h4>
                <button type="button" className="btn-secondary" onClick={() => setLinks((prev) => [...prev, emptyLink()])}>Add Child Link</button>
              </div>
              <div className="space-y-3">
                {links.map((link, idx) => (
                  <div key={`link-${idx}`} className="grid grid-cols-1 gap-3 rounded-lg border border-sky-200 bg-white p-3 md:grid-cols-12">
                    <label className="block md:col-span-6">
                      <span className="label-text">Student</span>
                      <select
                        className="input-field"
                        value={link.student_id}
                        onChange={(e) =>
                          setLinks((prev) => prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, student_id: e.target.value } : row)))
                        }
                      >
                        <option value="">Select student</option>
                        {students.map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.label} ({student.student_code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block md:col-span-3">
                      <span className="label-text">Relation</span>
                      <select
                        className="input-field"
                        value={link.relation_type}
                        onChange={(e) =>
                          setLinks((prev) => prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, relation_type: e.target.value } : row)))
                        }
                      >
                        <option value="guardian">Guardian</option>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 md:col-span-2 md:mt-7">
                      <input
                        type="checkbox"
                        checked={link.is_primary}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((row, rowIdx) => {
                              if (rowIdx === idx) return { ...row, is_primary: e.target.checked };
                              if (e.target.checked) return { ...row, is_primary: false };
                              return row;
                            })
                          )
                        }
                      />
                      <span className="text-xs font-medium text-gray-700">Primary</span>
                    </label>
                    <div className="md:col-span-1 md:mt-7">
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={links.length === 1}
                        onClick={() => setLinks((prev) => prev.filter((_, rowIdx) => rowIdx !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create Parent"}
            </button>
          </form>
        )}

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h3 className="text-lg font-semibold text-gray-900">Parent Records</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-3">Parent</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3">Linked Children</th>
                  <th className="px-5 py-3">Preferred Communication</th>
                  <th className="px-5 py-3">Portal Access</th>
                  <th className="px-5 py-3">Last Login</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-5 py-8 text-center text-gray-400" colSpan={7}>Loading parent directory...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td className="px-5 py-8 text-center text-gray-400" colSpan={7}>No parent records found.</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-gray-900">{labelForParent(row)}</p>
                        <p className="text-xs text-gray-500">{row.guardian_name || "Guardian name not set"}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-gray-700">{row.email || "Email hidden / unavailable"}</p>
                        <p className="text-xs text-gray-500">{row.phone || "Mobile hidden / unavailable"}</p>
                      </td>
                      <td className="px-5 py-3 text-gray-700">{row.linked_students_count}</td>
                      <td className="px-5 py-3 text-gray-700">
                        {(row.preferred_channel || "in_app").replaceAll("_", " ")}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                          {row.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-700">{formatDateTime(row.last_login_at)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/people/parents/${row.id}`} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                          View Profile
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm text-gray-600">
            <p>Page {page} of {Math.max(1, totalPages)}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
                Previous
              </button>
              <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}>
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/30 bg-white/15 px-3 py-2 backdrop-blur">
      <p className="text-xs text-indigo-100">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
