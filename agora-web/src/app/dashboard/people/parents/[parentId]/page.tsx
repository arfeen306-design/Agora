"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  ApiError,
  getDocuments,
  getFeeInvoices,
  getLookupStudents,
  getPeopleParent,
  getPeopleParents,
  issueDocumentDownloadUrl,
  type DocumentVaultItem,
  type LookupStudent,
  type ParentDirectoryRow,
  type ParentLinkedStudentRecord,
  type ParentProfileRecord,
  type ParentStudentLinkInput,
  updatePeopleParent,
} from "@/lib/api";

const MANAGE_PARENT_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];
const VIEW_PARENT_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk"];
const FINANCE_SUMMARY_ROLES = ["school_admin", "principal", "vice_principal", "accountant"];

interface DuplicateWarningState {
  email: ParentDirectoryRow[];
  phone: ParentDirectoryRow[];
  whatsapp: ParentDirectoryRow[];
}

interface FeeInvoiceRow {
  id: string;
  amount_due: number | string;
  amount_paid: number | string;
  status: string;
}

interface FeeSummaryState {
  available: boolean;
  note?: string;
  total_invoices: number;
  overdue_invoices: number;
  total_due: number;
  total_paid: number;
  total_outstanding: number;
}

function hasRole(roles: string[] = [], target: string[]) {
  return target.some((code) => roles.includes(code));
}

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  return parsed.toLocaleString();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function displayParentName(parent: ParentProfileRecord | null) {
  if (!parent) return "Parent Profile";
  return [parent.first_name, parent.last_name].filter(Boolean).join(" ").trim() || parent.guardian_name || "Parent";
}

function emptyLink(): ParentStudentLinkInput {
  return {
    student_id: "",
    relation_type: "guardian",
    is_primary: false,
  };
}

function parseParentId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default function ParentProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const params = useParams<{ parentId: string }>();
  const parentId = parseParentId(params?.parentId);

  const roles = user?.roles || [];
  const canView = hasRole(roles, VIEW_PARENT_ROLES);
  const canManage = hasRole(roles, MANAGE_PARENT_ROLES);
  const canViewFinance = hasRole(roles, FINANCE_SUMMARY_ROLES);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [parent, setParent] = useState<ParentProfileRecord | null>(null);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [links, setLinks] = useState<ParentStudentLinkInput[]>([]);
  const [parentDocuments, setParentDocuments] = useState<DocumentVaultItem[]>([]);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    is_active: true,
    occupation: "",
    guardian_name: "",
    father_name: "",
    mother_name: "",
    whatsapp_number: "",
    address_line: "",
    preferred_channel: "in_app" as "in_app" | "push" | "email" | "sms",
  });

  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateWarningState>({
    email: [],
    phone: [],
    whatsapp: [],
  });

  const [feeSummary, setFeeSummary] = useState<FeeSummaryState>({
    available: false,
    note: "Loading...",
    total_invoices: 0,
    overdue_invoices: 0,
    total_due: 0,
    total_paid: 0,
    total_outstanding: 0,
  });

  function syncForm(profile: ParentProfileRecord) {
    setForm({
      first_name: profile.first_name || "",
      last_name: profile.last_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      is_active: Boolean(profile.is_active),
      occupation: profile.occupation || "",
      guardian_name: profile.guardian_name || "",
      father_name: profile.father_name || "",
      mother_name: profile.mother_name || "",
      whatsapp_number: profile.whatsapp_number || "",
      address_line: profile.address_line || "",
      preferred_channel: profile.preferred_channel || "in_app",
    });

    if (profile.linked_students.length > 0) {
      setLinks(
        profile.linked_students.map((row) => ({
          student_id: row.student_id,
          relation_type: row.relation_type,
          is_primary: row.is_primary,
        }))
      );
    } else {
      setLinks([emptyLink()]);
    }
  }

  async function loadFeeSummary(profile: ParentProfileRecord) {
    if (!canViewFinance) {
      setFeeSummary({
        available: false,
        note: "Finance summary is visible to school admin, principal, vice principal, and accountant.",
        total_invoices: 0,
        overdue_invoices: 0,
        total_due: 0,
        total_paid: 0,
        total_outstanding: 0,
      });
      return;
    }

    const studentIds = profile.linked_students.map((row) => row.student_id);
    if (studentIds.length === 0) {
      setFeeSummary({
        available: true,
        note: "No linked children yet.",
        total_invoices: 0,
        overdue_invoices: 0,
        total_due: 0,
        total_paid: 0,
        total_outstanding: 0,
      });
      return;
    }

    try {
      const responses = await Promise.all(
        studentIds.map((studentId) => getFeeInvoices({ student_id: studentId, page_size: "100" }))
      );
      const invoices = responses.flatMap((response) => {
        const data = response.data;
        return Array.isArray(data) ? (data as FeeInvoiceRow[]) : [];
      });

      const aggregate = invoices.reduce(
        (acc, row) => {
          const amountDue = Number(row.amount_due || 0);
          const amountPaid = Number(row.amount_paid || 0);
          const outstanding = Math.max(0, amountDue - amountPaid);

          acc.total_invoices += 1;
          acc.total_due += amountDue;
          acc.total_paid += amountPaid;
          acc.total_outstanding += outstanding;
          if (row.status === "overdue") acc.overdue_invoices += 1;
          return acc;
        },
        {
          total_invoices: 0,
          overdue_invoices: 0,
          total_due: 0,
          total_paid: 0,
          total_outstanding: 0,
        }
      );

      setFeeSummary({
        available: true,
        ...aggregate,
        note: aggregate.total_invoices === 0 ? "No invoices found for linked children." : undefined,
      });
    } catch (err: unknown) {
      const note =
        err instanceof ApiError && err.status === 403
          ? "Your role cannot access finance invoice details for this parent."
          : extractErrorMessage(err, "Failed to load finance summary");
      setFeeSummary({
        available: false,
        note,
        total_invoices: 0,
        overdue_invoices: 0,
        total_due: 0,
        total_paid: 0,
        total_outstanding: 0,
      });
    }
  }

  async function loadProfile() {
    if (!canView || !parentId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [profile, studentLookup] = await Promise.all([
        getPeopleParent(parentId),
        canManage ? getLookupStudents({ page_size: 500 }) : Promise.resolve([]),
      ]);
      setParent(profile);
      syncForm(profile);
      setStudents(studentLookup);
      await loadFeeSummary(profile);

      try {
        const docsRes = await getDocuments({
          scope_type: "parent",
          scope_id: parentId,
          page: 1,
          page_size: 20,
        });
        setParentDocuments(Array.isArray(docsRes.data) ? docsRes.data : []);
      } catch {
        setParentDocuments([]);
      }
    } catch (err: unknown) {
      setParent(null);
      setError(extractErrorMessage(err, "Failed to load parent profile"));
      setParentDocuments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canManage, parentId]);

  useEffect(() => {
    if (!canManage || !parentId) return;
    const checks = [
      { key: "email" as const, value: form.email.trim() },
      { key: "phone" as const, value: form.phone.trim() },
      { key: "whatsapp" as const, value: form.whatsapp_number.trim() },
    ].filter((item) => item.value.length >= 4);

    if (checks.length === 0) {
      setDuplicateWarnings({ email: [], phone: [], whatsapp: [] });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const updates: DuplicateWarningState = { email: [], phone: [], whatsapp: [] };
        await Promise.all(
          checks.map(async (item) => {
            const response = await getPeopleParents({ search: item.value, page_size: "8" });
            updates[item.key] = response.data.filter((row) => row.id !== parentId);
          })
        );
        if (!cancelled) setDuplicateWarnings(updates);
      } catch {
        if (!cancelled) setDuplicateWarnings({ email: [], phone: [], whatsapp: [] });
      }
    }, 420);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canManage, form.email, form.phone, form.whatsapp_number, parentId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canManage || !parentId) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const cleanedLinks = links.filter((row) => row.student_id);
      await updatePeopleParent(parentId, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim() || null,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || null,
        is_active: form.is_active,
        occupation: form.occupation.trim() || null,
        guardian_name: form.guardian_name.trim() || null,
        father_name: form.father_name.trim() || null,
        mother_name: form.mother_name.trim() || null,
        whatsapp_number: form.whatsapp_number.trim() || null,
        address_line: form.address_line.trim() || null,
        preferred_channel: form.preferred_channel,
        linked_students: cleanedLinks,
      });
      setNotice("Parent profile updated successfully.");
      await loadProfile();
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update parent profile"));
    } finally {
      setSaving(false);
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
      setError(extractErrorMessage(err, "Failed to generate document download URL"));
    }
  }

  const parentName = useMemo(() => displayParentName(parent), [parent]);
  const canViewSensitiveContact = hasRole(roles, ["school_admin", "principal", "headmistress", "teacher"]);
  const canShowEdit = canManage && Boolean(parent);

  if (authLoading || loading) {
    return (
      <>
        <Header title="Parent Profile" />
        <div className="p-6">
          <section className="card flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <p className="text-sm text-gray-600">Loading parent profile...</p>
          </section>
        </div>
      </>
    );
  }

  if (!canView) {
    return (
      <>
        <Header title="Parent Profile" />
        <div className="p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
            <p className="mt-2 text-sm text-gray-600">
              You do not have permission to access parent profiles.
            </p>
          </section>
        </div>
      </>
    );
  }

  if (!parent) {
    return (
      <>
        <Header title="Parent Profile" />
        <div className="space-y-4 p-6">
          <section className="card">
            <h2 className="text-xl font-semibold text-gray-900">Parent Not Found</h2>
            <p className="mt-2 text-sm text-gray-600">
              This profile may have been removed or you may not have visibility into this parent record.
            </p>
          </section>
          <Link href="/dashboard/people/parents" className="btn-secondary">
            Back to Parent Directory
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Parent Profile" />
      <div className="space-y-6 p-6">
        <section className="rounded-2xl border border-cyan-200 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">Parent Management</p>
              <h2 className="mt-2 text-3xl font-extrabold">{parentName}</h2>
              <p className="mt-2 text-sm text-cyan-100">
                Parent profile, child linkage, communication preference, and portal access controls.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${parent.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                {parent.is_active ? "Portal Active" : "Portal Inactive"}
              </span>
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                Linked Children: {parent.linked_students.length}
              </span>
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
                Last Login: {formatDateTime(parent.last_login_at)}
              </span>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
        )}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <MetricCard label="Linked Children" value={String(parent.linked_students.length)} helper="Children mapped to this parent account" />
          <MetricCard label="Preferred Channel" value={parent.preferred_channel.replaceAll("_", " ")} helper="Primary communication preference" />
          <MetricCard label="Outstanding Fees" value={formatCurrency(feeSummary.total_outstanding)} helper={feeSummary.available ? "Across linked children invoices" : feeSummary.note || "Not available"} />
          <MetricCard label="Overdue Invoices" value={String(feeSummary.overdue_invoices)} helper={feeSummary.available ? `${feeSummary.total_invoices} total invoices` : "No finance visibility"} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="space-y-6 xl:col-span-3">
            <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Overview</h3>
                <Link href="/dashboard/people/parents" className="btn-secondary">Back to Directory</Link>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <DetailRow label="First Name" value={parent.first_name} />
                <DetailRow label="Last Name" value={parent.last_name || "Not set"} />
                <DetailRow label="Guardian Name" value={parent.guardian_name || "Not set"} />
                <DetailRow label="Father Name" value={parent.father_name || "Not set"} />
                <DetailRow label="Mother Name" value={parent.mother_name || "Not set"} />
                <DetailRow label="Occupation" value={parent.occupation || "Not set"} />
                <DetailRow label="Email" value={parent.email || "Hidden / unavailable"} />
                <DetailRow label="Mobile" value={parent.phone || "Hidden / unavailable"} />
                <DetailRow label="WhatsApp" value={parent.whatsapp_number || "Hidden / unavailable"} />
                <DetailRow label="Last Login" value={formatDateTime(parent.last_login_at)} />
                <DetailRow label="Portal Status" value={parent.is_active ? "Active" : "Inactive"} />
                <DetailRow label="Preferred Channel" value={parent.preferred_channel.replaceAll("_", " ")} />
              </div>
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                <p className="font-semibold text-gray-700">Address</p>
                <p className="mt-1">{parent.address_line || "No address provided."}</p>
              </div>
              {!canViewSensitiveContact && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Contact fields are masked for your role based on governance policy.
                </p>
              )}
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Linked Children</h3>
              <p className="mt-1 text-sm text-gray-500">
                One parent can be linked with multiple children using guardian relationships.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-3">Student</th>
                      <th className="py-2 pr-3">Relation</th>
                      <th className="py-2 pr-3">Classroom</th>
                      <th className="py-2 pr-3">Primary</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parent.linked_students.length === 0 ? (
                      <tr>
                        <td className="py-4 text-gray-400" colSpan={5}>No children linked yet.</td>
                      </tr>
                    ) : (
                      parent.linked_students.map((row) => (
                        <LinkedStudentRow key={row.student_id} row={row} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div className="space-y-6 xl:col-span-2">
            <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Communication Summary</h3>
              <p className="mt-1 text-sm text-gray-500">
                Preferred channel and account activity snapshot.
              </p>
              <div className="mt-4 space-y-2 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <SummaryItem label="Preferred Channel" value={parent.preferred_channel.replaceAll("_", " ")} />
                <SummaryItem label="Portal Access" value={parent.is_active ? "Enabled" : "Disabled"} />
                <SummaryItem label="Last Login" value={formatDateTime(parent.last_login_at)} />
                <SummaryItem label="Email On File" value={parent.email ? "Yes" : "No"} />
                <SummaryItem label="Mobile On File" value={parent.phone ? "Yes" : "No"} />
              </div>
            </article>

            <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Fee Overview</h3>
              <p className="mt-1 text-sm text-gray-500">Financial status for linked children.</p>
              <div className="mt-4 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <SummaryItem label="Total Due" value={formatCurrency(feeSummary.total_due)} />
                <SummaryItem label="Total Paid" value={formatCurrency(feeSummary.total_paid)} />
                <SummaryItem label="Outstanding" value={formatCurrency(feeSummary.total_outstanding)} />
                <SummaryItem label="Overdue Invoices" value={String(feeSummary.overdue_invoices)} />
              </div>
              {!feeSummary.available && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {feeSummary.note || "Fee summary is currently unavailable for this role."}
                </p>
              )}
            </article>

            <article className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-gray-900">Parent Documents</h3>
                <Link href={`/dashboard/documents?scope_type=parent&scope_id=${parentId}`} className="btn-secondary">
                  Open Vault
                </Link>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Consent files, identity records, receipts, and parent-related documents linked to this profile.
              </p>
              <div className="mt-4 space-y-2">
                {parentDocuments.length === 0 ? (
                  <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                    No parent-linked documents available yet.
                  </p>
                ) : (
                  parentDocuments.slice(0, 10).map((doc) => (
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
        </section>

        {canShowEdit && (
          <form onSubmit={handleSave} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Edit Parent Profile</h3>
            <p className="text-sm text-gray-500">
              Update parent details and maintain guardian linkage for one or multiple children.
            </p>

            {(duplicateWarnings.email.length > 0 ||
              duplicateWarnings.phone.length > 0 ||
              duplicateWarnings.whatsapp.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold">Possible duplicate contact found</p>
                {duplicateWarnings.email.length > 0 && (
                  <p className="mt-1">
                    Email matches: {duplicateWarnings.email.map((row) => profileLabel(row)).join(", ")}
                  </p>
                )}
                {duplicateWarnings.phone.length > 0 && (
                  <p className="mt-1">
                    Mobile matches: {duplicateWarnings.phone.map((row) => profileLabel(row)).join(", ")}
                  </p>
                )}
                {duplicateWarnings.whatsapp.length > 0 && (
                  <p className="mt-1">
                    WhatsApp matches: {duplicateWarnings.whatsapp.map((row) => profileLabel(row)).join(", ")}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="First Name *">
                <input className="input-field" value={form.first_name} onChange={(e) => setForm((prev) => ({ ...prev, first_name: e.target.value }))} required />
              </Field>
              <Field label="Last Name">
                <input className="input-field" value={form.last_name} onChange={(e) => setForm((prev) => ({ ...prev, last_name: e.target.value }))} />
              </Field>
              <Field label="Portal Access">
                <select className="input-field" value={form.is_active ? "active" : "inactive"} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.value === "active" }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Email">
                <input className="input-field" type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
              </Field>
              <Field label="Mobile Number">
                <input className="input-field" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
              </Field>
              <Field label="WhatsApp Number">
                <input className="input-field" value={form.whatsapp_number} onChange={(e) => setForm((prev) => ({ ...prev, whatsapp_number: e.target.value }))} />
              </Field>
              <Field label="Guardian Name">
                <input className="input-field" value={form.guardian_name} onChange={(e) => setForm((prev) => ({ ...prev, guardian_name: e.target.value }))} />
              </Field>
              <Field label="Father Name">
                <input className="input-field" value={form.father_name} onChange={(e) => setForm((prev) => ({ ...prev, father_name: e.target.value }))} />
              </Field>
              <Field label="Mother Name">
                <input className="input-field" value={form.mother_name} onChange={(e) => setForm((prev) => ({ ...prev, mother_name: e.target.value }))} />
              </Field>
              <Field label="Occupation">
                <input className="input-field" value={form.occupation} onChange={(e) => setForm((prev) => ({ ...prev, occupation: e.target.value }))} />
              </Field>
              <Field label="Preferred Communication">
                <select className="input-field" value={form.preferred_channel} onChange={(e) => setForm((prev) => ({ ...prev, preferred_channel: e.target.value as "in_app" | "push" | "email" | "sms" }))}>
                  <option value="in_app">In App</option>
                  <option value="push">Push</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </Field>
              <label className="block md:col-span-3">
                <span className="label-text">Address</span>
                <textarea className="input-field min-h-[86px]" value={form.address_line} onChange={(e) => setForm((prev) => ({ ...prev, address_line: e.target.value }))} />
              </label>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-sky-900">Linked Children</h4>
                <button type="button" className="btn-secondary" onClick={() => setLinks((prev) => [...prev, emptyLink()])}>
                  Add Child Link
                </button>
              </div>
              <div className="space-y-3">
                {links.map((link, idx) => (
                  <div key={`link-${idx}`} className="grid grid-cols-1 gap-3 rounded-lg border border-sky-200 bg-white p-3 md:grid-cols-12">
                    <label className="block md:col-span-6">
                      <span className="label-text">Student</span>
                      <select
                        className="input-field"
                        value={link.student_id}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, student_id: e.target.value } : row))
                          )
                        }
                      >
                        <option value="">Select student</option>
                        {students.map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.label} ({student.student_code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block md:col-span-3">
                      <span className="label-text">Relation</span>
                      <select
                        className="input-field"
                        value={link.relation_type}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, relation_type: e.target.value } : row))
                          )
                        }
                      >
                        <option value="guardian">Guardian</option>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 md:col-span-2 md:mt-7">
                      <input
                        type="checkbox"
                        checked={link.is_primary}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((row, rowIdx) => {
                              if (rowIdx === idx) return { ...row, is_primary: e.target.checked };
                              if (e.target.checked) return { ...row, is_primary: false };
                              return row;
                            })
                          )
                        }
                      />
                      <span className="text-xs font-medium text-gray-700">Primary</span>
                    </label>
                    <div className="md:col-span-1 md:mt-7">
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={links.length === 1}
                        onClick={() => setLinks((prev) => prev.filter((_, rowIdx) => rowIdx !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Parent Profile"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

function profileLabel(row: ParentDirectoryRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.guardian_name || "Parent";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{helper}</p>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-800">{value}</span>
    </div>
  );
}

function LinkedStudentRow({ row }: { row: ParentLinkedStudentRecord }) {
  return (
    <tr className="border-b border-gray-100 last:border-b-0">
      <td className="py-2 pr-3">
        <p className="font-medium text-gray-900">{row.student_name}</p>
        <p className="text-xs text-gray-500">{row.student_code}</p>
      </td>
      <td className="py-2 pr-3 capitalize text-gray-700">{row.relation_type.replaceAll("_", " ")}</td>
      <td className="py-2 pr-3 text-gray-700">{row.classroom?.display_name || "Not assigned"}</td>
      <td className="py-2 pr-3">{row.is_primary ? <span className="badge-blue">Primary</span> : <span className="badge-gray">Secondary</span>}</td>
      <td className="py-2">
        <span className={row.status === "active" ? "badge-green" : "badge-yellow"}>{row.status}</span>
      </td>
    </tr>
  );
}
