"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createHrAttendanceLog,
  createHrLeaveRecord,
  createHrSalaryAdjustment,
  createHrSalaryStructure,
  getStaffDocuments,
  getHrSalaryAdjustments,
  getHrSalaryStructures,
  getHrStaffProfile,
  issueDocumentDownloadUrl,
  updateHrStaffProfile,
  type DocumentVaultItem,
  type HrStaffProfilePayload,
  type HrSalaryAdjustmentRecord,
  type HrSalaryStructureRecord,
} from "@/lib/api";

const HR_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"];
const HR_MANAGE_ROLES = ["school_admin", "hr_admin"];
const HR_ADJUSTMENT_ROLES = ["school_admin", "hr_admin", "principal"];

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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function HrStaffProfilePage() {
  const params = useParams<{ staffId: string }>();
  const staffId = String(params?.staffId || "");

  const { user } = useAuth();
  const roles = user?.roles || [];
  const canView = hasAnyRole(roles, HR_VIEW_ROLES);
  const canManageProfile = hasAnyRole(roles, HR_MANAGE_ROLES);
  const canManageAdjustments = hasAnyRole(roles, HR_ADJUSTMENT_ROLES);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [profileResponse, setProfileResponse] = useState<HrStaffProfilePayload | null>(null);
  const [salaryStructures, setSalaryStructures] = useState<HrSalaryStructureRecord[]>([]);
  const [adjustments, setAdjustments] = useState<HrSalaryAdjustmentRecord[]>([]);
  const [staffDocuments, setStaffDocuments] = useState<DocumentVaultItem[]>([]);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingStructure, setSavingStructure] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [savingLeave, setSavingLeave] = useState(false);

  const [profileForm, setProfileForm] = useState({
    designation: "",
    department: "",
    employment_type: "",
    contract_type: "",
    reporting_manager_user_id: "",
    work_location: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    employment_status: "active",
    status_change_reason: "",
  });

  const [structureForm, setStructureForm] = useState({
    effective_from: todayIso(),
    base_salary: "0",
    allowance_label: "House Rent",
    allowance_amount: "0",
    deduction_label: "Tax",
    deduction_amount: "0",
    provident_fund: "0",
    gop_fund: "0",
  });

  const [adjustmentForm, setAdjustmentForm] = useState({
    adjustment_type: "increment",
    amount: "0",
    is_recurring: true,
    effective_on: todayIso(),
    reason: "",
    status: "approved",
  });

  const [attendanceForm, setAttendanceForm] = useState({
    attendance_date: todayIso(),
    check_in_at: "",
    check_out_at: "",
    status: "present",
    note: "",
  });

  const [leaveForm, setLeaveForm] = useState({
    leave_type: "casual",
    starts_on: todayIso(),
    ends_on: todayIso(),
    status: "approved",
    reason: "",
  });

  const loadData = useCallback(async () => {
    if (!canView || !staffId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [profileData, structuresRes, adjustmentRes] = await Promise.all([
        getHrStaffProfile(staffId),
        getHrSalaryStructures(staffId, { include_inactive: "true", page: "1", page_size: "40" }),
        getHrSalaryAdjustments(staffId, { page: "1", page_size: "50" }),
      ]);

      setProfileResponse(profileData);
      setSalaryStructures(structuresRes.data || []);
      setAdjustments(adjustmentRes.data || []);

      try {
        const docsRes = await getStaffDocuments(staffId, { page: 1, page_size: 20 });
        setStaffDocuments(Array.isArray(docsRes.data) ? docsRes.data : []);
      } catch {
        setStaffDocuments([]);
      }

      const profile = (profileData?.profile || {}) as Record<string, unknown>;
      setProfileForm((prev) => ({
        ...prev,
        designation: String(profile.designation || ""),
        department: String(profile.department || ""),
        employment_type: String(profile.employment_type || ""),
        contract_type: String(profile.contract_type || ""),
        reporting_manager_user_id: String(profile.reporting_manager_user_id || ""),
        work_location: String(profile.work_location || ""),
        emergency_contact_name: String(profile.emergency_contact_name || ""),
        emergency_contact_phone: String(profile.emergency_contact_phone || ""),
        employment_status: String(profile.employment_status || "active"),
      }));
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load staff HR profile"));
    } finally {
      setLoading(false);
    }
  }, [canView, staffId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const profile = useMemo(() => {
    return (profileResponse?.profile || {}) as Record<string, unknown>;
  }, [profileResponse]);

  const attendanceSummary = (profileResponse?.attendance_summary || {}) as Record<string, unknown>;
  const leaveSummary = (profileResponse?.leave_summary || {}) as Record<string, unknown>;
  const latestPayroll = (profileResponse?.latest_payroll_record || {}) as Record<string, unknown>;
  const latestSalary = (profileResponse?.latest_salary_structure || {}) as Record<string, unknown>;

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    if (!canManageProfile) return;
    setSavingProfile(true);
    setError("");
    setNotice("");
    try {
      await updateHrStaffProfile(staffId, {
        designation: profileForm.designation || undefined,
        department: profileForm.department || undefined,
        employment_type: profileForm.employment_type || undefined,
        contract_type: profileForm.contract_type || undefined,
        reporting_manager_user_id: profileForm.reporting_manager_user_id || null,
        work_location: profileForm.work_location || null,
        emergency_contact_name: profileForm.emergency_contact_name || null,
        emergency_contact_phone: profileForm.emergency_contact_phone || null,
        employment_status: profileForm.employment_status,
        status_change_reason: profileForm.status_change_reason || undefined,
      });
      setNotice("HR profile updated.");
      setProfileForm((prev) => ({ ...prev, status_change_reason: "" }));
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update HR profile"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCreateStructure(event: FormEvent) {
    event.preventDefault();
    if (!canManageProfile) return;
    setSavingStructure(true);
    setError("");
    setNotice("");
    try {
      await createHrSalaryStructure(staffId, {
        effective_from: structureForm.effective_from,
        base_salary: Number(structureForm.base_salary || 0),
        allowances: [{ label: structureForm.allowance_label || "Allowance", amount: Number(structureForm.allowance_amount || 0) }],
        deductions: [{ label: structureForm.deduction_label || "Deduction", amount: Number(structureForm.deduction_amount || 0) }],
        bonuses: [],
        provident_fund: Number(structureForm.provident_fund || 0),
        gop_fund: Number(structureForm.gop_fund || 0),
      });
      setNotice("Salary structure created.");
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create salary structure"));
    } finally {
      setSavingStructure(false);
    }
  }

  async function handleCreateAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!canManageAdjustments) return;
    setSavingAdjustment(true);
    setError("");
    setNotice("");
    try {
      await createHrSalaryAdjustment(staffId, {
        adjustment_type: adjustmentForm.adjustment_type as "increment" | "allowance" | "deduction" | "bonus" | "one_time",
        amount: Number(adjustmentForm.amount || 0),
        is_recurring: adjustmentForm.is_recurring,
        effective_on: adjustmentForm.effective_on,
        reason: adjustmentForm.reason || undefined,
        status: adjustmentForm.status as "pending" | "approved" | "rejected",
      });
      setNotice("Salary adjustment saved.");
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create salary adjustment"));
    } finally {
      setSavingAdjustment(false);
    }
  }

  async function handleAttendanceLog(event: FormEvent) {
    event.preventDefault();
    if (!canManageProfile) return;
    setSavingAttendance(true);
    setError("");
    setNotice("");
    try {
      await createHrAttendanceLog(staffId, {
        attendance_date: attendanceForm.attendance_date,
        check_in_at: attendanceForm.check_in_at || undefined,
        check_out_at: attendanceForm.check_out_at || undefined,
        status: attendanceForm.status as "present" | "absent" | "late" | "leave",
        note: attendanceForm.note || undefined,
      });
      setNotice("Attendance log saved.");
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to save attendance log"));
    } finally {
      setSavingAttendance(false);
    }
  }

  async function handleLeaveRecord(event: FormEvent) {
    event.preventDefault();
    if (!canManageAdjustments) return;
    setSavingLeave(true);
    setError("");
    setNotice("");
    try {
      await createHrLeaveRecord(staffId, {
        leave_type: leaveForm.leave_type,
        starts_on: leaveForm.starts_on,
        ends_on: leaveForm.ends_on,
        status: leaveForm.status as "pending" | "approved" | "rejected" | "cancelled",
        reason: leaveForm.reason || undefined,
      });
      setNotice("Leave record saved.");
      await loadData();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to save leave record"));
    } finally {
      setSavingLeave(false);
    }
  }

  async function handleDocumentDownload(documentId: string) {
    setError("");
    try {
      const payload = await issueDocumentDownloadUrl(documentId);
      if (payload.download?.url) {
        window.open(payload.download.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to generate download URL"));
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Staff HR Profile" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">You do not have permission to view HR staff profiles.</p>
          </section>
        </div>
      </>
    );
  }

  const fullName = [String(profile.first_name || ""), String(profile.last_name || "")].filter(Boolean).join(" ") || "Staff";

  return (
    <>
      <Header title="Staff HR Profile" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100">HR Profile</p>
              <h2 className="mt-2 text-3xl font-extrabold">{fullName}</h2>
              <p className="mt-2 text-sm text-violet-100">
                Staff Code: {String(profile.staff_code || "—")} • Designation: {String(profile.designation || "—")}
              </p>
            </div>
            <Link href="/dashboard/hr" className="rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30">
              Back to HR Dashboard
            </Link>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="Present Days (Month)" value={Number(attendanceSummary.present_days || 0)} tone="emerald" />
          <MetricCard label="Late Days (Month)" value={Number(attendanceSummary.late_days || 0)} tone="amber" />
          <MetricCard label="Approved Leave Days" value={Number(leaveSummary.approved_days || 0)} tone="sky" />
          <MetricCard label="Latest Net Salary" value={money(Number(latestPayroll.net_salary || 0))} tone="violet" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Employment Details</h3>
            <form className="mt-4 space-y-3" onSubmit={handleProfileSave}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Designation" value={profileForm.designation} onChange={(value) => setProfileForm((prev) => ({ ...prev, designation: value }))} />
                <Field label="Department" value={profileForm.department} onChange={(value) => setProfileForm((prev) => ({ ...prev, department: value }))} />
                <Field label="Employment Type" value={profileForm.employment_type} onChange={(value) => setProfileForm((prev) => ({ ...prev, employment_type: value }))} />
                <Field label="Contract Type" value={profileForm.contract_type} onChange={(value) => setProfileForm((prev) => ({ ...prev, contract_type: value }))} />
                <Field label="Work Location" value={profileForm.work_location} onChange={(value) => setProfileForm((prev) => ({ ...prev, work_location: value }))} />
                <Field label="Reporting Manager User ID" value={profileForm.reporting_manager_user_id} onChange={(value) => setProfileForm((prev) => ({ ...prev, reporting_manager_user_id: value }))} />
                <Field label="Emergency Contact Name" value={profileForm.emergency_contact_name} onChange={(value) => setProfileForm((prev) => ({ ...prev, emergency_contact_name: value }))} />
                <Field label="Emergency Contact Phone" value={profileForm.emergency_contact_phone} onChange={(value) => setProfileForm((prev) => ({ ...prev, emergency_contact_phone: value }))} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="label-text">Employment Status</span>
                  <select
                    className="input-field"
                    value={profileForm.employment_status}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, employment_status: event.target.value }))}
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                    <option value="on_leave">on_leave</option>
                    <option value="terminated">terminated</option>
                  </select>
                </label>
                <Field
                  label="Status Change Reason"
                  value={profileForm.status_change_reason}
                  onChange={(value) => setProfileForm((prev) => ({ ...prev, status_change_reason: value }))}
                />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManageProfile || savingProfile || loading}>
                  {savingProfile ? "Saving..." : "Save HR Details"}
                </button>
              </div>
            </form>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Current Salary Snapshot</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <p><span className="font-semibold text-gray-800">Effective From:</span> {String(latestSalary.effective_from || "—")}</p>
              <p><span className="font-semibold text-gray-800">Base Salary:</span> {money(Number(latestSalary.base_salary || 0))}</p>
              <p><span className="font-semibold text-gray-800">Provident Fund:</span> {money(Number(latestSalary.provident_fund || 0))}</p>
              <p><span className="font-semibold text-gray-800">GOP Fund:</span> {money(Number(latestSalary.gop_fund || 0))}</p>
            </div>

            <form className="mt-5 space-y-3 border-t border-gray-100 pt-4" onSubmit={handleCreateStructure}>
              <h4 className="text-sm font-semibold text-gray-800">Add Salary Structure</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="label-text">Effective From</span>
                  <input
                    type="date"
                    className="input-field"
                    value={structureForm.effective_from}
                    onChange={(event) => setStructureForm((prev) => ({ ...prev, effective_from: event.target.value }))}
                    required
                  />
                </label>
                <Field label="Base Salary" value={structureForm.base_salary} onChange={(value) => setStructureForm((prev) => ({ ...prev, base_salary: value }))} />
                <Field label="Allowance Label" value={structureForm.allowance_label} onChange={(value) => setStructureForm((prev) => ({ ...prev, allowance_label: value }))} />
                <Field label="Allowance Amount" value={structureForm.allowance_amount} onChange={(value) => setStructureForm((prev) => ({ ...prev, allowance_amount: value }))} />
                <Field label="Deduction Label" value={structureForm.deduction_label} onChange={(value) => setStructureForm((prev) => ({ ...prev, deduction_label: value }))} />
                <Field label="Deduction Amount" value={structureForm.deduction_amount} onChange={(value) => setStructureForm((prev) => ({ ...prev, deduction_amount: value }))} />
                <Field label="Provident Fund" value={structureForm.provident_fund} onChange={(value) => setStructureForm((prev) => ({ ...prev, provident_fund: value }))} />
                <Field label="GOP Fund" value={structureForm.gop_fund} onChange={(value) => setStructureForm((prev) => ({ ...prev, gop_fund: value }))} />
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManageProfile || savingStructure || loading}>
                  {savingStructure ? "Saving..." : "Add Salary Structure"}
                </button>
              </div>
            </form>
          </article>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Adjustments and Increments</h3>
            <form className="mt-4 space-y-3" onSubmit={handleCreateAdjustment}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="label-text">Type</span>
                  <select
                    className="input-field"
                    value={adjustmentForm.adjustment_type}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, adjustment_type: event.target.value }))}
                  >
                    <option value="increment">increment</option>
                    <option value="allowance">allowance</option>
                    <option value="deduction">deduction</option>
                    <option value="bonus">bonus</option>
                    <option value="one_time">one_time</option>
                  </select>
                </label>
                <Field label="Amount" value={adjustmentForm.amount} onChange={(value) => setAdjustmentForm((prev) => ({ ...prev, amount: value }))} />
                <label className="block">
                  <span className="label-text">Effective On</span>
                  <input
                    type="date"
                    className="input-field"
                    value={adjustmentForm.effective_on}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, effective_on: event.target.value }))}
                    required
                  />
                </label>
                <label className="block">
                  <span className="label-text">Status</span>
                  <select
                    className="input-field"
                    value={adjustmentForm.status}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="approved">approved</option>
                    <option value="pending">pending</option>
                    <option value="rejected">rejected</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="label-text">Reason</span>
                  <input
                    className="input-field"
                    value={adjustmentForm.reason}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, reason: event.target.value }))}
                    placeholder="Annual increment / correction / bonus rationale"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={adjustmentForm.is_recurring}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, is_recurring: event.target.checked }))}
                  />
                  Recurring adjustment
                </label>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManageAdjustments || savingAdjustment || loading}>
                  {savingAdjustment ? "Saving..." : "Save Adjustment"}
                </button>
              </div>
            </form>
            <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {adjustments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-5 text-center text-gray-500">No salary adjustments found.</td>
                    </tr>
                  )}
                  {adjustments.slice(0, 30).map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-gray-700">{row.adjustment_type}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(row.amount || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{row.status}</td>
                      <td className="px-3 py-2 text-gray-700">{row.effective_on}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Attendance and Leave Updates</h3>
            <form className="mt-4 space-y-3 border-b border-gray-100 pb-4" onSubmit={handleAttendanceLog}>
              <h4 className="text-sm font-semibold text-gray-800">Attendance Log</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="label-text">Date</span>
                  <input type="date" className="input-field" value={attendanceForm.attendance_date} onChange={(event) => setAttendanceForm((prev) => ({ ...prev, attendance_date: event.target.value }))} />
                </label>
                <label className="block">
                  <span className="label-text">Status</span>
                  <select className="input-field" value={attendanceForm.status} onChange={(event) => setAttendanceForm((prev) => ({ ...prev, status: event.target.value }))}>
                    <option value="present">present</option>
                    <option value="late">late</option>
                    <option value="absent">absent</option>
                    <option value="leave">leave</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label-text">Check In (ISO datetime)</span>
                  <input className="input-field" value={attendanceForm.check_in_at} onChange={(event) => setAttendanceForm((prev) => ({ ...prev, check_in_at: event.target.value }))} placeholder="2026-03-08T08:00:00Z" />
                </label>
                <label className="block">
                  <span className="label-text">Check Out (ISO datetime)</span>
                  <input className="input-field" value={attendanceForm.check_out_at} onChange={(event) => setAttendanceForm((prev) => ({ ...prev, check_out_at: event.target.value }))} placeholder="2026-03-08T15:00:00Z" />
                </label>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManageProfile || savingAttendance || loading}>
                  {savingAttendance ? "Saving..." : "Save Attendance"}
                </button>
              </div>
            </form>

            <form className="mt-4 space-y-3" onSubmit={handleLeaveRecord}>
              <h4 className="text-sm font-semibold text-gray-800">Leave Record</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Leave Type" value={leaveForm.leave_type} onChange={(value) => setLeaveForm((prev) => ({ ...prev, leave_type: value }))} />
                <label className="block">
                  <span className="label-text">Status</span>
                  <select className="input-field" value={leaveForm.status} onChange={(event) => setLeaveForm((prev) => ({ ...prev, status: event.target.value }))}>
                    <option value="approved">approved</option>
                    <option value="pending">pending</option>
                    <option value="rejected">rejected</option>
                    <option value="cancelled">cancelled</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label-text">Start Date</span>
                  <input type="date" className="input-field" value={leaveForm.starts_on} onChange={(event) => setLeaveForm((prev) => ({ ...prev, starts_on: event.target.value }))} />
                </label>
                <label className="block">
                  <span className="label-text">End Date</span>
                  <input type="date" className="input-field" value={leaveForm.ends_on} onChange={(event) => setLeaveForm((prev) => ({ ...prev, ends_on: event.target.value }))} />
                </label>
                <label className="block md:col-span-2">
                  <span className="label-text">Reason</span>
                  <textarea className="input-field min-h-[88px]" value={leaveForm.reason} onChange={(event) => setLeaveForm((prev) => ({ ...prev, reason: event.target.value }))} />
                </label>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canManageAdjustments || savingLeave || loading}>
                  {savingLeave ? "Saving..." : "Save Leave"}
                </button>
              </div>
            </form>
          </article>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Salary History</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Effective</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Base</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Provident</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">GOP</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">Loading salary history...</td>
                  </tr>
                )}
                {!loading && salaryStructures.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">No salary structure records found.</td>
                  </tr>
                )}
                {!loading &&
                  salaryStructures.map((structure) => (
                    <tr key={structure.id}>
                      <td className="px-3 py-2 text-gray-700">{structure.effective_from}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(structure.base_salary || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(structure.provident_fund || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{money(Number(structure.gop_fund || 0))}</td>
                      <td className="px-3 py-2 text-gray-700">{structure.is_active ? "active" : "inactive"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-gray-900">Linked Documents</h3>
            <Link href={`/dashboard/documents?scope_type=staff&scope_id=${staffId}`} className="btn-secondary">
              Open Document Vault
            </Link>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Appointment letters, salary slips, contracts, and HR documents linked to this staff profile.
          </p>
          <div className="mt-4 space-y-2">
            {staffDocuments.length === 0 ? (
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                No staff-linked documents available yet.
              </p>
            ) : (
              staffDocuments.slice(0, 12).map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{doc.title}</p>
                    <p className="text-xs text-gray-500">
                      {doc.category.replaceAll("_", " ")} • {new Date(doc.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/dashboard/documents/${doc.id}`} className="btn-secondary">
                      View
                    </Link>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleDocumentDownload(doc.id)}
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      <input className="input-field" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "emerald" | "amber" | "sky" | "violet";
}) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  }[tone];

  return (
    <article className={`rounded-xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
    </article>
  );
}
