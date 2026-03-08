"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  getHrDashboardSummary,
  getHrPayrollPeriods,
  getPeopleStaff,
  type HrDashboardSummary,
  type HrPayrollPeriodRecord,
  type StaffMember,
} from "@/lib/api";

const HR_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"];

function canViewHr(roles: string[] = []) {
  return HR_VIEW_ROLES.some((role) => roles.includes(role));
}

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function roleBadge(staff: StaffMember) {
  if (staff.roles.includes("principal")) return "Leadership";
  if (staff.roles.includes("vice_principal")) return "Leadership";
  if (staff.roles.includes("hr_admin")) return "HR Admin";
  if (staff.roles.includes("accountant")) return "Finance";
  if (staff.roles.includes("headmistress")) return "Section Leadership";
  return staff.staff_type || "Staff";
}

export default function HrDashboardPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const allowed = canViewHr(roles);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<HrDashboardSummary | null>(null);
  const [staffRows, setStaffRows] = useState<StaffMember[]>([]);
  const [periods, setPeriods] = useState<HrPayrollPeriodRecord[]>([]);

  const loadData = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [summaryData, staffRes, periodsRes] = await Promise.all([
        getHrDashboardSummary(),
        getPeopleStaff({ page: "1", page_size: "120" }),
        getHrPayrollPeriods({ page: "1", page_size: "8" }),
      ]);

      setSummary(summaryData);
      setStaffRows(staffRes.data || []);
      setPeriods(periodsRes.data || []);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load HR dashboard."));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const activeTeachers = staffRows.filter((row) => row.staff_type === "teacher" && row.employment_status === "active").length;
    const activeNonTeachers = staffRows.filter((row) => row.staff_type !== "teacher" && row.employment_status === "active").length;
    const inactiveStaff = staffRows.filter((row) => row.employment_status !== "active" || !row.is_active).length;
    const pendingPeriods = periods.filter((row) => row.status === "draft" || row.status === "generated").length;
    return {
      activeTeachers,
      activeNonTeachers,
      inactiveStaff,
      pendingPeriods,
    };
  }, [staffRows, periods]);

  if (!allowed) {
    return (
      <>
        <Header title="HR & Payroll" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              This workspace is available to School Admin, Principal, Vice Principal, HR Admin, and Accountant.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="HR & Payroll" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Workforce Operations</p>
              <h2 className="mt-2 text-3xl font-extrabold">Human Resources and Payroll Command</h2>
              <p className="mt-2 max-w-2xl text-sm text-emerald-100">
                Manage staff records, payroll periods, salary structures, adjustments, and teacher self-service finance visibility.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/hr/payroll" className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
                Open Payroll Runs
              </Link>
              <Link href="/dashboard/people" className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20">
                Open People Management
              </Link>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Active Staff" value={summary?.active_staff ?? 0} tone="emerald" loading={loading} />
          <MetricCard label="Active Teachers" value={metrics.activeTeachers} tone="blue" loading={loading} />
          <MetricCard label="Non-Teaching Staff" value={metrics.activeNonTeachers} tone="violet" loading={loading} />
          <MetricCard label="Pending Payroll Cycles" value={summary?.open_payroll_periods ?? metrics.pendingPeriods} tone="amber" loading={loading} />
          <MetricCard label="Monthly Net Payroll" value={money(summary?.current_month_net_payroll ?? 0)} tone="rose" loading={loading} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Staff Directory Snapshot</h3>
              <Link href="/dashboard/people" className="text-sm font-semibold text-primary-700 hover:text-primary-800">
                Manage Staff
              </Link>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Open an HR profile to update employment details, salary structures, increments, and leave records.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Name</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Staff Code</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Designation</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Role Group</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading staff records...</td>
                    </tr>
                  )}
                  {!loading && staffRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-gray-500">No staff records found.</td>
                    </tr>
                  )}
                  {!loading &&
                    staffRows.slice(0, 16).map((staff) => (
                      <tr key={staff.id}>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {[staff.first_name, staff.last_name].filter(Boolean).join(" ")}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{staff.staff_code}</td>
                        <td className="px-3 py-2 text-gray-600">{staff.designation || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{roleBadge(staff)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${staff.employment_status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-700"}`}>
                            {staff.employment_status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/dashboard/hr/staff/${staff.id}`}
                            className="rounded-md bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100"
                          >
                            Open Profile
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">HR Queue</h3>
            <p className="mt-1 text-sm text-gray-500">Immediate workload and pending actions.</p>
            <div className="mt-4 space-y-3">
              <QueueCard label="Pending Adjustments" value={summary?.pending_adjustments ?? 0} tone="amber" />
              <QueueCard label="Pending Leave Requests" value={summary?.pending_leave_requests ?? 0} tone="sky" />
              <QueueCard label="Inactive Staff Profiles" value={metrics.inactiveStaff} tone="slate" />
              <QueueCard label="Open Payroll Periods" value={summary?.open_payroll_periods ?? 0} tone="rose" />
            </div>

            <div className="mt-5 border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-800">Quick Navigation</h4>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <Link href="/dashboard/hr/payroll" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Payroll periods and payment status
                </Link>
                <Link href="/dashboard/hr/self-service" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Teacher self-service preview
                </Link>
                <Link href="/dashboard/reports" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Finance and leadership reports
                </Link>
              </div>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string | number;
  tone: "emerald" | "blue" | "violet" | "amber" | "rose";
  loading?: boolean;
}) {
  const toneMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  } as const;

  return (
    <article className={`rounded-xl border px-4 py-3 shadow-sm ${toneMap[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-white/50" />
      ) : (
        <p className="mt-2 text-2xl font-extrabold">{value}</p>
      )}
    </article>
  );
}

function QueueCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "sky" | "rose" | "slate";
}) {
  const toneClass = {
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
