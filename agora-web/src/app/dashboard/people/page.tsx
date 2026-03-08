"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  createPeopleStaff,
  createPeopleStudent,
  executeImportJob,
  exportImportErrorsCsv,
  getImportJob,
  getImportJobs,
  getLookupAcademicYears,
  getLookupClassrooms,
  getLookupSections,
  getPeopleStaff,
  getPeopleStudents,
  ImportJobRecord,
  previewStudentImport,
  StaffMember,
  StudentMasterRow,
} from "@/lib/api";

const PEOPLE_PAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "hr_admin"];

function canAccessPeoplePage(roles: string[] = []) {
  return PEOPLE_PAGE_ROLES.some((role) => roles.includes(role));
}

const roleChoices = [
  { code: "teacher", label: "Teacher" },
  { code: "headmistress", label: "Headmistress" },
  { code: "principal", label: "Principal" },
  { code: "vice_principal", label: "Vice Principal" },
  { code: "accountant", label: "Accountant" },
  { code: "front_desk", label: "Front Desk" },
  { code: "hr_admin", label: "HR Admin" },
];

const requiredImportFields = [
  "student_code",
  "class_label",
  "section_label",
  "father_name",
  "whatsapp_number",
  "mobile_number",
  "admission_date",
  "guardian_relation",
  "emergency_contact",
];

function normalizeErrorText(text?: string) {
  return text ? text.replaceAll("_", " ") : "";
}

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read selected file"));
    reader.readAsDataURL(file);
  });
}

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function PeoplePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canAccess = canAccessPeoplePage(user?.roles || []);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [students, setStudents] = useState<StudentMasterRow[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJobRecord[]>([]);
  const [importPreview, setImportPreview] = useState<ImportJobRecord | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importFileName, setImportFileName] = useState("");
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importingPreview, setImportingPreview] = useState(false);
  const [executingImport, setExecutingImport] = useState(false);
  const [downloadingErrorsFor, setDownloadingErrorsFor] = useState<string | null>(null);

  const [sections, setSections] = useState<Array<{ id: string; label: string }>>([]);
  const [classrooms, setClassrooms] = useState<Array<{ id: string; label: string }>>([]);
  const [years, setYears] = useState<Array<{ id: string; label: string }>>([]);

  const [creatingStaff, setCreatingStaff] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);

  const [staffForm, setStaffForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    temporary_password: "ChangeMe123!",
    staff_code: "",
    staff_type: "teacher",
    designation: "",
    joining_date: "",
    primary_section_id: "",
    role_code: "teacher",
  });

  const [studentForm, setStudentForm] = useState({
    student_code: "",
    first_name: "",
    last_name: "",
    admission_date: "",
    classroom_id: "",
    academic_year_id: "",
    roll_no: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
  });

  const loadData = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const [staffRes, studentsRes, sectionRows, classroomRows, yearRows, importJobsRes] = await Promise.all([
        getPeopleStaff({ page_size: "80" }),
        getPeopleStudents({ page_size: "80" }),
        getLookupSections({ page_size: 120 }),
        getLookupClassrooms({ page_size: 120 }),
        getLookupAcademicYears({ page_size: 30 }),
        getImportJobs({ page_size: "20", import_type: "students" }),
      ]);

      setStaff(staffRes.data);
      setStudents(studentsRes.data);
      setSections(sectionRows);
      setClassrooms(classroomRows.map((row) => ({ id: row.id, label: row.label })));
      setYears(yearRows.map((row) => ({ id: row.id, label: row.label })));
      setImportJobs(importJobsRes.data);

      setStudentForm((prev) => ({
        ...prev,
        academic_year_id: prev.academic_year_id || yearRows.find((row) => row.is_current)?.id || yearRows[0]?.id || "",
      }));
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load people management data"));
    } finally {
      setLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!canAccess) {
    return (
      <>
        <Header title="People Management" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              This screen is available to School Admin, Principal, Vice Principal, Headmistress, and HR Admin.
            </p>
          </section>
        </div>
      </>
    );
  }

  const teacherCount = staff.filter((row) => row.roles.includes("teacher") || row.staff_type === "teacher").length;

  async function handleCreateStaff(e: FormEvent) {
    e.preventDefault();
    setCreatingStaff(true);
    setError("");
    setNotice("");

    try {
      await createPeopleStaff({
        first_name: staffForm.first_name,
        last_name: staffForm.last_name,
        email: staffForm.email,
        phone: staffForm.phone,
        temporary_password: staffForm.temporary_password,
        staff_code: staffForm.staff_code,
        staff_type: staffForm.staff_type,
        designation: staffForm.designation,
        joining_date: staffForm.joining_date || undefined,
        primary_section_id: staffForm.primary_section_id || undefined,
        roles: [staffForm.role_code],
      });

      setStaffForm({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        temporary_password: "ChangeMe123!",
        staff_code: "",
        staff_type: "teacher",
        designation: "",
        joining_date: "",
        primary_section_id: "",
        role_code: "teacher",
      });

      await loadData();
      setNotice("Staff account created successfully.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create staff"));
    } finally {
      setCreatingStaff(false);
    }
  }

  async function handleCreateStudent(e: FormEvent) {
    e.preventDefault();
    setCreatingStudent(true);
    setError("");
    setNotice("");

    try {
      await createPeopleStudent({
        student_code: studentForm.student_code,
        first_name: studentForm.first_name,
        last_name: studentForm.last_name || undefined,
        admission_date: studentForm.admission_date || undefined,
        classroom_id: studentForm.classroom_id || undefined,
        academic_year_id: studentForm.academic_year_id || undefined,
        roll_no: studentForm.roll_no ? Number(studentForm.roll_no) : undefined,
        emergency_contact_name: studentForm.emergency_contact_name || undefined,
        emergency_contact_phone: studentForm.emergency_contact_phone || undefined,
      });

      setStudentForm((prev) => ({
        ...prev,
        student_code: "",
        first_name: "",
        last_name: "",
        admission_date: "",
        classroom_id: "",
        roll_no: "",
        emergency_contact_name: "",
        emergency_contact_phone: "",
      }));

      await loadData();
      setNotice("Student enrolled successfully.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create student"));
    } finally {
      setCreatingStudent(false);
    }
  }

  async function handleImportFileSelected(file: File | null) {
    if (!file) {
      setImportFileName("");
      setImportFileBase64("");
      setImportHeaders([]);
      setImportPreview(null);
      return;
    }

    const allowed = [".csv", ".xlsx", ".xls"];
    const lower = file.name.toLowerCase();
    const isAllowed = allowed.some((ext) => lower.endsWith(ext));
    if (!isAllowed) {
      setError("Please select a CSV or Excel file (.csv, .xlsx, .xls).");
      return;
    }

    setError("");
    setNotice("");
    setImportFileName(file.name);
    const encoded = await fileToBase64(file);
    setImportFileBase64(encoded);
    setImportPreview(null);
    setImportHeaders([]);
  }

  async function runPreview(customMapping?: Record<string, string>) {
    if (!importFileBase64 || !importFileName) {
      setError("Select an import file first.");
      return;
    }

    setImportingPreview(true);
    setError("");
    setNotice("");

    try {
      const cleanedMapping = Object.fromEntries(
        Object.entries(customMapping || {}).filter(([, value]) => String(value || "").trim().length > 0)
      );

      const result = await previewStudentImport({
        source_file_name: importFileName,
        file_base64: importFileBase64,
        import_type: "students",
        mapping: Object.keys(cleanedMapping).length > 0 ? cleanedMapping : undefined,
        default_academic_year_id: studentForm.academic_year_id || undefined,
      });

      setImportPreview(result);
      setImportHeaders(result.detected_headers || []);
      setImportMapping(result.field_mapping || {});

      const jobs = await getImportJobs({ page_size: "20", import_type: "students" });
      setImportJobs(jobs.data);

      if (result.invalid_rows > 0) {
        setNotice(
          `Preview ready: ${result.valid_rows} valid row(s), ${result.invalid_rows} row(s) need correction.`
        );
      } else {
        setNotice(`Preview ready: ${result.valid_rows} valid row(s).`);
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to preview import file"));
    } finally {
      setImportingPreview(false);
    }
  }

  async function handlePreviewImport(e: FormEvent) {
    e.preventDefault();
    await runPreview(importMapping);
  }

  async function handleExecuteImport() {
    if (!importPreview?.id) {
      setError("Preview and validate the file first.");
      return;
    }

    setExecutingImport(true);
    setError("");
    setNotice("");

    try {
      const execution = await executeImportJob(importPreview.id, {
        create_parent_accounts: true,
      });

      const refreshed = await getImportJob(importPreview.id);
      setImportPreview(refreshed);

      const jobs = await getImportJobs({ page_size: "20", import_type: "students" });
      setImportJobs(jobs.data);

      await loadData();
      setNotice(
        `Import executed: ${execution.data?.imported_count || 0} row(s) imported, ${execution.data?.failed_count || 0} failed.`
      );
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to execute import job"));
    } finally {
      setExecutingImport(false);
    }
  }

  async function handleDownloadImportErrors(jobId: string) {
    setDownloadingErrorsFor(jobId);
    try {
      const blob = await exportImportErrorsCsv(jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `import-errors-${jobId.slice(0, 8)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to download import errors CSV"));
    } finally {
      setDownloadingErrorsFor(null);
    }
  }

  return (
    <>
      <Header title="People Management" />
      <div className="p-6 space-y-6">
        <section className="rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-600 text-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-pink-100 text-sm font-semibold uppercase tracking-wider">Master Data Layer</p>
              <h2 className="text-2xl lg:text-3xl font-bold">Staff, Student and Assignment Registry</h2>
              <p className="mt-2 text-pink-100 max-w-2xl">
                Centralized profiles with role-aware setup, enrollment controls, and section ownership.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/dashboard/people/parents" className="inline-flex items-center rounded-lg border border-white/40 bg-white/15 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
                  Open Parent Directory
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[280px]">
              <MetricCard label="Staff" value={staff.length} />
              <MetricCard label="Teachers" value={teacherCount} />
              <MetricCard label="Students" value={students.length} />
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading people records...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <form onSubmit={handleCreateStaff} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Create Staff Account</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="First Name"><input className="input-field" value={staffForm.first_name} onChange={(e) => setStaffForm((p) => ({ ...p, first_name: e.target.value }))} required /></Field>
                  <Field label="Last Name"><input className="input-field" value={staffForm.last_name} onChange={(e) => setStaffForm((p) => ({ ...p, last_name: e.target.value }))} /></Field>
                  <Field label="Email"><input className="input-field" type="email" value={staffForm.email} onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))} required /></Field>
                  <Field label="Phone"><input className="input-field" value={staffForm.phone} onChange={(e) => setStaffForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
                  <Field label="Temporary Password"><input className="input-field" value={staffForm.temporary_password} onChange={(e) => setStaffForm((p) => ({ ...p, temporary_password: e.target.value }))} required /></Field>
                  <Field label="Staff Code"><input className="input-field" value={staffForm.staff_code} onChange={(e) => setStaffForm((p) => ({ ...p, staff_code: e.target.value.toUpperCase() }))} required /></Field>
                  <Field label="Role">
                    <select className="input-field" value={staffForm.role_code} onChange={(e) => setStaffForm((p) => ({ ...p, role_code: e.target.value }))}>
                      {roleChoices.map((role) => (
                        <option key={role.code} value={role.code}>{role.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Staff Type">
                    <select className="input-field" value={staffForm.staff_type} onChange={(e) => setStaffForm((p) => ({ ...p, staff_type: e.target.value }))}>
                      <option value="teacher">Teacher</option>
                      <option value="headmistress">Headmistress</option>
                      <option value="principal">Principal</option>
                      <option value="vice_principal">Vice Principal</option>
                      <option value="accountant">Accountant</option>
                      <option value="front_desk">Front Desk</option>
                      <option value="hr_admin">HR Admin</option>
                      <option value="coordinator">Coordinator</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Designation"><input className="input-field" value={staffForm.designation} onChange={(e) => setStaffForm((p) => ({ ...p, designation: e.target.value }))} /></Field>
                  <Field label="Joining Date"><input className="input-field" type="date" value={staffForm.joining_date} onChange={(e) => setStaffForm((p) => ({ ...p, joining_date: e.target.value }))} /></Field>
                  <Field label="Primary Section">
                    <select className="input-field" value={staffForm.primary_section_id} onChange={(e) => setStaffForm((p) => ({ ...p, primary_section_id: e.target.value }))}>
                      <option value="">No section</option>
                      {sections.map((section) => (
                        <option key={section.id} value={section.id}>{section.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button className="btn-primary" type="submit" disabled={creatingStaff}>
                  {creatingStaff ? "Creating..." : "Create Staff"}
                </button>
              </form>

              <form onSubmit={handleCreateStudent} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Create Student Enrollment</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Student Code"><input className="input-field" value={studentForm.student_code} onChange={(e) => setStudentForm((p) => ({ ...p, student_code: e.target.value.toUpperCase() }))} required /></Field>
                  <Field label="First Name"><input className="input-field" value={studentForm.first_name} onChange={(e) => setStudentForm((p) => ({ ...p, first_name: e.target.value }))} required /></Field>
                  <Field label="Last Name"><input className="input-field" value={studentForm.last_name} onChange={(e) => setStudentForm((p) => ({ ...p, last_name: e.target.value }))} /></Field>
                  <Field label="Admission Date"><input className="input-field" type="date" value={studentForm.admission_date} onChange={(e) => setStudentForm((p) => ({ ...p, admission_date: e.target.value }))} /></Field>
                  <Field label="Academic Year">
                    <select className="input-field" value={studentForm.academic_year_id} onChange={(e) => setStudentForm((p) => ({ ...p, academic_year_id: e.target.value }))}>
                      <option value="">Select year</option>
                      {years.map((year) => (
                        <option key={year.id} value={year.id}>{year.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Classroom">
                    <select className="input-field" value={studentForm.classroom_id} onChange={(e) => setStudentForm((p) => ({ ...p, classroom_id: e.target.value }))}>
                      <option value="">Select classroom</option>
                      {classrooms.map((room) => (
                        <option key={room.id} value={room.id}>{room.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Roll No"><input className="input-field" type="number" min={1} value={studentForm.roll_no} onChange={(e) => setStudentForm((p) => ({ ...p, roll_no: e.target.value }))} /></Field>
                  <Field label="Emergency Contact Name"><input className="input-field" value={studentForm.emergency_contact_name} onChange={(e) => setStudentForm((p) => ({ ...p, emergency_contact_name: e.target.value }))} /></Field>
                  <Field label="Emergency Contact Phone"><input className="input-field" value={studentForm.emergency_contact_phone} onChange={(e) => setStudentForm((p) => ({ ...p, emergency_contact_phone: e.target.value }))} /></Field>
                </div>
                <button className="btn-primary" type="submit" disabled={creatingStudent}>
                  {creatingStudent ? "Creating..." : "Enroll Student"}
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
              <form onSubmit={handlePreviewImport} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Bulk Import Students</h3>
                    <p className="text-sm text-gray-500">Upload CSV/XLSX, validate rows, then import valid records.</p>
                  </div>
                </div>

                <label className="block">
                  <span className="label-text">Select File (.csv, .xlsx, .xls)</span>
                  <input
                    className="input-field"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => handleImportFileSelected(e.target.files?.[0] || null)}
                  />
                </label>

                {importFileName && (
                  <p className="text-xs text-gray-500">
                    Selected: <span className="font-medium text-gray-700">{importFileName}</span>
                  </p>
                )}

                {importHeaders.length > 0 && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-indigo-800">Column Mapping</p>
                    <p className="text-xs text-indigo-700">
                      Adjust mapping for required fields before re-validating.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {requiredImportFields.map((field) => (
                        <label key={field} className="block">
                          <span className="label-text capitalize">{normalizeErrorText(field)}</span>
                          <select
                            className="input-field"
                            value={importMapping[field] || ""}
                            onChange={(e) =>
                              setImportMapping((prev) => ({
                                ...prev,
                                [field]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Unmapped</option>
                            {importHeaders.map((header) => (
                              <option key={`${field}-${header}`} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button className="btn-primary" type="submit" disabled={importingPreview}>
                    {importingPreview ? "Validating..." : "Preview & Validate"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => runPreview(importMapping)}
                    disabled={importingPreview || !importFileBase64}
                  >
                    Revalidate Mapping
                  </button>
                </div>
              </form>

              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-3 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Import Preview</h3>

                {!importPreview ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                    Upload and validate a file to see preview rows and row-level issues.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <InlineMetric label="Total Rows" value={importPreview.total_rows} tone="slate" />
                      <InlineMetric label="Valid" value={importPreview.valid_rows} tone="green" />
                      <InlineMetric label="Invalid" value={importPreview.invalid_rows} tone="rose" />
                      <InlineMetric label="Status" value={importPreview.status} tone="indigo" />
                    </div>

                    {Array.isArray(importPreview.errors) && importPreview.errors.length > 0 && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <p className="text-sm font-semibold text-rose-800 mb-2">Validation Issues</p>
                        <div className="max-h-44 overflow-auto text-xs text-rose-900 space-y-1">
                          {importPreview.errors.slice(0, 20).map((issue, idx) => (
                            <p key={`${issue.row_number}-${issue.field_name}-${idx}`}>
                              Row {issue.row_number}: <span className="font-semibold">{normalizeErrorText(issue.field_name)}</span> - {issue.issue}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-sm font-semibold text-gray-800 mb-2">Preview Rows</p>
                      <div className="overflow-auto max-h-56">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 text-left text-gray-500">
                              <th className="py-2 pr-3">Student Code</th>
                              <th className="py-2 pr-3">Name</th>
                              <th className="py-2 pr-3">Class</th>
                              <th className="py-2 pr-3">Section</th>
                              <th className="py-2 pr-3">Father</th>
                              <th className="py-2">Mobile</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(importPreview.preview_rows || []).map((row, idx) => (
                              <tr key={`preview-${idx}`} className="border-b border-gray-100 last:border-0">
                                <td className="py-2 pr-3 font-medium text-gray-900">{String(row.student_code || "-")}</td>
                                <td className="py-2 pr-3">{`${String(row.first_name || "")} ${String(row.last_name || "")}`.trim() || "-"}</td>
                                <td className="py-2 pr-3">{String(row.class_label || "-")}</td>
                                <td className="py-2 pr-3">{String(row.section_label || "-")}</td>
                                <td className="py-2 pr-3">{String(row.father_name || "-")}</td>
                                <td className="py-2">{String(row.mobile_number || "-")}</td>
                              </tr>
                            ))}
                            {(importPreview.preview_rows || []).length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-4 text-center text-gray-500">
                                  No valid preview rows yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <button
                      className="btn-primary"
                      type="button"
                      onClick={handleExecuteImport}
                      disabled={
                        executingImport ||
                        importPreview.valid_rows === 0 ||
                        String(importPreview.status).startsWith("completed")
                      }
                    >
                      {executingImport ? "Importing..." : "Import Valid Rows"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Import Job History</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-3">File</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Rows</th>
                      <th className="py-2 pr-3">Created By</th>
                      <th className="py-2 pr-3">Created</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importJobs.map((job) => (
                      <tr key={job.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-900">{job.source_file_name || "Uploaded file"}</p>
                          <p className="text-xs text-gray-500 uppercase">{job.source_format}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              String(job.status).startsWith("completed")
                                ? "bg-emerald-100 text-emerald-700"
                                : job.status === "failed"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-indigo-100 text-indigo-700"
                            }`}
                          >
                            {normalizeErrorText(job.status)}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="text-emerald-700 font-semibold">{job.valid_rows}</span>
                          <span className="text-gray-400"> / </span>
                          <span className="text-rose-700 font-semibold">{job.invalid_rows}</span>
                        </td>
                        <td className="py-2 pr-3">
                          {[job.created_by_first_name, job.created_by_last_name].filter(Boolean).join(" ") || "-"}
                        </td>
                        <td className="py-2 pr-3">{new Date(job.created_at).toLocaleString()}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleDownloadImportErrors(job.id)}
                          >
                            {downloadingErrorsFor === job.id ? "Downloading..." : "Errors CSV"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {importJobs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-gray-500">
                          No import jobs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Staff Directory</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-3">Staff</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Roles</th>
                      <th className="py-2">Section</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((row) => (
                      <tr key={row.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-900">{row.first_name} {row.last_name || ""}</p>
                          <p className="text-xs text-gray-500">{row.email}</p>
                        </td>
                        <td className="py-2 pr-3">{row.staff_code}</td>
                        <td className="py-2 pr-3 capitalize">{row.staff_type.replaceAll("_", " ")}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {row.roles.map((role) => (
                              <span key={role} className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs font-medium">
                                {role.replaceAll("_", " ")}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2">{row.primary_section_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Student Master</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-3">Student</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Classroom</th>
                      <th className="py-2 pr-3">Admission</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Profile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((row) => (
                      <tr key={row.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-900">{row.first_name} {row.last_name || ""}</td>
                        <td className="py-2 pr-3">{row.student_code}</td>
                        <td className="py-2 pr-3">{row.grade_label ? `${row.grade_label} - ${row.section_label}` : "Unassigned"}</td>
                        <td className="py-2 pr-3">{row.admission_date || "-"}</td>
                        <td className="py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="py-2">
                          <Link href={`/dashboard/students/${row.id}/profile`} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2 border border-white/20">
      <p className="text-xs text-pink-100">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function InlineMetric({ label, value, tone }: { label: string; value: number | string; tone: "green" | "rose" | "indigo" | "slate" }) {
  const toneClasses: Record<string, string> = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClasses[tone]}`}>
      <p className="text-xs font-medium">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
