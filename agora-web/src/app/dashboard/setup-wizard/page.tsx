"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  getSetupWizardStatus,
  launchSetupWizard,
  type SetupWizardStatusRecord,
  type SetupWizardStepRecord,
  updateSetupWizardStep,
} from "@/lib/api";

const SETUP_WIZARD_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "hr_admin"];
const SETUP_WIZARD_MANAGE_ROLES = ["school_admin", "principal", "vice_principal"];

const STEP_ROUTE_MAP: Record<string, string> = {
  school_profile: "/dashboard/institution",
  academic_year: "/dashboard/institution",
  sections: "/dashboard/institution",
  classrooms: "/dashboard/institution",
  subjects: "/dashboard/institution",
  staff_setup: "/dashboard/people",
  students: "/dashboard/students",
  fee_plans: "/dashboard/fees",
  grading_system: "/dashboard/exam-terms",
  role_assignment: "/dashboard/access-control",
  notification_settings: "/dashboard/notifications",
};

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function statusTone(step: SetupWizardStepRecord) {
  if (step.is_completed) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

export default function SetupWizardPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, SETUP_WIZARD_VIEW_ROLES);
  const canManage = hasAnyRole(roles, SETUP_WIZARD_MANAGE_ROLES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<SetupWizardStatusRecord | null>(null);
  const [updatingStepCode, setUpdatingStepCode] = useState("");
  const [launching, setLaunching] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await getSetupWizardStatus();
      setStatus(result);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load setup wizard status."));
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const pendingSteps = useMemo(
    () => (status?.steps || []).filter((step) => !step.is_completed),
    [status]
  );

  async function handleToggleStep(step: SetupWizardStepRecord) {
    if (!canManage) return;
    if (step.auto_completed && !step.manual_completed) {
      setNotice("This step is automatically synced from core module data.");
      return;
    }

    setUpdatingStepCode(step.code);
    setError("");
    setNotice("");
    try {
      const nextCompleted = step.manual_completed ? false : true;
      const response = await updateSetupWizardStep(step.code, {
        is_completed: nextCompleted,
        notes: nextCompleted ? `Manually completed by ${user?.first_name || "operator"}` : "Re-opened for review",
      });
      setStatus(response.status);
      setNotice(nextCompleted ? "Step marked as completed." : "Step reopened.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update setup step."));
    } finally {
      setUpdatingStepCode("");
    }
  }

  async function handleLaunch() {
    if (!canManage || !status?.launch_ready) return;

    setLaunching(true);
    setError("");
    setNotice("");
    try {
      const response = await launchSetupWizard();
      setStatus(response.status);
      setNotice("Setup wizard launched successfully. School is now marked launch-ready.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to launch setup wizard."));
    } finally {
      setLaunching(false);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Setup Wizard" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              You do not have permission to view the first-time setup wizard.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Setup Wizard" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">First-Time Setup</p>
              <h2 className="mt-2 text-3xl font-extrabold">School Launch Readiness Wizard</h2>
              <p className="mt-2 max-w-2xl text-sm text-indigo-100">
                Track school onboarding completion, verify mandatory setup stages, and launch when all required steps are complete.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Completed" value={status?.completed_steps ?? 0} />
              <MetricCard label="Total Steps" value={status?.total_steps ?? 0} />
              <MetricCard label="Progress" value={`${status?.completion_percent ?? 0}%`} />
              <MetricCard label="Pending" value={pendingSteps.length} />
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-white/20">
            <div
              className="h-2 rounded-full bg-white transition-all"
              style={{ width: `${Math.max(0, Math.min(100, status?.completion_percent ?? 0))}%` }}
            />
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Step Checklist</h3>
              <p className="text-sm text-gray-500">
                Each step is auto-detected from real module data. Leadership can add manual completion where needed.
              </p>
            </div>
            {status?.launched_at ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                Launched {new Date(status.launched_at).toLocaleString()}
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                Not launched
              </span>
            )}
          </div>

          {loading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              Loading setup wizard status...
            </div>
          ) : (
            <div className="space-y-3">
              {(status?.steps || []).map((step) => {
                const route = STEP_ROUTE_MAP[step.code];
                const lockedAutoStep = step.auto_completed && !step.manual_completed;
                const canToggle = canManage && !lockedAutoStep;
                const isUpdating = updatingStepCode === step.code;

                return (
                  <article key={step.code} className="rounded-xl border border-gray-200 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold text-gray-900">{step.label}</h4>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(step)}`}>
                            {step.is_completed ? "Completed" : "Pending"}
                          </span>
                          {step.auto_completed && (
                            <span className="rounded-full border border-sky-200 bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                              Auto
                            </span>
                          )}
                          {step.manual_completed && (
                            <span className="rounded-full border border-violet-200 bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                              Manual
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                          Module: {step.owner_module.replaceAll("_", " ")}
                        </p>
                        {step.notes && (
                          <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                            {step.notes}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {route && (
                          <Link href={route} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                            Open Module
                          </Link>
                        )}
                        {canToggle && (
                          <button
                            type="button"
                            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleToggleStep(step)}
                            disabled={isUpdating}
                          >
                            {isUpdating
                              ? "Saving..."
                              : step.manual_completed
                                ? "Reopen Step"
                                : "Mark Complete"}
                          </button>
                        )}
                        {!canToggle && lockedAutoStep && (
                          <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                            Auto-synced
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Launch Checklist</h3>
              <p className="text-sm text-gray-500">
                Launch is enabled only when all required steps are completed.
              </p>
            </div>
            <button
              type="button"
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleLaunch}
              disabled={!canManage || !status?.launch_ready || launching}
            >
              {launching ? "Launching..." : "Launch School"}
            </button>
          </div>
          {!status?.launch_ready && (
            <p className="mt-3 text-sm text-amber-700">
              Complete all pending steps before launching. Pending: {pendingSteps.map((step) => step.label).join(", ") || "—"}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-indigo-100">{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
    </div>
  );
}
