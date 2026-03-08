"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createDocument,
  getDocumentCategories,
  getDocuments,
  issueDocumentDownloadUrl,
  updateDocument,
  type DocumentCategoryOption,
  type DocumentVaultItem,
} from "@/lib/api";

const DOCUMENT_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "front_desk",
  "hr_admin",
  "accountant",
];

const DOCUMENT_MANAGE_ROLES = [
  "school_admin",
  "principal",
  "teacher",
  "front_desk",
  "hr_admin",
  "accountant",
];

function hasAnyRole(userRoles: string[] = [], roles: string[]) {
  return roles.some((role) => userRoles.includes(role));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function bytesLabel(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** power;
  return `${scaled.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function scopeLabel(item: DocumentVaultItem) {
  if (item.scope_type === "school") return "School Wide";
  if (!item.scope_id) return item.scope_type;
  return `${item.scope_type} • ${item.scope_id.slice(0, 8)}…`;
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, DOCUMENT_VIEW_ROLES);
  const canManage = hasAnyRole(roles, DOCUMENT_MANAGE_ROLES);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<DocumentCategoryOption[]>([]);
  const [documents, setDocuments] = useState<DocumentVaultItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    include_archived: false,
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    file_name: "",
    file_key: "",
    file_size_bytes: "1024",
    mime_type: "application/pdf",
    category: "student_document",
    scope_type: "school",
    scope_id: "",
  });

  const loadDocuments = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getDocuments({
        page,
        page_size: 12,
        search: filters.search || undefined,
        category: filters.category || undefined,
        include_archived: filters.include_archived,
      });
      setDocuments(response.data || []);
      setTotalPages(response.meta?.pagination?.total_pages || 1);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load documents."));
      setDocuments([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [canView, filters.category, filters.include_archived, filters.search, page]);

  useEffect(() => {
    if (!canView) return;
    getDocumentCategories()
      .then((rows) => setCategories(rows || []))
      .catch(() => setCategories([]));
  }, [canView]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const summary = useMemo(() => {
    const archived = documents.filter((item) => item.is_archived).length;
    return {
      total: documents.length,
      archived,
      active: documents.length - archived,
    };
  }, [documents]);

  async function handleCreateDocument() {
    if (!canManage) return;
    if (!createForm.title || !createForm.file_name || !createForm.file_key || !createForm.category) {
      setMessage("Please fill title, file name, key, and category.");
      return;
    }

    const trimmedScopeId = createForm.scope_id.trim();
    const scopeId =
      createForm.scope_type === "school"
        ? null
        : trimmedScopeId || (createForm.scope_type === "finance" || createForm.scope_type === "admission" ? crypto.randomUUID() : "");

    if (createForm.scope_type !== "school" && !scopeId) {
      setMessage("Please provide scope id for the selected scope type.");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await createDocument({
        title: createForm.title,
        description: createForm.description || undefined,
        file_name: createForm.file_name,
        file_key: createForm.file_key,
        file_size_bytes: Number(createForm.file_size_bytes || 0),
        mime_type: createForm.mime_type,
        category: createForm.category,
        scope_type: createForm.scope_type,
        scope_id: scopeId || undefined,
        metadata: {},
        access_rules: [],
      });
      setMessage("Document created.");
      setCreateForm({
        title: "",
        description: "",
        file_name: "",
        file_key: "",
        file_size_bytes: "1024",
        mime_type: "application/pdf",
        category: createForm.category,
        scope_type: createForm.scope_type,
        scope_id: "",
      });
      setShowCreateForm(false);
      await loadDocuments();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to create document."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload(documentId: string) {
    try {
      const data = await issueDocumentDownloadUrl(documentId);
      if (data.download?.url) {
        window.open(data.download.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to generate download URL."));
    }
  }

  async function handleArchiveToggle(item: DocumentVaultItem) {
    if (!canManage) return;
    try {
      await updateDocument(item.id, { is_archived: !item.is_archived });
      await loadDocuments();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update document status."));
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Document Vault" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              Document Vault is available for leadership, teacher, front desk, HR, and accountant roles.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Document Vault" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-600 via-blue-600 to-cyan-600 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">Phase 4</p>
              <h2 className="mt-2 text-3xl font-extrabold">Structured School Document Vault</h2>
              <p className="mt-2 max-w-3xl text-sm text-sky-100">
                Centralized access for HR files, admission forms, receipts, policy documents, and classroom records with scoped visibility.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <SummaryChip label="Visible" value={summary.total} />
              <SummaryChip label="Active" value={summary.active} />
              <SummaryChip label="Archived" value={summary.archived} />
            </div>
          </div>
        </section>

        {(message || error) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || message}
          </div>
        )}

        <section className="card">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              className="input-field"
              placeholder="Search title or file name"
              value={filters.search}
              onChange={(e) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, search: e.target.value }));
              }}
            />
            <select
              className="input-field"
              value={filters.category}
              onChange={(e) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, category: e.target.value }));
              }}
            >
              <option value="">All categories</option>
              {categories.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.include_archived}
                onChange={(e) => {
                  setPage(1);
                  setFilters((prev) => ({ ...prev, include_archived: e.target.checked }));
                }}
              />
              Include archived
            </label>
            {canManage && (
              <button className="btn-primary" onClick={() => setShowCreateForm((prev) => !prev)}>
                {showCreateForm ? "Close Create Form" : "Add Document"}
              </button>
            )}
          </div>
        </section>

        {showCreateForm && canManage && (
          <section className="card border border-blue-100">
            <h3 className="text-lg font-semibold text-gray-900">Create Document</h3>
            <p className="mt-1 text-sm text-gray-500">
              File upload is handled by your storage flow. Use the final storage key and metadata here.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                className="input-field"
                placeholder="Title"
                value={createForm.title}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, title: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="File name"
                value={createForm.file_name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, file_name: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder={`${user?.school_id || "school-id"}/documents/file.pdf`}
                value={createForm.file_key}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, file_key: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Description (optional)"
                value={createForm.description}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="MIME type"
                value={createForm.mime_type}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, mime_type: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="File size bytes"
                type="number"
                min={0}
                value={createForm.file_size_bytes}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, file_size_bytes: e.target.value }))}
              />
              <select
                className="input-field"
                value={createForm.category}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, category: e.target.value }))}
              >
                {categories.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="input-field"
                value={createForm.scope_type}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, scope_type: e.target.value }))}
              >
                <option value="school">School</option>
                <option value="student">Student</option>
                <option value="staff">Staff</option>
                <option value="classroom">Classroom</option>
                <option value="parent">Parent</option>
                <option value="admission">Admission</option>
                <option value="finance">Finance</option>
              </select>
              <input
                className="input-field"
                placeholder={createForm.scope_type === "school" ? "Not required for school scope" : "Scope UUID"}
                value={createForm.scope_id}
                disabled={createForm.scope_type === "school"}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, scope_id: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={handleCreateDocument} disabled={submitting}>
                {submitting ? "Saving..." : "Create"}
              </button>
            </div>
          </section>
        )}

        <section className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Document</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Scope</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Size</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Updated</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    Loading documents...
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    No documents found for the selected filters.
                  </td>
                </tr>
              ) : (
                documents.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.file_name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.category}</td>
                    <td className="px-4 py-3 text-gray-700">{scopeLabel(item)}</td>
                    <td className="px-4 py-3 text-gray-700">{bytesLabel(item.file_size_bytes)}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(item.updated_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          onClick={() => handleDownload(item.id)}
                        >
                          Download
                        </button>
                        {canManage && (
                          <button
                            className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                            onClick={() => handleArchiveToggle(item)}
                          >
                            {item.is_archived ? "Unarchive" : "Archive"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <div className="flex items-center justify-between text-sm text-gray-600">
          <p>
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <button
              className="rounded-md border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/25 bg-white/10 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-100">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-white">{value}</p>
    </div>
  );
}
