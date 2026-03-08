"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  getDisciplineIncidents,
  type DisciplineIncidentRecord,
  type DisciplineIncidentStatus,
  type DisciplineIncidentType,
  type DisciplineSeverity,
} from "@/lib/api";

type IncidentFilters = {
  status: "" | DisciplineIncidentStatus;
  severity: "" | DisciplineSeverity;
  incident_type: "" | DisciplineIncidentType;
  date_from: string;
  date_to: string;
};

const VIEW_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function asName(row: DisciplineIncidentRecord) {
  return [row.student_first_name, row.student_last_name].filter(Boolean).join(" ").trim() || row.student_code || "Student";
}

function asReporter(row: DisciplineIncidentRecord) {
  return [row.reported_by_first_name, row.reported_by_last_name].filter(Boolean).join(" ").trim() || "Unknown";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

function statusClass(status: DisciplineIncidentStatus) {
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

function severityClass(severity: DisciplineSeverity) {
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

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

export default function DisciplineDashboardPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [incidents, setIncidents] = useState<DisciplineIncidentRecord[]>([]);
  const [filters, setFilters] = useState<IncidentFilters>({
    status: "",
    severity: "",
    incident_type: "",
    date_from: "",
    date_to: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);

  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, VIEW_ROLES);
  const canCreate = hasAnyRole(roles, ["school_admin", "principal", "teacher"]);

  useEffect(() => {
    if (!user || !canView) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const params: Record<string, string> = {
          page: String(page),
          page_size: String(pageSize),
        };
        if (filters.status) params.status = filters.status;
        if (filters.severity) params.severity = filters.severity;
        if (filters.incident_type) params.incident_type = filters.incident_type;
        if (filters.date_from) params.date_from = filters.date_from;
        if (filters.date_to) params.date_to = filters.date_to;

        const response = await getDisciplineIncidents(params);
        if (cancelled) return;

        setIncidents(Array.isArray(response.data) ? response.data : []);
        setTotalPages(response.meta?.pagination?.total_pages || 1);
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load discipline incidents");
        }
        setIncidents([]);
        setTotalPages(1);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [canView, filters.date_from, filters.date_to, filters.incident_type, filters.severity, filters.status, page, pageSize, user]);

  const summary = useMemo(() => {
    return {
      open: incidents.filter((row) => row.status === "reported" || row.status === "under_review").length,
      escalated: incidents.filter((row) => row.status === "escalated").length,
      resolved: incidents.filter((row) => row.status === "resolved").length,
      critical: incidents.filter((row) => row.severity === "critical").length,
    };
  }, [incidents]);

  if (!canView) {
    return (
      <>
        <Header title="Discipline" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">Your role cannot access the discipline dashboard.</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Discipline & Pastoral Care" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-600 via-orange-500 to-amber-500 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-100">Leadership Console</p>
              <h2 className="mt-2 text-3xl font-black">Behavior and Pastoral Oversight</h2>
              <p className="mt-2 max-w-3xl text-sm text-rose-50">
                Track incidents, manage escalation, and monitor restorative actions with role-safe visibility controls.
              </p>
            </div>
            {canCreate && (
              <Link href="/dashboard/discipline/incidents/new" className="btn-secondary border-white/40 bg-white/10 text-white hover:bg-white/20">
                Report Incident
              </Link>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard title="Open" value={String(summary.open)} tone="amber" />
          <KpiCard title="Escalated" value={String(summary.escalated)} tone="rose" />
          <KpiCard title="Resolved" value={String(summary.resolved)} tone="emerald" />
          <KpiCard title="Critical Severity" value={String(summary.critical)} tone="violet" />
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SelectField
              label="Status"
              value={filters.status}
              onChange={(value) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, status: value as IncidentFilters["status"] }));
              }}
              options={[
                { value: "", label: "All statuses" },
                { value: "reported", label: "Reported" },
                { value: "under_review", label: "Under review" },
                { value: "resolved", label: "Resolved" },
                { value: "escalated", label: "Escalated" },
              ]}
            />
            <SelectField
              label="Severity"
              value={filters.severity}
              onChange={(value) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, severity: value as IncidentFilters["severity"] }));
              }}
              options={[
                { value: "", label: "All severities" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
            <SelectField
              label="Type"
              value={filters.incident_type}
              onChange={(value) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, incident_type: value as IncidentFilters["incident_type"] }));
              }}
              options={[
                { value: "", label: "All types" },
                { value: "minor_infraction", label: "Minor infraction" },
                { value: "major_infraction", label: "Major infraction" },
                { value: "positive_behavior", label: "Positive behavior" },
                { value: "bullying", label: "Bullying" },
                { value: "safety_concern", label: "Safety concern" },
              ]}
            />
            <DateField
              label="From"
              value={filters.date_from}
              onChange={(value) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, date_from: value }));
              }}
            />
            <DateField
              label="To"
              value={filters.date_to}
              onChange={(value) => {
                setPage(1);
                setFilters((prev) => ({ ...prev, date_to: value }));
              }}
            />
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reported by</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-gray-500" colSpan={7}>Loading incidents...</td>
                  </tr>
                ) : incidents.length === 0 ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-gray-500" colSpan={7}>
                      No incidents found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  incidents.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-4 py-3 text-gray-700">{formatDate(row.incident_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{asName(row)}</p>
                        <p className="text-xs text-gray-500">{row.classroom_code || row.grade_label ? `${row.grade_label || ""} ${row.section_label || ""}`.trim() : "Class not tagged"}</p>
                      </td>
                      <td className="px-4 py-3 capitalize text-gray-700">{titleCase(row.incident_type)}</td>
                      <td className="px-4 py-3">
                        <span className={severityClass(row.severity)}>{titleCase(row.severity)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusClass(row.status)}>{titleCase(row.status)}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{asReporter(row)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/discipline/incidents/${row.id}`} className="text-primary-700 hover:text-primary-900 font-semibold">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {Math.max(1, totalPages)}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function KpiCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "amber" | "rose" | "emerald" | "violet";
}) {
  const toneClass: Record<string, string> = {
    amber: "from-amber-500 to-orange-500",
    rose: "from-rose-500 to-red-600",
    emerald: "from-emerald-500 to-teal-600",
    violet: "from-violet-500 to-indigo-600",
  };

  return (
    <article className={`rounded-2xl bg-gradient-to-r ${toneClass[tone]} p-4 text-white shadow-sm`}>
      <p className="text-xs uppercase tracking-wide text-white/80">{title}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </article>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      <input type="date" className="input-field" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
