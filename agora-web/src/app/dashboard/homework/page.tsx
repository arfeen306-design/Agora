"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getHomework,
  createHomework,
  getLookupClassrooms,
  getLookupSubjects,
  type LookupClassroom,
  type LookupSubject,
} from "@/lib/api";

interface Homework {
  id: string;
  classroom_id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  assigned_at: string;
  due_at: string | null;
  is_published: boolean;
}

const HOMEWORK_MANAGE_ROLES = ["school_admin", "teacher"];
const FAMILY_VIEW_ROLES = ["parent", "student"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function isDueSoon(value?: string | null) {
  if (!value) return false;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return false;
  const diff = due.getTime() - Date.now();
  return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 3;
}

export default function HomeworkPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isFamilyViewer = hasAnyRole(roles, FAMILY_VIEW_ROLES);
  const canManageHomework = !isFamilyViewer && hasAnyRole(roles, HOMEWORK_MANAGE_ROLES);

  const [items, setItems] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [classrooms, setClassrooms] = useState<LookupClassroom[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    classroom_id: "",
    subject_id: "",
    title: "",
    description: "",
    due_at: "",
  });
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

  const loadHomework = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHomework({ page: String(page), page_size: "20" });
      setItems(res.data as Homework[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadHomework();
  }, [loadHomework]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    loadSubjects(formData.classroom_id);
  }, [formData.classroom_id, loadSubjects]);

  async function handleCreate() {
    if (!formData.classroom_id || !formData.title) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createHomework({
        classroom_id: formData.classroom_id,
        subject_id: formData.subject_id || undefined,
        title: formData.title,
        description: formData.description || undefined,
        due_at: formData.due_at ? new Date(formData.due_at).toISOString() : undefined,
      });
      setMessage("Homework created successfully!");
      setFormData({ classroom_id: "", subject_id: "", title: "", description: "", due_at: "" });
      setShowForm(false);
      loadHomework();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create homework");
    } finally {
      setSubmitting(false);
    }
  }

  const publishedCount = items.filter((item) => item.is_published).length;
  const dueSoonCount = items.filter((item) => isDueSoon(item.due_at)).length;
  const activeCount = items.filter((item) => {
    if (!item.is_published) return false;
    if (!item.due_at) return true;
    const due = new Date(item.due_at);
    return !Number.isNaN(due.getTime()) && due.getTime() >= Date.now();
  }).length;

  return (
    <>
      <Header title="Homework" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        {isFamilyViewer && (
          <section className="mb-6 rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-500 p-6 text-white shadow-lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/80">Homework Tracker</p>
                <h2 className="mt-2 text-3xl font-bold">Child Homework Feed</h2>
                <p className="mt-2 text-sm text-white/85">
                  Teachers publish homework here. Families can monitor active tasks and upcoming due dates in read-only mode.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FamilyHomeworkBadge label="Active" value={activeCount} tone="border-blue-200 bg-blue-50 text-blue-700" />
                <FamilyHomeworkBadge label="Due Soon" value={dueSoonCount} tone="border-amber-200 bg-amber-50 text-amber-700" />
                <FamilyHomeworkBadge label="Published" value={publishedCount} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
              </div>
            </div>
          </section>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500">
            {canManageHomework ? "Manage homework assignments" : "View homework assignments"}
          </p>
          {isFamilyViewer && (
            <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Read-only child homework view.
            </span>
          )}
          {canManageHomework && (
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "Create Homework"}
            </button>
          )}
        </div>

        {isFamilyViewer && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
            <FamilyHomeworkCard title="Active Homework" value={activeCount} hint="Published tasks still active for the child." tone="border-blue-200 bg-blue-50 text-blue-700" />
            <FamilyHomeworkCard title="Due Soon" value={dueSoonCount} hint="Assignments due within the next three days." tone="border-amber-200 bg-amber-50 text-amber-700" />
            <FamilyHomeworkCard title="Published Tasks" value={publishedCount} hint="Total published homework visible in family view." tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
          </div>
        )}

        {showForm && canManageHomework && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">New Homework</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
                <label className="label-text">Title *</label>
                <input type="text" className="input-field" placeholder="Homework title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div>
                <label className="label-text">Due Date</label>
                <input type="datetime-local" className="input-field" value={formData.due_at} onChange={(e) => setFormData({ ...formData, due_at: e.target.value })} />
              </div>
            </div>
            <div className="mb-4">
              <label className="label-text">Description</label>
              <textarea className="input-field" rows={3} placeholder="Homework description..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Homework"}
            </button>
          </div>
        )}

        {isFamilyViewer ? (
          <div className="grid grid-cols-1 gap-4">
            {loading ? (
              <div className="card text-center text-gray-400">Loading...</div>
            ) : items.length === 0 ? (
              <div className="card text-center text-gray-400">No homework found</div>
            ) : (
              items.map((hw) => (
                <div key={hw.id} className="card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{hw.title}</p>
                      {hw.description && <p className="mt-2 text-sm text-gray-600">{hw.description}</p>}
                    </div>
                    <span className={hw.is_published ? "badge-green" : "badge-gray"}>
                      {hw.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Assigned</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{new Date(hw.assigned_at).toLocaleDateString()}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Due Date</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {hw.due_at ? new Date(hw.due_at).toLocaleDateString() : "No due date"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Homework Status</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {isDueSoon(hw.due_at) ? "Due soon" : hw.is_published ? "Active task" : "Pending publish"}
                      </p>
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
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Classroom</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Assigned</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Due</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No homework found</td></tr>
                ) : (
                  items.map((hw) => (
                    <tr key={hw.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{hw.title}</p>
                        {hw.description && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{hw.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{hw.classroom_id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(hw.assigned_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-gray-600">{hw.due_at ? new Date(hw.due_at).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3">
                        {hw.is_published ? <span className="badge-green">Published</span> : <span className="badge-gray">Draft</span>}
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

function FamilyHomeworkBadge({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${tone}`}>
      <p className="text-[11px] uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function FamilyHomeworkCard({
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
