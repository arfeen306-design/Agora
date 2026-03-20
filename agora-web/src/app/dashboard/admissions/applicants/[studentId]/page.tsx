"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import Header from "@/components/Header";
import AdmissionStatusPill from "@/components/dashboard/admissions/AdmissionStatusPill";
import { ADMISSION_STAGE_LABEL, ADMISSION_STAGE_ORDER, admissionStatusLabel } from "@/components/dashboard/admissions/admission-utils";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  admitAdmissionApplicant,
  getAdmissionDocuments,
  getAdmissionApplication,
  getLookupAcademicYears,
  getLookupClassrooms,
  issueDocumentDownloadUrl,
  type DocumentVaultItem,
  updateAdmissionStage,
  type AdmissionApplicationDetail,
  type AdmissionStatus,
} from "@/lib/api";

const ADMISSIONS_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "headmistress"];
const ADMISSIONS_ADMIT_ROLES = ["school_admin", "front_desk"];
const ADMISSIONS_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];
const TRANSITION_ROLE_MAP: Partial<Record<AdmissionStatus, Partial<Record<AdmissionStatus, string[]>>>> = {
  inquiry: {
    applied: ["school_admin", "front_desk"],
  },
  applied: {
    under_review: ["school_admin", "front_desk"],
  },
  under_review: {
    test_scheduled: ["school_admin", "principal", "vice_principal"],
    accepted: ["school_admin", "principal", "vice_principal"],
    rejected: ["school_admin", "principal", "vice_principal"],
    waitlisted: ["school_admin", "principal", "vice_principal"],
  },
  test_scheduled: {
    accepted: ["school_admin", "principal", "vice_principal"],
    rejected: ["school_admin", "principal", "vice_principal"],
  },
  waitlisted: {
    accepted: ["school_admin", "principal", "vice_principal"],
    rejected: ["school_admin", "principal", "vice_principal"],
  },
};

function hasRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function nextStageChoices(current: AdmissionStatus): AdmissionStatus[] {
  const graph: Partial<Record<AdmissionStatus, AdmissionStatus[]>> = {
    inquiry: ["applied"],
    applied: ["under_review"],
    under_review: ["test_scheduled", "accepted", "rejected", "waitlisted"],
    test_scheduled: ["accepted", "rejected"],
    waitlisted: ["accepted", "rejected"],
  };
  return graph[current] || [];
}

function nextStageChoicesForRoles(current: AdmissionStatus, roles: string[] = []): AdmissionStatus[] {
  const options = nextStageChoices(current);
  return options.filter((status) => {
    const allowedRoles = TRANSITION_ROLE_MAP[current]?.[status] || [];
    return allowedRoles.some((role) => roles.includes(role));
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export default function ApplicantDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ studentId: string }>();
  const studentId = params?.studentId;
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const canView = hasRole(roles, ADMISSIONS_VIEW_ROLES);
  const canManage = hasRole(roles, ADMISSIONS_MANAGE_ROLES);
  const canAdmit = hasRole(roles, ADMISSIONS_ADMIT_ROLES);

  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(false);
  const [savingAdmit, setSavingAdmit] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<AdmissionApplicationDetail | null>(null);
  const [admissionDocuments, setAdmissionDocuments] = useState<DocumentVaultItem[]>([]);
  const [classrooms, setClassrooms] = useState<Array<{ id: string; label: string }>>([]);
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string; is_current: boolean }>>([]);
  const [stageForm, setStageForm] = useState<{ new_status: AdmissionStatus; notes: string }>({
    new_status: "applied",
    notes: "",
  });
  const [admitForm, setAdmitForm] = useState({
    classroom_id: "",
    academic_year_id: "",
    roll_no: "",
    notes: "",
  });

  useEffect(() => {
    if (!canView || !studentId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [detailData, classroomRows, yearRows] = await Promise.all([
          getAdmissionApplication(studentId),
          getLookupClassrooms({ page_size: 200 }),
          getLookupAcademicYears({ page_size: 100 }),
        ]);
        if (cancelled) return;
        setDetail(detailData);
        setClassrooms(classroomRows.map((row) => ({ id: row.id, label: row.label })));
        setAcademicYears(yearRows.map((row) => ({ id: row.id, label: row.label, is_current: row.is_current })));
        const currentStatus = detailData.application.current_status;
        const options = nextStageChoices(currentStatus);
        if (options.length > 0) {
          setStageForm((prev) => ({ ...prev, new_status: options[0] }));
        }
        setAdmitForm((prev) => ({
          ...prev,
          classroom_id: detailData.application.desired_classroom_id || prev.classroom_id || "",
          academic_year_id: detailData.application.desired_academic_year_id || prev.academic_year_id || "",
        }));

        const applicationId = detailData.application.application_id;
        if (applicationId) {
          try {
            const docsRes = await getAdmissionDocuments(applicationId, { page: 1, page_size: 20 });
            setAdmissionDocuments(Array.isArray(docsRes.data) ? docsRes.data : []);
          } catch {
            setAdmissionDocuments([]);
          }
        } else {
          setAdmissionDocuments([]);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(errorMessage(err, "Failed to load applicant details"));
        setDetail(null);
        setAdmissionDocuments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [canView, studentId]);

  const currentStatus = detail?.application.current_status || "inquiry";
  const admissionApplicationId = detail?.application.application_id || "";
  const stageOptions = useMemo(() => nextStageChoicesForRoles(currentStatus, roles), [currentStatus, roles]);
  const stageBlockedByRole = useMemo(
    () => nextStageChoices(currentStatus).length > 0 && stageOptions.length === 0,
    [currentStatus, stageOptions]
  );
  const stageProgress = useMemo(() => {
    const idx = ADMISSION_STAGE_ORDER.indexOf(currentStatus);
    if (idx < 0) return 5;
    return Math.round(((idx + 1) / ADMISSION_STAGE_ORDER.length) * 100);
  }, [currentStatus]);

  async function handleStageSubmit(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !canManage || !detail) return;
    setSavingStage(true);
    setError("");
    setNotice("");
    try {
      await updateAdmissionStage(studentId, {
        new_status: stageForm.new_status,
        ...(stageForm.notes.trim() ? { notes: stageForm.notes.trim() } : {}),
        ...(detail.application.desired_classroom_id ? { desired_classroom_id: detail.application.desired_classroom_id } : {}),
        ...(detail.application.desired_academic_year_id ? { desired_academic_year_id: detail.application.desired_academic_year_id } : {}),
      });
      const refreshed = await getAdmissionApplication(studentId);
      setDetail(refreshed);
      setStageForm((prev) => ({ ...prev, notes: "" }));
      setNotice(`Applicant moved to ${admissionStatusLabel(stageForm.new_status)}.`);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to update admission stage"));
    } finally {
      setSavingStage(false);
    }
  }

  async function handleAdmitSubmit(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !canAdmit) return;
    setSavingAdmit(true);
    setError("");
    setNotice("");
    try {
      await admitAdmissionApplicant(studentId, {
        classroom_id: admitForm.classroom_id,
        ...(admitForm.academic_year_id ? { academic_year_id: admitForm.academic_year_id } : {}),
        ...(admitForm.roll_no ? { roll_no: Number(admitForm.roll_no) } : {}),
        ...(admitForm.notes.trim() ? { notes: admitForm.notes.trim() } : {}),
      });
      const refreshed = await getAdmissionApplication(studentId);
      setDetail(refreshed);
      setNotice("Applicant admitted and enrolled successfully.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to admit applicant"));
    } finally {
      setSavingAdmit(false);
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
      setError(errorMessage(err, "Failed to generate document download URL"));
    }
  }

  if (!canView) {
    return (
      <>
        <Header title="Applicant Detail" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">You do not have permission to view applicant details.</p>
          </section>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Header title="Applicant Detail" />
        <div className="p-6">
          <div className="h-56 animate-pulse rounded-2xl bg-indigo-100" />
        </div>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <Header title="Applicant Detail" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Applicant Not Found</h2>
            <p className="mt-2 text-sm text-gray-600">{error || "No admissions record available for this student."}</p>
            <div className="mt-4">
              <Link href="/dashboard/admissions/pipeline" className="btn-secondary">Back to Pipeline</Link>
            </div>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Applicant Detail" />
      <div className="space-y-6 p-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 p-6 text-white shadow-lg">
          <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-white/20 blur-2xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-100">Applicant Profile</p>
              <h2 className="mt-2 text-3xl font-extrabold">
                {[detail.student.first_name, detail.student.last_name].filter(Boolean).join(" ")}
              </h2>
              <p className="mt-2 text-sm text-indigo-100">Student Code: {detail.student.student_code}</p>
              <div className="mt-2"><AdmissionStatusPill status={detail.student.admission_status} /></div>
            </div>
            <div className="rounded-xl border border-white/25 bg-white/[0.15] p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-indigo-100">Pipeline Progress</p>
              <p className="mt-1 text-2xl font-bold">{stageProgress}%</p>
              <div className="mt-2 h-2.5 w-56 rounded-full bg-white/20">
                <div className="h-2.5 rounded-full bg-emerald-300" style={{ width: `${stageProgress}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Guardian and Application</h3>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <DetailRow label="Guardian Name" value={detail.application.guardian_name || "-"} />
                <DetailRow label="Guardian Phone" value={detail.application.guardian_phone || "-"} />
                <DetailRow label="Guardian Email" value={detail.application.guardian_email || "-"} />
                <DetailRow label="Inquiry Source" value={detail.application.inquiry_source || "-"} />
                <DetailRow label="Desired Grade" value={detail.application.desired_grade_label || "-"} />
                <DetailRow label="Desired Section" value={detail.application.desired_section_label || "-"} />
                <DetailRow label="Application Notes" value={detail.application.notes || "-"} />
                <DetailRow label="Stage Notes" value={detail.application.stage_notes || "-"} />
              </div>
            </article>

            <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Transition History</h3>
              <div className="mt-4 space-y-3">
                {detail.history.length === 0 ? (
                  <p className="text-sm text-gray-500">No stage events recorded yet.</p>
                ) : (
                  detail.history.map((event) => (
                    <div key={event.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-sm font-semibold text-gray-900">
                        {event.from_status ? `${admissionStatusLabel(event.from_status)} → ` : ""}
                        {admissionStatusLabel(event.to_status)}
                      </p>
                      <p className="text-xs text-gray-500">{formatDateTime(event.created_at)}</p>
                      {event.notes && <p className="mt-1 text-sm text-gray-700">{event.notes}</p>}
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-xl border border-sky-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-gray-900">Admission Documents</h3>
                {admissionApplicationId ? (
                  <Link
                    href={`/dashboard/documents?scope_type=admission&scope_id=${admissionApplicationId}`}
                    className="btn-secondary"
                  >
                    Open Vault
                  </Link>
                ) : (
                  <span className="text-xs font-medium text-gray-500">Admission record ID unavailable.</span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Identity files, admission forms, certificates, and supporting records for this applicant.
              </p>
              <div className="mt-4 space-y-2">
                {admissionDocuments.length === 0 ? (
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    No admission documents linked yet.
                  </p>
                ) : (
                  admissionDocuments.slice(0, 12).map((doc) => (
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
            </article>
          </div>

          <div className="space-y-5">
            <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Change Stage</h3>
              {stageOptions.length === 0 ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p className="text-gray-500">
                    No stage transition available for <strong>{ADMISSION_STAGE_LABEL[currentStatus]}</strong>.
                  </p>
                  {stageBlockedByRole && (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      This stage now needs approval from school leadership. Front desk can create inquiries, move them into review, and complete admission after acceptance.
                    </p>
                  )}
                </div>
              ) : (
                <form className="mt-3 space-y-3" onSubmit={handleStageSubmit}>
                  <label className="block">
                    <span className="label-text">Next Stage</span>
                    <select
                      className="input-field"
                      value={stageForm.new_status}
                      onChange={(e) => setStageForm((prev) => ({ ...prev, new_status: e.target.value as AdmissionStatus }))}
                      disabled={!canManage || savingStage}
                    >
                      {stageOptions.map((status) => (
                        <option key={status} value={status}>{ADMISSION_STAGE_LABEL[status]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label-text">Notes</span>
                    <textarea
                      className="input-field min-h-[82px]"
                      value={stageForm.notes}
                      onChange={(e) => setStageForm((prev) => ({ ...prev, notes: e.target.value }))}
                      disabled={!canManage || savingStage}
                    />
                  </label>
                  <button className="btn-primary w-full" type="submit" disabled={!canManage || savingStage}>
                    {savingStage ? "Updating..." : "Update Stage"}
                  </button>
                </form>
              )}
            </article>

            <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-emerald-900">Admit Applicant</h3>
              <p className="mt-1 text-sm text-emerald-800">
                Allowed only after applicant reaches accepted stage.
              </p>
              <form className="mt-3 space-y-3" onSubmit={handleAdmitSubmit}>
                <label className="block">
                  <span className="label-text">Classroom</span>
                  <select
                    className="input-field"
                    value={admitForm.classroom_id}
                    onChange={(e) => setAdmitForm((prev) => ({ ...prev, classroom_id: e.target.value }))}
                    required
                    disabled={!canAdmit || savingAdmit}
                  >
                    <option value="">Select Classroom</option>
                    {classrooms.map((row) => (
                      <option key={row.id} value={row.id}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label-text">Academic Year</span>
                  <select
                    className="input-field"
                    value={admitForm.academic_year_id}
                    onChange={(e) => setAdmitForm((prev) => ({ ...prev, academic_year_id: e.target.value }))}
                    disabled={!canAdmit || savingAdmit}
                  >
                    <option value="">Select Academic Year</option>
                    {academicYears.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label-text">Roll No (optional)</span>
                  <input
                    className="input-field"
                    type="number"
                    min={1}
                    max={9999}
                    value={admitForm.roll_no}
                    onChange={(e) => setAdmitForm((prev) => ({ ...prev, roll_no: e.target.value }))}
                    disabled={!canAdmit || savingAdmit}
                  />
                </label>
                <label className="block">
                  <span className="label-text">Admission Note</span>
                  <textarea
                    className="input-field min-h-[82px]"
                    value={admitForm.notes}
                    onChange={(e) => setAdmitForm((prev) => ({ ...prev, notes: e.target.value }))}
                    disabled={!canAdmit || savingAdmit}
                  />
                </label>
                <button
                  type="submit"
                  className="btn-primary w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={!canAdmit || savingAdmit || currentStatus !== "accepted"}
                >
                  {savingAdmit ? "Admitting..." : "Admit and Enroll"}
                </button>
                {currentStatus !== "accepted" && (
                  <p className="text-xs text-emerald-800">
                    Applicant must be in <strong>Accepted</strong> stage before admission.
                  </p>
                )}
              </form>
            </article>

            {detail.enrollment && (
              <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Enrollment</h3>
                <div className="mt-3 space-y-2 text-sm text-gray-700">
                  <p><span className="font-semibold">Status:</span> {detail.enrollment.status}</p>
                  <p><span className="font-semibold">Classroom:</span> {[detail.enrollment.grade_label, detail.enrollment.section_label].filter(Boolean).join(" - ") || detail.enrollment.classroom_id}</p>
                  <p><span className="font-semibold">Academic Year:</span> {detail.enrollment.academic_year_name || detail.enrollment.academic_year_id}</p>
                  <p><span className="font-semibold">Roll No:</span> {detail.enrollment.roll_no ?? "-"}</p>
                </div>
              </article>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}
