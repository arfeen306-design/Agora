"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import AdmissionsHeroCard from "@/components/dashboard/admissions/AdmissionsHeroCard";
import AdmissionsStageBoard from "@/components/dashboard/admissions/AdmissionsStageBoard";
import { ADMISSION_STAGE_LABEL, ADMISSION_STAGE_ORDER } from "@/components/dashboard/admissions/admission-utils";
import { useAuth } from "@/lib/auth";
import { getAdmissionsPipeline, type AdmissionPipelineData } from "@/lib/api";

const ADMISSIONS_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "headmistress"];

function canViewAdmissions(roles: string[] = []) {
  return ADMISSIONS_VIEW_ROLES.some((role) => roles.includes(role));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export default function AdmissionsDashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pipeline, setPipeline] = useState<AdmissionPipelineData | null>(null);

  const allowed = canViewAdmissions(user?.roles || []);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await getAdmissionsPipeline({ limit_per_stage: 4 });
        if (cancelled) return;
        setPipeline(response.data);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load admissions pipeline");
        setPipeline(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const stageCards = useMemo(() => {
    const stages = pipeline?.stages || {};
    return ADMISSION_STAGE_ORDER.map((stage) => ({
      stage,
      label: ADMISSION_STAGE_LABEL[stage],
      count: stages?.[stage]?.count || 0,
    }));
  }, [pipeline]);

  if (!allowed) {
    return (
      <>
        <Header title="Admissions Dashboard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              Admissions workflows are available for School Admin, Principal, Vice Principal, Headmistress, and Front Desk roles.
            </p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Admissions Dashboard" />
        <div className="p-6">
          <div className="h-56 animate-pulse rounded-2xl bg-indigo-100" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Admissions Dashboard" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <AdmissionsHeroCard
          activeCount={pipeline?.summary.total_active || 0}
          totalCount={pipeline?.summary.total || 0}
          conversionRate={pipeline?.summary.conversion_rate || 0}
          admittedCount={pipeline?.summary.admitted_count || 0}
          rejectedCount={pipeline?.summary.rejected_count || 0}
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stageCards.map((item) => (
            <article key={item.stage} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
              <p className="mt-2 text-3xl font-extrabold text-gray-900">{formatNumber(item.count)}</p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
              <p className="text-sm text-gray-500">Create inquiry records and work the pipeline with audit-safe transitions.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/admissions/pipeline" className="btn-secondary">Open Full Pipeline</Link>
              <Link href="/dashboard/admissions/applicants/new" className="btn-primary">New Applicant</Link>
              <Link href="/dashboard/students" className="btn-secondary">Student Registry</Link>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-lg font-semibold text-gray-900">Pipeline Snapshot</h3>
          <AdmissionsStageBoard stages={pipeline?.stages || {}} compact />
        </section>
      </div>
    </>
  );
}
