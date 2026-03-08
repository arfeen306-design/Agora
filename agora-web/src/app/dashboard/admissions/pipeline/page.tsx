"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Header from "@/components/Header";
import AdmissionStatusPill from "@/components/dashboard/admissions/AdmissionStatusPill";
import AdmissionsStageBoard from "@/components/dashboard/admissions/AdmissionsStageBoard";
import { useAuth } from "@/lib/auth";
import {
  getAdmissionApplications,
  getAdmissionsPipeline,
  type AdmissionApplicationRow,
  type AdmissionPipelineData,
} from "@/lib/api";

const ADMISSIONS_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];

function canViewAdmissions(roles: string[] = []) {
  return ADMISSIONS_VIEW_ROLES.some((role) => roles.includes(role));
}

export default function AdmissionPipelinePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pipeline, setPipeline] = useState<AdmissionPipelineData | null>(null);
  const [applications, setApplications] = useState<AdmissionApplicationRow[]>([]);

  const allowed = canViewAdmissions(user?.roles || []);

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
          }),
          getAdmissionApplications({
            page: "1",
            page_size: "30",
            ...(search.trim() ? { search: search.trim() } : {}),
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
  }, [allowed, search]);

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

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="w-full max-w-xl">
              <label className="label-text">Search Applicant</label>
              <input
                className="input-field"
                placeholder="Student code, applicant name, guardian contact"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/admissions" className="btn-secondary">Dashboard</Link>
              <Link href="/dashboard/admissions/applicants/new" className="btn-primary">New Applicant</Link>
            </div>
          </div>
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
