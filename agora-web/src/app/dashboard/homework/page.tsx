"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { getHomework, createHomework } from "@/lib/api";

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

export default function HomeworkPage() {
  const [items, setItems] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

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

  return (
    <>
      <Header title="Homework" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500">Manage homework assignments</p>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Create Homework"}
          </button>
        </div>

        {showForm && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">New Homework</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label-text">Classroom ID *</label>
                <input type="text" className="input-field" placeholder="Classroom UUID" value={formData.classroom_id} onChange={(e) => setFormData({ ...formData, classroom_id: e.target.value })} />
              </div>
              <div>
                <label className="label-text">Subject ID</label>
                <input type="text" className="input-field" placeholder="Subject UUID (optional)" value={formData.subject_id} onChange={(e) => setFormData({ ...formData, subject_id: e.target.value })} />
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
