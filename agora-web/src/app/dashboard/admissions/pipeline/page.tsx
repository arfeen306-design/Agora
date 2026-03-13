"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import Header from "@/components/Header";
import SavedViewsPanel from "@/components/filters/SavedViewsPanel";
import AdmissionStatusPill from "@/components/dashboard/admissions/AdmissionStatusPill";
import AdmissionsStageBoard from "@/components/dashboard/admissions/AdmissionsStageBoard";
import { useAuth } from "@/lib/auth";
import {
  buildShareUrl,
  loadSavedFilterViews,
  persistSavedFilterViews,
  type SavedFilterView,
  upsertSavedView,
} from "@/lib/saved-views";
import {
  getAdmissionApplications,
  getAdmissionsPipeline,
  getLookupAcademicYears,
  type AdmissionApplicationRow,
  type AdmissionPipelineData,
} from "@/lib/api";

const ADMISSIONS_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];
const ADMISSIONS_SAVED_VIEW_KEY = "agora_web_admissions_pipeline_saved_view_v1";
const ADMISSIONS_SAVED_VIEWS_KEY = "agora_web_admissions_pipeline_saved_views_v1";

function canViewAdmissions(roles: string[] = []) {
  return ADMISSIONS_VIEW_ROLES.some((role) => roles.includes(role));
}

export default function AdmissionPipelinePage() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string }>>([]);
  const [pipeline, setPipeline] = useState<AdmissionPipelineData | null>(null);
  const [applications, setApplications] = useState<AdmissionApplicationRow[]>([]);
  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const [viewMessage, setViewMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);

  const allowed = canViewAdmissions(user?.roles || []);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const existingViews = loadSavedFilterViews(ADMISSIONS_SAVED_VIEWS_KEY, ADMISSIONS_SAVED_VIEW_KEY);
    setSavedViews(existingViews);
    if (!params.toString()) {
      const latestView = existingViews[0];
      if (latestView?.query) {
        const savedParams = new URLSearchParams(latestView.query);
        savedParams.forEach((value, key) => params.set(key, value));
      }
    }

    setSearch(params.get("search") || "");
    setDateFrom(params.get("date_from") || "");
    setDateTo(params.get("date_to") || "");
    setAcademicYearId(params.get("academic_year_id") || "");
    setUrlSyncReady(true);
  }, [searchParams]);

  const buildCurrentQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (academicYearId) params.set("academic_year_id", academicYearId);
    return params.toString();
  }, [search, dateFrom, dateTo, academicYearId]);

  useEffect(() => {
    if (!urlSyncReady) return;
    setViewMessage("");
    const next = buildCurrentQuery();
    const current = searchParams.toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }, [urlSyncReady, buildCurrentQuery, pathname, router, searchParams]);

  const hasActiveFilters = Boolean(search.trim() || dateFrom || dateTo || academicYearId);
  const activeFilters = [
    search.trim() ? { key: "search", label: `Search: ${search.trim()}`, clear: () => setSearch("") } : null,
    dateFrom ? { key: "date_from", label: `From: ${dateFrom}`, clear: () => setDateFrom("") } : null,
    dateTo ? { key: "date_to", label: `To: ${dateTo}`, clear: () => setDateTo("") } : null,
    academicYearId
      ? {
          key: "academic_year_id",
          label: `Academic Year: ${academicYears.find((year) => year.id === academicYearId)?.label || academicYearId}`,
          clear: () => setAcademicYearId(""),
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  function clearAllFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setAcademicYearId("");
    setViewMessage("");
  }

  function saveCurrentView() {
    const query = buildCurrentQuery();
    if (!query) {
      setViewMessage("Add at least one filter before saving a view.");
      return;
    }
    try {
      const nextViews = upsertSavedView(savedViews, query, "Admission View");
      setSavedViews(nextViews);
      persistSavedFilterViews(ADMISSIONS_SAVED_VIEWS_KEY, nextViews, ADMISSIONS_SAVED_VIEW_KEY);
      setViewMessage("Saved view added.");
    } catch {
      setViewMessage("Unable to save view on this browser.");
    }
  }

  async function copyCurrentLink() {
    const url = buildShareUrl(pathname, buildCurrentQuery());
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Current link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  async function copySavedViewLink(view: SavedFilterView) {
    const url = buildShareUrl(pathname, view.query);
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Saved view link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  function applySavedView(view: SavedFilterView) {
    router.replace(`${pathname}?${view.query}`, { scroll: false });
    setViewMessage(`Applied "${view.name}".`);
  }

  function deleteSavedView(viewId: string) {
    const nextViews = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(nextViews);
    persistSavedFilterViews(ADMISSIONS_SAVED_VIEWS_KEY, nextViews, ADMISSIONS_SAVED_VIEW_KEY);
    setViewMessage("Saved view removed.");
  }

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;

    async function loadYears() {
      const rows = await getLookupAcademicYears({ page_size: 100 }).catch(() => []);
      if (cancelled || !Array.isArray(rows)) return;
      setAcademicYears(rows.map((row) => ({ id: row.id, label: row.label || row.name })));
    }

    loadYears();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const [pipelineRes, appsRes] = await Promise.all([
          getAdmissionsPipeline({
            limit_per_stage: 12,
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(dateFrom ? { date_from: dateFrom } : {}),
            ...(dateTo ? { date_to: dateTo } : {}),
            ...(academicYearId ? { academic_year_id: academicYearId } : {}),
          }),
          getAdmissionApplications({
            page: "1",
            page_size: "30",
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(dateFrom ? { date_from: dateFrom } : {}),
            ...(dateTo ? { date_to: dateTo } : {}),
            ...(academicYearId ? { academic_year_id: academicYearId } : {}),
          }),
        ]);

        if (cancelled) return;
        setPipeline(pipelineRes.data);
        setApplications(appsRes.data);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load admission pipeline");
        setPipeline(null);
        setApplications([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allowed, search, dateFrom, dateTo, academicYearId]);

  if (!allowed) {
    return (
      <>
        <Header title="Admission Pipeline" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              You do not have permission to view the admission pipeline.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Admission Pipeline" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {viewMessage && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {viewMessage}
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="label-text">Search Applicant</label>
              <input
                className="input-field"
                aria-label="Search Applicant"
                placeholder="Student code, applicant name, guardian contact"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="label-text">Date From</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date From"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div>
              <label className="label-text">Date To</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date To"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
            <div>
              <label className="label-text">Academic Year</label>
              <select
                className="input-field"
                aria-label="Academic Year"
                value={academicYearId}
                onChange={(event) => setAcademicYearId(event.target.value)}
              >
                <option value="">All Academic Years</option>
                {academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"
                  onClick={filter.clear}
                  type="button"
                >
                  {filter.label} ×
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={clearAllFilters}>Clear all</button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Link href="/dashboard/admissions" className="btn-secondary">Dashboard</Link>
              <Link href="/dashboard/admissions/applicants/new" className="btn-primary">New Applicant</Link>
            </div>
          </div>
          <SavedViewsPanel
            title="Saved Admission Views"
            views={savedViews}
            onSaveCurrent={saveCurrentView}
            onCopyCurrent={copyCurrentLink}
            onApply={applySavedView}
            onCopy={copySavedViewLink}
            onDelete={deleteSavedView}
            emptyText="Save filtered admission pipeline views for quick reuse."
          />
        </section>

        {loading ? (
          <div className="h-72 animate-pulse rounded-2xl bg-indigo-100" />
        ) : (
          <AdmissionsStageBoard stages={pipeline?.stages || {}} />
        )}

        <section className="table-container">
          <div className="border-b border-gray-200 px-5 py-4">
            <h3 className="text-lg font-semibold text-gray-900">Applicants List</h3>
            <p className="text-sm text-gray-500">Latest applicants with stage and guardian context.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Applicant</th>
                  <th className="px-4 py-3">Student Code</th>
                  <th className="px-4 py-3">Guardian</th>
                  <th className="px-4 py-3">Desired Placement</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                      No applicants found.
                    </td>
                  </tr>
                ) : (
                  applications.map((row) => (
                    <tr key={row.student_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {[row.first_name, row.last_name].filter(Boolean).join(" ")}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.student_code}</td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>{row.guardian_name || "-"}</div>
                        <div className="text-xs text-gray-500">{row.guardian_phone || row.guardian_email || "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {[row.desired_grade_label, row.desired_section_label].filter(Boolean).join(" - ") || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <AdmissionStatusPill status={row.admission_status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/admissions/applicants/${row.student_id}`}
                          className="text-sm font-semibold text-primary-700 hover:text-primary-800"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
