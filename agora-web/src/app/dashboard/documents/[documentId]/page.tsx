"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  addDocumentVersion,
  ApiError,
  archiveDocument,
  getDocumentDetail,
  getDocumentDownloadEvents,
  issueDocumentDownloadUrl,
  setDocumentAccessRules,
  updateDocument,
  type DocumentAccessRuleInput,
  type DocumentDownloadEvent,
  type DocumentVaultAccessRule,
  type DocumentVaultDetailPayload,
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

function hasAnyRole(userRoles: string[] = [], allowedRoles: string[]) {
  return allowedRoles.some((role) => userRoles.includes(role));
}

function extractError(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function bytesLabel(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** power;
  return `${scaled.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function asAccessInput(rules: DocumentVaultAccessRule[]): DocumentAccessRuleInput[] {
  return rules.map((rule) => ({
    access_type: rule.access_type,
    role_code: rule.role_code || undefined,
    user_id: rule.user_id || undefined,
    can_view: Boolean(rule.can_view),
    can_download: Boolean(rule.can_download),
  }));
}

function toDisplayScope(data: { scope_type: string; scope_id?: string | null }) {
  if (data.scope_type === "school") return "School Wide";
  if (!data.scope_id) return data.scope_type;
  return `${data.scope_type} • ${data.scope_id.slice(0, 8)}…`;
}

function emptyRule(): DocumentAccessRuleInput {
  return {
    access_type: "role",
    role_code: "teacher",
    can_view: true,
    can_download: false,
  };
}

function parseDocumentId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default function DocumentDetailPage() {
  const params = useParams<{ documentId: string }>();
  const documentId = parseDocumentId(params?.documentId);

  const { user } = useAuth();
  const roles = user?.roles || [];

  const canView = hasAnyRole(roles, DOCUMENT_VIEW_ROLES);
  const canManage = hasAnyRole(roles, DOCUMENT_MANAGE_ROLES);
  const canGovernAccess = hasAnyRole(roles, DOCUMENT_ACCESS_GOVERNANCE_ROLES);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [detail, setDetail] = useState<DocumentVaultDetailPayload | null>(null);
  const [downloadEvents, setDownloadEvents] = useState<DocumentDownloadEvent[]>([]);

  const [versionForm, setVersionForm] = useState({
    file_name: "",
    file_key: "",
    file_size_bytes: "1024",
    mime_type: "application/pdf",
  });

  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    expires_on: "",
  });

  const [accessDraft, setAccessDraft] = useState<DocumentAccessRuleInput[]>([]);

  async function loadAll() {
    if (!canView || !documentId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [detailData, eventsRes] = await Promise.all([
        getDocumentDetail(documentId),
        getDocumentDownloadEvents(documentId, { page: 1, page_size: 30 }),
      ]);
      setDetail(detailData);
      setVersionForm({
        file_name: detailData.file_name,
        file_key: detailData.file_key,
        file_size_bytes: String(detailData.file_size_bytes || 0),
        mime_type: detailData.mime_type,
      });
      setEditForm({
        title: detailData.title || "",
        description: detailData.description || "",
        expires_on: detailData.expires_on || "",
      });
      setAccessDraft(asAccessInput(detailData.access_rules || []));
      setDownloadEvents(eventsRes.data || []);
    } catch (err: unknown) {
      setError(extractError(err, "Failed to load document detail."));
      setDetail(null);
      setDownloadEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, documentId]);

  const accessCount = useMemo(() => accessDraft.length, [accessDraft.length]);

  async function handleDownload() {
    if (!detail) return;
    setError("");
    try {
      const data = await issueDocumentDownloadUrl(detail.id);
      if (data.download?.url) {
        window.open(data.download.url, "_blank", "noopener,noreferrer");
      }
      await loadAll();
    } catch (err: unknown) {
      setError(extractError(err, "Failed to generate download URL."));
    }
  }

  async function handleSaveMetadata(event: FormEvent) {
    event.preventDefault();
    if (!detail || !canManage) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateDocument(detail.id, {
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        expires_on: editForm.expires_on || null,
      });
      setNotice("Document metadata updated.");
      await loadAll();
    } catch (err: unknown) {
      setError(extractError(err, "Failed to update metadata."));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (!detail || !canManage) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await archiveDocument(detail.id, !detail.is_archived);
      setNotice(detail.is_archived ? "Document restored." : "Document archived.");
      await loadAll();
    } catch (err: unknown) {
      setError(extractError(err, "Failed to update archive status."));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddVersion(event: FormEvent) {
    event.preventDefault();
    if (!detail || !canManage) return;

    if (!versionForm.file_name.trim() || !versionForm.file_key.trim()) {
      setError("Version file name and file key are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await addDocumentVersion(detail.id, {
        file_name: versionForm.file_name.trim(),
        file_key: versionForm.file_key.trim(),
        file_size_bytes: Number(versionForm.file_size_bytes || 0),
        mime_type: versionForm.mime_type.trim(),
      });
      setNotice("New version added.");
      await loadAll();
    } catch (err: unknown) {
      setError(extractError(err, "Failed to add version."));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAccessRules(event: FormEvent) {
    event.preventDefault();
    if (!detail || !canGovernAccess) return;

    const normalized = accessDraft
      .map((rule) => ({
        access_type: rule.access_type,
        role_code: rule.role_code?.trim(),
        user_id: rule.user_id?.trim(),
        can_view: rule.can_view ?? true,
        can_download: Boolean(rule.can_download),
      }))
      .filter((rule) => {
        if (rule.access_type === "role") return Boolean(rule.role_code);
        return Boolean(rule.user_id);
      });

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setDocumentAccessRules(detail.id, normalized);
      setNotice("Access rules updated.");
      await loadAll();
    } catch (err: unknown) {
      setError(extractError(err, "Failed to save access rules."));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Document Detail" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              You do not have permission to view document details.
            </p>
            <div className="mt-4">
              <Link href="/dashboard/documents" className="btn-secondary">
                Back to Document Vault
              </Link>
            </div>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Document Detail" />
        <div className="p-6">
          <div className="h-56 animate-pulse rounded-2xl bg-blue-100" />
        </div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <Header title="Document Detail" />
        <div className="space-y-4 p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Document Not Found</h2>
            <p className="mt-2 text-sm text-gray-600">
              {error || "The document may have been removed or you do not have access."}
            </p>
            <div className="mt-4">
              <Link href="/dashboard/documents" className="btn-secondary">
                Back to Document Vault
              </Link>
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Document Detail" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">Document Vault</p>
              <h2 className="mt-2 text-3xl font-extrabold">{detail.title}</h2>
              <p className="mt-2 text-sm text-indigo-100">
                {detail.category.replaceAll("_", " ")} • {toDisplayScope(detail)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/documents" className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
                Back to Vault
              </Link>
              <button
                type="button"
                className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30"
                onClick={handleDownload}
              >
                Download
              </button>
              {canManage && (
                <button
                  type="button"
                  className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30"
                  onClick={handleArchiveToggle}
                  disabled={saving}
                >
                  {detail.is_archived ? "Unarchive" : "Archive"}
                </button>
              )}
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <Stat label="Current Version" value={`v${detail.version_no}`} />
          <Stat label="File Size" value={bytesLabel(detail.file_size_bytes)} />
          <Stat label="Total Versions" value={String(detail.versions_count || detail.versions.length || 0)} />
          <Stat label="Downloads" value={String(detail.downloads_count || 0)} />
          <Stat label="Access Rules" value={String(accessCount)} />
          <Stat label="Expiry" value={detail.expires_on || "None"} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Document Metadata</h3>
            <form className="mt-4 space-y-3" onSubmit={handleSaveMetadata}>
              <label className="block">
                <span className="label-text">Title</span>
                <input
                  className="input-field"
                  value={editForm.title}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                  disabled={!canManage || saving}
                />
              </label>
              <label className="block">
                <span className="label-text">Description</span>
                <textarea
                  className="input-field min-h-[92px]"
                  value={editForm.description}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                  disabled={!canManage || saving}
                />
              </label>
              <label className="block">
                <span className="label-text">Expires On</span>
                <input
                  type="date"
                  className="input-field"
                  value={editForm.expires_on}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, expires_on: event.target.value }))}
                  disabled={!canManage || saving}
                />
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <p>File name: {detail.file_name}</p>
                <p>File key: {detail.file_key}</p>
                <p>Updated: {new Date(detail.updated_at).toLocaleString()}</p>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManage || saving}>
                  {saving ? "Saving..." : "Save Metadata"}
                </button>
              </div>
            </form>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Version Management</h3>
            <div className="mt-3 max-h-48 space-y-2 overflow-auto">
              {detail.versions.length === 0 ? (
                <p className="text-sm text-gray-500">No versions available.</p>
              ) : (
                detail.versions.map((version) => (
                  <div key={version.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
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
              <form className="mt-4 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3" onSubmit={handleAddVersion}>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Add New Version</p>
                <input
                  className="input-field"
                  placeholder="File name"
                  value={versionForm.file_name}
                  onChange={(event) => setVersionForm((prev) => ({ ...prev, file_name: event.target.value }))}
                  disabled={saving}
                />
                <input
                  className="input-field"
                  placeholder="File key"
                  value={versionForm.file_key}
                  onChange={(event) => setVersionForm((prev) => ({ ...prev, file_key: event.target.value }))}
                  disabled={saving}
                />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="input-field"
                    type="number"
                    min={0}
                    placeholder="Size (bytes)"
                    value={versionForm.file_size_bytes}
                    onChange={(event) => setVersionForm((prev) => ({ ...prev, file_size_bytes: event.target.value }))}
                    disabled={saving}
                  />
                  <input
                    className="input-field"
                    placeholder="MIME type"
                    value={versionForm.mime_type}
                    onChange={(event) => setVersionForm((prev) => ({ ...prev, mime_type: event.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? "Saving..." : "Add Version"}
                  </button>
                </div>
              </form>
            )}
          </article>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Access Rule Editor</h3>
            <p className="mt-1 text-sm text-gray-500">
              Define role or user-level access controls. Leadership policies still apply on top of explicit rules.
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleSaveAccessRules}>
              <div className="space-y-3">
                {accessDraft.length === 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    No explicit rules configured yet.
                  </p>
                )}
                {accessDraft.map((rule, index) => (
                  <div key={`rule-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-12">
                    <select
                      className="input-field md:col-span-3"
                      value={rule.access_type}
                      disabled={!canGovernAccess || saving}
                      onChange={(event) =>
                        setAccessDraft((prev) =>
                          prev.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  access_type: event.target.value as "role" | "user",
                                  can_view: true,
                                  can_download: Boolean(item.can_download),
                                  role_code: event.target.value === "role" ? item.role_code || "teacher" : undefined,
                                  user_id: event.target.value === "user" ? item.user_id || "" : undefined,
                                }
                              : item
                          )
                        )
                      }
                    >
                      <option value="role">role</option>
                      <option value="user">user</option>
                    </select>

                    {rule.access_type === "role" ? (
                      <input
                        className="input-field md:col-span-4"
                        placeholder="role_code"
                        value={rule.role_code || ""}
                        disabled={!canGovernAccess || saving}
                        onChange={(event) =>
                          setAccessDraft((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, role_code: event.target.value } : item
                            )
                          )
                        }
                      />
                    ) : (
                      <input
                        className="input-field md:col-span-4"
                        placeholder="user_id (uuid)"
                        value={rule.user_id || ""}
                        disabled={!canGovernAccess || saving}
                        onChange={(event) =>
                          setAccessDraft((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, user_id: event.target.value } : item
                            )
                          )
                        }
                      />
                    )}

                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 md:col-span-2 md:justify-center">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.can_download)}
                        disabled={!canGovernAccess || saving}
                        onChange={(event) =>
                          setAccessDraft((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, can_download: event.target.checked } : item
                            )
                          )
                        }
                      />
                      Download
                    </label>

                    <button
                      type="button"
                      className="btn-danger md:col-span-3"
                      disabled={!canGovernAccess || saving}
                      onClick={() => setAccessDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!canGovernAccess || saving}
                  onClick={() => setAccessDraft((prev) => [...prev, emptyRule()])}
                >
                  Add Rule
                </button>
                <button type="submit" className="btn-primary" disabled={!canGovernAccess || saving}>
                  {saving ? "Saving..." : "Save Access Rules"}
                </button>
              </div>
            </form>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Download Timeline</h3>
            <p className="mt-1 text-sm text-gray-500">
              Recent signed URL issuance events for this document.
            </p>
            <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {downloadEvents.length === 0 ? (
                <p className="text-sm text-gray-500">No downloads tracked yet.</p>
              ) : (
                downloadEvents.map((event) => (
                  <div key={event.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-sm font-semibold text-gray-800">
                      {[event.downloaded_by_first_name, event.downloaded_by_last_name].filter(Boolean).join(" ") || event.downloaded_by_email || "Unknown user"}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {new Date(event.downloaded_at).toLocaleString()} • {event.delivery_method}
                    </p>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-lg font-bold text-gray-900">{value}</p>
    </article>
  );
}
