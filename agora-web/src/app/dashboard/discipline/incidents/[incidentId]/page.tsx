"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createDisciplineConsequence,
  getDisciplineIncident,
  updateDisciplineIncident,
  type DisciplineConsequenceType,
  type DisciplineIncidentRecord,
  type DisciplineIncidentStatus,
} from "@/lib/api";

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function parseIncidentId(input: string | string[] | undefined) {
  if (Array.isArray(input)) return input[0] || "";
  return input || "";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function titleCase(value?: string | null) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function statusClass(status?: string | null) {
  switch (status) {
    case "resolved":
      return "badge-green";
    case "escalated":
      return "badge-red";
    case "under_review":
      return "badge-yellow";
    default:
      return "badge-blue";
  }
}

function severityClass(severity?: string | null) {
  switch (severity) {
    case "critical":
      return "badge-red";
    case "high":
      return "badge-yellow";
    case "medium":
      return "badge-blue";
    default:
      return "badge-gray";
  }
}

function extractError(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function DisciplineIncidentDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ incidentId: string }>();
  const incidentId = parseIncidentId(params?.incidentId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [incident, setIncident] = useState<DisciplineIncidentRecord | null>(null);

  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, ["school_admin", "principal", "vice_principal", "headmistress", "teacher"]);
  const canLeadershipManage = hasAnyRole(roles, ["school_admin", "principal"]);
  const canHmReview = hasAnyRole(roles, ["headmistress"]);
  const hmReviewOnly = canHmReview && !canLeadershipManage;
  const canReviewStatus = canLeadershipManage || canHmReview;

  const [statusPatch, setStatusPatch] = useState<DisciplineIncidentStatus>("reported");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [pastoralNotes, setPastoralNotes] = useState("");
  const [markSensitive, setMarkSensitive] = useState(false);

  const [consType, setConsType] = useState<DisciplineConsequenceType>("written_warning");
  const [consDescription, setConsDescription] = useState("");
  const [consStartsOn, setConsStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [consEndsOn, setConsEndsOn] = useState("");
  const [consParentNotified, setConsParentNotified] = useState(false);

  const loadIncident = useCallback(async () => {
    if (!incidentId || !canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await getDisciplineIncident(incidentId);
      setIncident(data);
      setStatusPatch(
        hmReviewOnly
          ? (data.status === "under_review" || data.status === "escalated" ? data.status : "under_review")
          : data.status
      );
      setResolutionNotes(data.resolution_notes || "");
      setPastoralNotes(data.pastoral_notes || "");
      setMarkSensitive(Boolean(data.is_sensitive));
      setConsStartsOn(data.incident_date || new Date().toISOString().slice(0, 10));
    } catch (err: unknown) {
      setIncident(null);
      setError(extractError(err, "Failed to load incident detail"));
    } finally {
      setLoading(false);
    }
  }, [canView, hmReviewOnly, incidentId]);

  useEffect(() => {
    loadIncident();
  }, [loadIncident]);

  const studentName = useMemo(() => {
    if (!incident) return "Student";
    return [incident.student_first_name, incident.student_last_name].filter(Boolean).join(" ").trim() || incident.student_code || "Student";
  }, [incident]);

  async function onSaveIncident() {
    if (!incident || !canReviewStatus) return;

    if (hmReviewOnly && !["under_review", "escalated"].includes(statusPatch)) {
      setError("Headmistress can update status only to under_review or escalated.");
      return;
    }

    setSaving(true);
    setNotice("");
    setError("");

    try {
      const payload: Record<string, unknown> = {
        status: statusPatch,
      };

      if (canLeadershipManage) {
        payload.is_sensitive = markSensitive;
        if (resolutionNotes.trim().length > 0 || statusPatch === "resolved") {
          payload.resolution_notes = resolutionNotes.trim();
        }
        payload.pastoral_notes = pastoralNotes.trim() || null;
      }

      await updateDisciplineIncident(incident.id, payload);
      await loadIncident();
      setNotice(hmReviewOnly ? "Review status updated successfully." : "Incident updated successfully.");
    } catch (err: unknown) {
      setError(extractError(err, "Failed to update incident"));
    } finally {
      setSaving(false);
    }
  }

  async function onAddConsequence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!incident || !canLeadershipManage) return;

    setSaving(true);
    setNotice("");
    setError("");

    try {
      await createDisciplineConsequence(incident.id, {
        consequence_type: consType,
        description: consDescription.trim() || undefined,
        starts_on: consStartsOn,
        ends_on: consEndsOn || undefined,
        parent_notified: consParentNotified,
      });
      await loadIncident();
      setConsDescription("");
      setConsEndsOn("");
      setConsParentNotified(false);
      setNotice("Consequence added.");
    } catch (err: unknown) {
      setError(extractError(err, "Failed to add consequence"));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Incident Detail" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">Your role cannot open this incident detail.</p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Incident Detail" />
        <div className="p-6">
          <section className="card">Loading incident detail...</section>
        </div>
      </>
    );
  }

  if (!incident) {
    return (
      <>
        <Header title="Incident Detail" />
        <div className="space-y-4 p-6">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Incident Not Found</h2>
            <p className="mt-2 text-sm text-gray-600">The record may be out of your role scope or removed.</p>
          </section>
          <Link href="/dashboard/discipline" className="btn-secondary">
            Back to Discipline Dashboard
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Incident Detail" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-600 via-rose-600 to-orange-500 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-100">Case File</p>
              <h2 className="mt-2 text-3xl font-black">{studentName}</h2>
              <p className="mt-2 text-sm text-red-50">
                Incident {titleCase(incident.incident_type)} on {formatDate(incident.incident_date)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={statusClass(incident.status)}>{titleCase(incident.status)}</span>
              <span className={severityClass(incident.severity)}>{titleCase(incident.severity)}</span>
              {incident.is_sensitive && <span className="badge-red">Sensitive</span>}
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <article className="space-y-6 xl:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Incident Narrative</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <DetailRow label="Student Code" value={incident.student_code || "-"} />
                <DetailRow label="Date" value={formatDate(incident.incident_date)} />
                <DetailRow label="Type" value={titleCase(incident.incident_type)} />
                <DetailRow label="Severity" value={titleCase(incident.severity)} />
                <DetailRow label="Status" value={titleCase(incident.status)} />
                <DetailRow label="Reported by" value={[incident.reported_by_first_name, incident.reported_by_last_name].filter(Boolean).join(" ").trim() || "Unknown"} />
                <DetailRow label="Location" value={incident.location || "-"} />
                <DetailRow label="Section" value={incident.section_name || "-"} />
              </div>

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Description</p>
                <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap">{incident.description}</p>
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Witnesses</p>
                <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{incident.witnesses || "Hidden or not provided"}</p>
              </div>

              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Resolution Notes</p>
                <p className="mt-1 text-sm text-indigo-900 whitespace-pre-wrap">{incident.resolution_notes || "Not resolved yet"}</p>
              </div>

              <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Pastoral Notes</p>
                <p className="mt-1 text-sm text-purple-900 whitespace-pre-wrap">{incident.pastoral_notes || "Restricted or not recorded"}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-gray-900">Consequences</h3>
                <span className="badge-blue">{incident.consequences?.length || 0} records</span>
              </div>

              <div className="mt-4 space-y-3">
                {(incident.consequences || []).length === 0 ? (
                  <p className="text-sm text-gray-500">No consequence records yet.</p>
                ) : (
                  incident.consequences?.map((row) => (
                    <article key={row.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 capitalize">{titleCase(row.consequence_type)}</p>
                        {row.parent_notified ? <span className="badge-green">Parent notified</span> : <span className="badge-yellow">Parent pending</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{row.description || "No description."}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        Starts {formatDate(row.starts_on)} {row.ends_on ? `• Ends ${formatDate(row.ends_on)}` : ""}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </article>

          <article className="space-y-6 xl:col-span-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Audit Snapshot</h3>
              <div className="mt-4 space-y-2 text-sm text-gray-700">
                <p>Created: {formatDateTime(incident.created_at)}</p>
                <p>Updated: {formatDateTime(incident.updated_at)}</p>
                <p>Resolved: {formatDateTime(incident.resolved_at)}</p>
                <p>Resolved by: {[incident.resolved_by_first_name, incident.resolved_by_last_name].filter(Boolean).join(" ").trim() || "-"}</p>
              </div>
            </div>

            {canReviewStatus && (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Manage Incident</h3>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="label-text">Status</span>
                    <select className="input-field" value={statusPatch} onChange={(e) => setStatusPatch(e.target.value as DisciplineIncidentStatus)}>
                      {hmReviewOnly ? (
                        <>
                          <option value="under_review">Under review</option>
                          <option value="escalated">Escalated</option>
                        </>
                      ) : (
                        <>
                          <option value="reported">Reported</option>
                          <option value="under_review">Under review</option>
                          <option value="escalated">Escalated</option>
                          <option value="resolved">Resolved</option>
                        </>
                      )}
                    </select>
                  </label>

                  {canLeadershipManage && (
                    <label className="block">
                      <span className="label-text">Resolution Notes</span>
                      <textarea className="input-field min-h-24" value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
                    </label>
                  )}

                  {canLeadershipManage && (
                    <label className="block">
                      <span className="label-text">Pastoral Notes (Restricted)</span>
                      <textarea className="input-field min-h-24" value={pastoralNotes} onChange={(e) => setPastoralNotes(e.target.value)} />
                    </label>
                  )}

                  {canLeadershipManage && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="h-4 w-4" checked={markSensitive} onChange={(e) => setMarkSensitive(e.target.checked)} />
                      Sensitive case (hidden from parent/student)
                    </label>
                  )}

                  <button type="button" className="btn-primary" disabled={saving} onClick={onSaveIncident}>
                    {saving ? "Saving..." : hmReviewOnly ? "Save Review Status" : "Save Incident"}
                  </button>
                </div>
              </div>
            )}

            {canLeadershipManage && (
              <form className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm" onSubmit={onAddConsequence}>
                <h3 className="text-lg font-semibold text-gray-900">Add Consequence</h3>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="label-text">Consequence Type</span>
                    <select className="input-field" value={consType} onChange={(e) => setConsType(e.target.value as DisciplineConsequenceType)}>
                      <option value="verbal_warning">Verbal warning</option>
                      <option value="written_warning">Written warning</option>
                      <option value="detention">Detention</option>
                      <option value="suspension">Suspension</option>
                      <option value="parent_meeting">Parent meeting</option>
                      <option value="community_service">Community service</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="label-text">Description</span>
                    <textarea className="input-field min-h-24" value={consDescription} onChange={(e) => setConsDescription(e.target.value)} />
                  </label>

                  <label className="block">
                    <span className="label-text">Starts On</span>
                    <input type="date" className="input-field" value={consStartsOn} onChange={(e) => setConsStartsOn(e.target.value)} required />
                  </label>

                  <label className="block">
                    <span className="label-text">Ends On</span>
                    <input type="date" className="input-field" value={consEndsOn} onChange={(e) => setConsEndsOn(e.target.value)} />
                  </label>

                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="h-4 w-4" checked={consParentNotified} onChange={(e) => setConsParentNotified(e.target.checked)} />
                    Parent notified
                  </label>

                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? "Adding..." : "Add Consequence"}
                  </button>
                </div>
              </form>
            )}

            <Link href="/dashboard/discipline" className="btn-secondary w-full justify-center">
              Back to Discipline Dashboard
            </Link>
          </article>
        </section>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}
