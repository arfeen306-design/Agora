"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  downloadMyHrSalarySlipPdf,
  getMyHrOverview,
  type HrPayrollRecord,
  type HrSelfOverview,
} from "@/lib/api";

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

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function HrSelfServicePage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [overview, setOverview] = useState<HrSelfOverview | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getMyHrOverview();
      setOverview(response);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load self-service HR workspace"));
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const profile = (overview?.profile || {}) as Record<string, unknown>;
  const payrollHistory = (overview?.payroll_history || []) as HrPayrollRecord[];

  const summary = useMemo(() => {
    return {
      present: Number(overview?.attendance_summary?.present_days || 0),
      late: Number(overview?.attendance_summary?.late_days || 0),
      absent: Number(overview?.attendance_summary?.absent_days || 0),
      leaveApproved: Number(overview?.leave_summary?.approved_days || 0),
      currentNet: Number((overview?.payroll_history || [])[0]?.net_salary || 0),
    };
  }, [overview]);

  async function handleDownload(record: HrPayrollRecord) {
    setDownloadingId(record.id);
    setError("");
    setNotice("");
    try {
      const blob = await downloadMyHrSalarySlipPdf(record.id);
      const period = String(record.period_start || "salary").replace(/[^0-9-]/g, "");
      saveBlob(blob, `agora_salary_slip_${period}.pdf`);
      setNotice("Salary slip downloaded.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to download salary slip"));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <Header title="My HR & Finance" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">Teacher Self Service</p>
          <h2 className="mt-2 text-3xl font-extrabold">
            {user?.first_name ? `${user.first_name}, your HR and salary view` : "My HR and salary view"}
          </h2>
          <p className="mt-2 text-sm text-blue-100">
            This area is read-only and displays your employment profile, attendance summary, leave records, increments, and salary history.
          </p>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <MetricCard label="Present Days" value={summary.present} tone="emerald" loading={loading} />
          <MetricCard label="Late Days" value={summary.late} tone="amber" loading={loading} />
          <MetricCard label="Absent Days" value={summary.absent} tone="rose" loading={loading} />
          <MetricCard label="Approved Leave Days" value={summary.leaveApproved} tone="sky" loading={loading} />
          <MetricCard label="Current Net Salary" value={money(summary.currentNet)} tone="violet" loading={loading} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Employment Profile</h3>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoRow label="Staff Code" value={String(profile.staff_code || "—")} />
              <InfoRow label="Designation" value={String(profile.designation || "—")} />
              <InfoRow label="Department" value={String(profile.department || "—")} />
              <InfoRow label="Employment Type" value={String(profile.employment_type || "—")} />
              <InfoRow label="Contract Type" value={String(profile.contract_type || "—")} />
              <InfoRow label="Joining Date" value={String(profile.joining_date || "—")} />
              <InfoRow label="Confirmation Date" value={String(profile.confirmation_date || "—")} />
              <InfoRow label="Reporting Manager" value={`${String(profile.reporting_manager_first_name || "")} ${String(profile.reporting_manager_last_name || "")}`.trim() || "—"} />
              <InfoRow label="Status" value={String(profile.employment_status || "—")} />
            </dl>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Current Salary Components</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-700">
              <p><span className="font-semibold text-gray-900">Base Salary:</span> {money(Number(overview?.current_salary_structure?.base_salary || 0))}</p>
              <p><span className="font-semibold text-gray-900">Provident Fund:</span> {money(Number(overview?.current_salary_structure?.provident_fund || 0))}</p>
              <p><span className="font-semibold text-gray-900">GOP Fund:</span> {money(Number(overview?.current_salary_structure?.gop_fund || 0))}</p>
              <p><span className="font-semibold text-gray-900">Effective From:</span> {String(overview?.current_salary_structure?.effective_from || "—")}</p>
            </div>

            <h4 className="mt-6 text-sm font-semibold text-gray-800">Recent Adjustments</h4>
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {(overview?.adjustments || []).slice(0, 15).map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-gray-700">{item.adjustment_type}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(item.amount || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{item.status}</td>
                      <td className="px-3 py-2 text-gray-700">{item.effective_on}</td>
                    </tr>
                  ))}
                  {(overview?.adjustments || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-gray-500">No adjustments available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Payroll History</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Period</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Gross</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Net</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Salary Slip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">Loading payroll history...</td>
                  </tr>
                )}
                {!loading && payrollHistory.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">No payroll history available yet.</td>
                  </tr>
                )}
                {!loading &&
                  payrollHistory.map((record) => (
                    <tr key={record.id}>
                      <td className="px-3 py-2 text-gray-700">{record.period_label || "—"}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(record.gross_salary || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(record.net_salary || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{record.payment_status}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="rounded-md bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={downloadingId === record.id}
                          onClick={() => handleDownload(record)}
                        >
                          {downloadingId === record.id ? "Downloading..." : "Download PDF"}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-gray-900">{value || "—"}</dd>
    </div>
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
  tone: "emerald" | "amber" | "rose" | "sky" | "violet";
  loading?: boolean;
}) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  }[tone];

  return (
    <article className={`rounded-xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-white/70" />
      ) : (
        <p className="mt-2 text-2xl font-extrabold">{value}</p>
      )}
    </article>
  );
}
