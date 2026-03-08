"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createHrPayrollPeriod,
  generateHrPayroll,
  getHrPayrollPeriods,
  getHrPayrollRecords,
  updateHrPayrollPayment,
  type HrPayrollPeriodRecord,
  type HrPayrollRecord,
} from "@/lib/api";

const HR_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"];
const HR_MANAGE_ROLES = ["school_admin", "hr_admin", "accountant"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
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

function defaultPeriodWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    period_label: `${start.toISOString().slice(0, 7)} Payroll`,
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
  };
}

export default function HrPayrollPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, HR_VIEW_ROLES);
  const canManage = hasAnyRole(roles, HR_MANAGE_ROLES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [periods, setPeriods] = useState<HrPayrollPeriodRecord[]>([]);
  const [records, setRecords] = useState<HrPayrollRecord[]>([]);
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [runningPeriodId, setRunningPeriodId] = useState<string | null>(null);
  const [payingRecordId, setPayingRecordId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultPeriodWindow());

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [periodRes, recordsRes] = await Promise.all([
        getHrPayrollPeriods({ page: "1", page_size: "20" }),
        getHrPayrollRecords({ page: "1", page_size: "120" }),
      ]);
      setPeriods(periodRes.data || []);
      setRecords(recordsRes.data || []);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load payroll workspace"));
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recordMetrics = useMemo(() => {
    const pending = records.filter((row) => row.payment_status === "pending").length;
    const paid = records.filter((row) => row.payment_status === "paid").length;
    const cancelled = records.filter((row) => row.payment_status === "cancelled").length;
    const net = records.reduce((sum, row) => sum + Number(row.net_salary || 0), 0);
    return { pending, paid, cancelled, net };
  }, [records]);

  async function handleCreatePeriod(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setSavingPeriod(true);
    setError("");
    setNotice("");
    try {
      await createHrPayrollPeriod(form);
      setNotice("Payroll period created.");
      setForm(defaultPeriodWindow());
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create payroll period"));
    } finally {
      setSavingPeriod(false);
    }
  }

  async function handleGenerate(periodId: string) {
    if (!canManage) return;
    setRunningPeriodId(periodId);
    setError("");
    setNotice("");
    try {
      const result = await generateHrPayroll(periodId);
      const generated = Number(result.data?.generated_records || 0);
      const skipped = Number(result.data?.skipped_staff_without_structure || 0);
      setNotice(`Payroll generated. Records: ${generated}. Skipped (no salary structure): ${skipped}.`);
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to generate payroll records"));
    } finally {
      setRunningPeriodId(null);
    }
  }

  async function handleMarkPaid(recordId: string) {
    if (!canManage) return;
    setPayingRecordId(recordId);
    setError("");
    setNotice("");
    try {
      await updateHrPayrollPayment(recordId, {
        payment_status: "paid",
        paid_on: new Date().toISOString().slice(0, 10),
        payment_method: "bank_transfer",
      });
      setNotice("Payroll payment status updated to paid.");
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update payment status"));
    } finally {
      setPayingRecordId(null);
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Payroll Runs" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">You do not have payroll visibility in this school.</p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Payroll Runs" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-6 text-white shadow-lg">
          <h2 className="text-3xl font-extrabold">Payroll Processing and Payment Control</h2>
          <p className="mt-2 text-sm text-indigo-100">
            Create payroll periods, generate payroll records from active salary structures, and close payment cycles.
          </p>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="Pending Payments" value={recordMetrics.pending} tone="amber" />
          <MetricCard label="Paid Records" value={recordMetrics.paid} tone="emerald" />
          <MetricCard label="Cancelled" value={recordMetrics.cancelled} tone="slate" />
          <MetricCard label="Net Payroll" value={money(recordMetrics.net)} tone="blue" />
        </section>

        {canManage && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Create Payroll Period</h3>
            <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4" onSubmit={handleCreatePeriod}>
              <label className="block md:col-span-2">
                <span className="label-text">Period Label</span>
                <input
                  className="input-field"
                  value={form.period_label}
                  onChange={(event) => setForm((prev) => ({ ...prev, period_label: event.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="label-text">Start Date</span>
                <input
                  type="date"
                  className="input-field"
                  value={form.period_start}
                  onChange={(event) => setForm((prev) => ({ ...prev, period_start: event.target.value }))}
                  required
                />
              </label>
              <label className="block">
                <span className="label-text">End Date</span>
                <input
                  type="date"
                  className="input-field"
                  value={form.period_end}
                  onChange={(event) => setForm((prev) => ({ ...prev, period_end: event.target.value }))}
                  required
                />
              </label>
              <div className="md:col-span-4 flex justify-end">
                <button type="submit" className="btn-primary" disabled={savingPeriod}>
                  {savingPeriod ? "Creating..." : "Create Payroll Period"}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Payroll Periods</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Label</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Date Range</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Records</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Net Total</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading payroll periods...</td>
                  </tr>
                )}
                {!loading && periods.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">No payroll period has been created yet.</td>
                  </tr>
                )}
                {!loading &&
                  periods.map((period) => (
                    <tr key={period.id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{period.period_label}</td>
                      <td className="px-3 py-2 text-gray-600">{period.period_start} to {period.period_end}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          period.status === "paid"
                            ? "bg-emerald-100 text-emerald-700"
                            : period.status === "generated"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                        }`}>
                          {period.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{period.payroll_record_count ?? 0}</td>
                      <td className="px-3 py-2 text-gray-600">{money(Number(period.net_payroll_total || 0))}</td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <button
                            type="button"
                            className="rounded-md bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={runningPeriodId === period.id}
                            onClick={() => handleGenerate(period.id)}
                          >
                            {runningPeriodId === period.id ? "Generating..." : "Generate Payroll"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Payroll Records</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Staff</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Period</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Gross</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Net</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">Loading payroll records...</td>
                  </tr>
                )}
                {!loading && records.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">No payroll records generated yet.</td>
                  </tr>
                )}
                {!loading &&
                  records.slice(0, 120).map((record) => (
                    <tr key={record.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{`${record.first_name || ""} ${record.last_name || ""}`.trim() || "Staff"}</p>
                        <p className="text-xs text-gray-500">{record.staff_code || "—"}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{record.period_label || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{money(Number(record.gross_salary || 0))}</td>
                      <td className="px-3 py-2 text-gray-600">{money(Number(record.net_salary || 0))}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          record.payment_status === "paid"
                            ? "bg-emerald-100 text-emerald-700"
                            : record.payment_status === "cancelled"
                              ? "bg-gray-200 text-gray-700"
                              : "bg-amber-100 text-amber-700"
                        }`}>
                          {record.payment_status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canManage && record.payment_status !== "paid" ? (
                          <button
                            type="button"
                            className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={payingRecordId === record.id}
                            onClick={() => handleMarkPaid(record.id)}
                          >
                            {payingRecordId === record.id ? "Saving..." : "Mark Paid"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
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

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "amber" | "emerald" | "slate" | "blue";
}) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
  }[tone];

  return (
    <article className={`rounded-xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
    </article>
  );
}
