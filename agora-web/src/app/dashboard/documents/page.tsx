"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  addDocumentVersion,
  archiveDocument,
  ApiError,
  createDocument,
  getDocumentDetail,
  getDocumentCategories,
  getDocuments,
  issueDocumentDownloadUrl,
  setDocumentAccessRules,
  updateDocument,
  type DocumentAccessRuleInput,
  type DocumentVaultAccessRule,
  type DocumentVaultDetailPayload,
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

const DOCUMENT_ACCESS_GOVERNANCE_ROLES = ["school_admin", "principal"];

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

function toAccessRuleInput(rules: DocumentVaultAccessRule[]): DocumentAccessRuleInput[] {
  return rules.map((rule) => ({
    access_type: rule.access_type,
    role_code: rule.role_code || undefined,
    user_id: rule.user_id || undefined,
    can_view: rule.can_view,
    can_download: rule.can_download,
  }));
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, DOCUMENT_VIEW_ROLES);
  const canManage = hasAnyRole(roles, DOCUMENT_MANAGE_ROLES);
  const canGovernAccess = hasAnyRole(roles, DOCUMENT_ACCESS_GOVERNANCE_ROLES);

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
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSubmitting, setDetailSubmitting] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedDocumentDetail, setSelectedDocumentDetail] = useState<DocumentVaultDetailPayload | null>(null);
  const [versionForm, setVersionForm] = useState({
    file_name: "",
    file_key: "",
    file_size_bytes: "1024",
    mime_type: "application/pdf",
  });
  const [accessRoleForm, setAccessRoleForm] = useState({
    role_code: "teacher",
    can_download: false,
  });
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

  const loadDocumentDetail = useCallback(async (documentId: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const detail = await getDocumentDetail(documentId);
      setSelectedDocumentId(documentId);
      setSelectedDocumentDetail(detail);
      setVersionForm({
        file_name: detail.file_name || "",
        file_key: detail.file_key || "",
        file_size_bytes: String(detail.file_size_bytes || 0),
        mime_type: detail.mime_type || "application/pdf",
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load document detail."));
      setSelectedDocumentId("");
      setSelectedDocumentDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetailPanel = useCallback(() => {
    setSelectedDocumentId("");
    setSelectedDocumentDetail(null);
    setVersionForm({
      file_name: "",
      file_key: "",
      file_size_bytes: "1024",
      mime_type: "application/pdf",
    });
  }, []);

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
      if (item.is_archived) {
        await updateDocument(item.id, { is_archived: false });
      } else {
        await archiveDocument(item.id, true);
      }
      await loadDocuments();
      if (selectedDocumentId === item.id) {
        await loadDocumentDetail(item.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update document status."));
    }
  }

  async function handleAddVersion() {
    if (!selectedDocumentId || !canManage) return;
    if (!versionForm.file_key.trim() || !versionForm.file_name.trim()) {
      setError("Please provide version file key and file name.");
      return;
    }
    setDetailSubmitting(true);
    setError("");
    setMessage("");
    try {
      await addDocumentVersion(selectedDocumentId, {
        file_key: versionForm.file_key.trim(),
        file_name: versionForm.file_name.trim(),
        file_size_bytes: Number(versionForm.file_size_bytes || 0),
        mime_type: versionForm.mime_type.trim(),
      });
      setMessage("New document version added.");
      await Promise.all([loadDocuments(), loadDocumentDetail(selectedDocumentId)]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to add document version."));
    } finally {
      setDetailSubmitting(false);
    }
  }

  async function handleAddRoleAccessRule() {
    if (!selectedDocumentId || !selectedDocumentDetail || !canGovernAccess) return;
    const roleCode = accessRoleForm.role_code.trim();
    if (!roleCode) {
      setError("Role code is required for access rule.");
      return;
    }

    const existingRules = toAccessRuleInput(selectedDocumentDetail.access_rules).filter(
      (rule) => !(rule.access_type === "role" && rule.role_code === roleCode)
    );
    existingRules.push({
      access_type: "role",
      role_code: roleCode,
      can_view: true,
      can_download: accessRoleForm.can_download,
    });

    setDetailSubmitting(true);
    setError("");
    setMessage("");
    try {
      await setDocumentAccessRules(selectedDocumentId, existingRules);
      setMessage("Access rules updated.");
      await loadDocumentDetail(selectedDocumentId);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to update access rules."));
    } finally {
      setDetailSubmitting(false);
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
                          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                          onClick={() => loadDocumentDetail(item.id)}
                        >
                          View
                        </button>
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

        {(detailLoading || selectedDocumentDetail) && (
          <section className="card border border-indigo-100">
            {detailLoading ? (
              <p className="text-sm text-gray-500">Loading document detail...</p>
            ) : selectedDocumentDetail ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-500">Document Detail</p>
                    <h3 className="mt-1 text-xl font-bold text-gray-900">{selectedDocumentDetail.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{selectedDocumentDetail.file_name}</p>
                  </div>
                  <button
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    onClick={closeDetailPanel}
                  >
                    Close
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <DetailStat label="Category" value={selectedDocumentDetail.category} />
                  <DetailStat label="Scope" value={scopeLabel(selectedDocumentDetail)} />
                  <DetailStat label="Version" value={`v${selectedDocumentDetail.version_no}`} />
                  <DetailStat label="Size" value={bytesLabel(selectedDocumentDetail.file_size_bytes)} />
                  <DetailStat label="Updated" value={new Date(selectedDocumentDetail.updated_at).toLocaleString()} />
                  <DetailStat label="Downloads" value={String(selectedDocumentDetail.downloads_count || 0)} />
                </div>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-900">Versions</h4>
                    <div className="mt-3 space-y-2">
                      {selectedDocumentDetail.versions.length === 0 ? (
                        <p className="text-sm text-gray-500">No versions available.</p>
                      ) : (
                        selectedDocumentDetail.versions.map((version) => (
                          <div key={version.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-gray-800">v{version.version_no}</span>
                              <span className="text-xs text-gray-500">{new Date(version.created_at).toLocaleString()}</span>
                            </div>
                            <p className="mt-1 text-gray-700">{version.file_name}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {canManage && (
                      <div className="mt-4 space-y-2 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Add Version</p>
                        <input
                          className="input-field"
                          placeholder="File name"
                          value={versionForm.file_name}
                          onChange={(e) => setVersionForm((prev) => ({ ...prev, file_name: e.target.value }))}
                        />
                        <input
                          className="input-field"
                          placeholder="File key"
                          value={versionForm.file_key}
                          onChange={(e) => setVersionForm((prev) => ({ ...prev, file_key: e.target.value }))}
                        />
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <input
                            className="input-field"
                            type="number"
                            min={0}
                            placeholder="File size bytes"
                            value={versionForm.file_size_bytes}
                            onChange={(e) => setVersionForm((prev) => ({ ...prev, file_size_bytes: e.target.value }))}
                          />
                          <input
                            className="input-field"
                            placeholder="MIME type"
                            value={versionForm.mime_type}
                            onChange={(e) => setVersionForm((prev) => ({ ...prev, mime_type: e.target.value }))}
                          />
                        </div>
                        <div className="flex justify-end">
                          <button className="btn-primary" disabled={detailSubmitting} onClick={handleAddVersion}>
                            {detailSubmitting ? "Saving..." : "Save Version"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-900">Access Rules</h4>
                    <div className="mt-3 space-y-2">
                      {selectedDocumentDetail.access_rules.length === 0 ? (
                        <p className="text-sm text-gray-500">No explicit rules. Role scope applies.</p>
                      ) : (
                        selectedDocumentDetail.access_rules.map((rule) => (
                          <div key={rule.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                            <p className="font-semibold text-gray-800">
                              {rule.access_type === "role" ? `Role: ${rule.role_code}` : `User: ${rule.user_id}`}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              View: {rule.can_view ? "Yes" : "No"} • Download: {rule.can_download ? "Yes" : "No"}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    {canGovernAccess && (
                      <div className="mt-4 space-y-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                          Add / Replace Role Access Rule
                        </p>
                        <input
                          className="input-field"
                          placeholder="role_code (example: parent)"
                          value={accessRoleForm.role_code}
                          onChange={(e) => setAccessRoleForm((prev) => ({ ...prev, role_code: e.target.value }))}
                        />
                        <label className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={accessRoleForm.can_download}
                            onChange={(e) => setAccessRoleForm((prev) => ({ ...prev, can_download: e.target.checked }))}
                          />
                          Allow download
                        </label>
                        <div className="flex justify-end">
                          <button
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-70"
                            onClick={handleAddRoleAccessRule}
                            disabled={detailSubmitting}
                          >
                            {detailSubmitting ? "Saving..." : "Update Access"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )}

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

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}
