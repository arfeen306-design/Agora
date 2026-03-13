"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import SavedViewsPanel from "@/components/filters/SavedViewsPanel";
import { useAuth } from "@/lib/auth";
import {
  getFeePlans,
  createFeePlan,
  getFeeInvoices,
  createFeeInvoice,
  recordPayment,
  getLookupAcademicYears,
  getLookupStudents,
  type LookupStudent,
} from "@/lib/api";
import {
  buildShareUrl,
  loadSavedFilterViews,
  persistSavedFilterViews,
  type SavedFilterView,
  upsertSavedView,
} from "@/lib/saved-views";

interface FeePlan {
  id: string;
  title: string;
  amount: number;
  due_day: number | null;
  is_active: boolean;
}

interface FeeInvoice {
  id: string;
  student_id: string;
  period_start: string;
  period_end: string;
  amount_due: number;
  amount_paid: number;
  due_date: string;
  status: string;
}

const FEE_FILTERS_KEY = "agora_web_fees_filters_v1";
const FEE_SAVED_VIEW_KEY = "agora_web_fees_saved_view_v1";
const FEE_SAVED_VIEWS_KEY = "agora_web_fees_saved_views_v1";
const defaultInvoiceFilters = {
  date_from: "",
  date_to: "",
  academic_year_id: "",
  status: "",
};

export default function FeesPage() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"plans" | "invoices">("invoices");
  const [plans, setPlans] = useState<FeePlan[]>([]);
  const [planOptions, setPlanOptions] = useState<FeePlan[]>([]);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [academicYears, setAcademicYears] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [invoiceFilters, setInvoiceFilters] = useState(defaultInvoiceFilters);

  // Forms
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState({ title: "", amount: "", due_day: "" });
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ student_id: "", fee_plan_id: "", period_start: "", period_end: "", amount_due: "", due_date: "" });
  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", payment_date: new Date().toISOString().split("T")[0], method: "cash", reference_no: "" });

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const [viewMessage, setViewMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);

  const loadInvoiceLookups = useCallback(async () => {
    try {
      const [studentsData, plansRes, yearsData] = await Promise.all([
        getLookupStudents({ page_size: 200 }),
        getFeePlans({ page: "1", page_size: "200", is_active: "true" }),
        getLookupAcademicYears({ page_size: 100 }),
      ]);
      setStudents(studentsData);
      setPlanOptions(plansRes.data as FeePlan[]);
      setAcademicYears(yearsData.map((row) => ({ id: row.id, label: row.label || row.name })));
    } catch {
      setStudents([]);
      setPlanOptions([]);
      setAcademicYears([]);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "plans") {
        const res = await getFeePlans({
          page: String(page),
          page_size: "20",
          ...(invoiceFilters.academic_year_id ? { academic_year_id: invoiceFilters.academic_year_id } : {}),
        });
        setPlans(res.data as FeePlan[]);
        setTotalPages(res.meta?.pagination?.total_pages ?? 1);
      } else {
        const res = await getFeeInvoices({
          page: String(page),
          page_size: "20",
          ...(invoiceFilters.date_from ? { date_from: invoiceFilters.date_from } : {}),
          ...(invoiceFilters.date_to ? { date_to: invoiceFilters.date_to } : {}),
          ...(invoiceFilters.academic_year_id ? { academic_year_id: invoiceFilters.academic_year_id } : {}),
          ...(invoiceFilters.status ? { status: invoiceFilters.status } : {}),
        });
        setInvoices(res.data as FeeInvoice[]);
        setTotalPages(res.meta?.pagination?.total_pages ?? 1);
      }
    } catch {
      setPlans([]);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page, invoiceFilters.academic_year_id, invoiceFilters.date_from, invoiceFilters.date_to, invoiceFilters.status]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadInvoiceLookups();
  }, [loadInvoiceLookups]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const existingViews = loadSavedFilterViews(FEE_SAVED_VIEWS_KEY, FEE_SAVED_VIEW_KEY);
    setSavedViews(existingViews);
    if (!params.toString()) {
      const latestView = existingViews[0];
      if (latestView?.query) {
        const savedParams = new URLSearchParams(latestView.query);
        setInvoiceFilters({
          date_from: savedParams.get("date_from") || "",
          date_to: savedParams.get("date_to") || "",
          academic_year_id: savedParams.get("academic_year_id") || "",
          status: savedParams.get("status") || "",
        });
        setUrlSyncReady(true);
        return;
      }
      try {
        const saved = localStorage.getItem(FEE_FILTERS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as typeof defaultInvoiceFilters;
          setInvoiceFilters({
            date_from: parsed.date_from || "",
            date_to: parsed.date_to || "",
            academic_year_id: parsed.academic_year_id || "",
            status: parsed.status || "",
          });
          setUrlSyncReady(true);
          return;
        }
      } catch {
        // ignore parse/localStorage errors
      }
    }

    setInvoiceFilters({
      date_from: params.get("date_from") || "",
      date_to: params.get("date_to") || "",
      academic_year_id: params.get("academic_year_id") || "",
      status: params.get("status") || "",
    });
    setUrlSyncReady(true);
  }, [searchParams]);

  const buildCurrentQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (invoiceFilters.date_from) params.set("date_from", invoiceFilters.date_from);
    if (invoiceFilters.date_to) params.set("date_to", invoiceFilters.date_to);
    if (invoiceFilters.academic_year_id) params.set("academic_year_id", invoiceFilters.academic_year_id);
    if (invoiceFilters.status) params.set("status", invoiceFilters.status);
    return params.toString();
  }, [invoiceFilters.date_from, invoiceFilters.date_to, invoiceFilters.academic_year_id, invoiceFilters.status]);

  useEffect(() => {
    if (!urlSyncReady) return;
    setViewMessage("");
    const next = buildCurrentQuery();
    const current = searchParams.toString();
    if (next === current) return;
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }, [buildCurrentQuery, pathname, router, searchParams, urlSyncReady]);

  useEffect(() => {
    if (!urlSyncReady) return;
    localStorage.setItem(FEE_FILTERS_KEY, JSON.stringify(invoiceFilters));
  }, [invoiceFilters, urlSyncReady]);

  const hasActiveFilters = Object.values(invoiceFilters).some((value) => value.trim() !== "");
  const activeFilters = [
    invoiceFilters.date_from
      ? {
          key: "date_from",
          label: `From: ${invoiceFilters.date_from}`,
          clear: () => setInvoiceFilters((prev) => ({ ...prev, date_from: "" })),
        }
      : null,
    invoiceFilters.date_to
      ? { key: "date_to", label: `To: ${invoiceFilters.date_to}`, clear: () => setInvoiceFilters((prev) => ({ ...prev, date_to: "" })) }
      : null,
    invoiceFilters.academic_year_id
      ? {
          key: "academic_year_id",
          label: `Academic Year: ${
            academicYears.find((year) => year.id === invoiceFilters.academic_year_id)?.label || invoiceFilters.academic_year_id
          }`,
          clear: () => setInvoiceFilters((prev) => ({ ...prev, academic_year_id: "" })),
        }
      : null,
    invoiceFilters.status
      ? { key: "status", label: `Status: ${invoiceFilters.status}`, clear: () => setInvoiceFilters((prev) => ({ ...prev, status: "" })) }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  function clearAllFilters() {
    setPage(1);
    setInvoiceFilters(defaultInvoiceFilters);
    setViewMessage("");
  }

  function saveCurrentView() {
    const query = buildCurrentQuery();
    if (!query) {
      setViewMessage("Add at least one filter before saving a view.");
      return;
    }
    try {
      const nextViews = upsertSavedView(savedViews, query, "Fee View");
      setSavedViews(nextViews);
      persistSavedFilterViews(FEE_SAVED_VIEWS_KEY, nextViews, FEE_SAVED_VIEW_KEY);
      localStorage.setItem(FEE_FILTERS_KEY, JSON.stringify(invoiceFilters));
      setViewMessage("Saved view added.");
    } catch {
      setViewMessage("Unable to save view on this browser.");
    }
  }

  async function copyCurrentLink() {
    const url = buildShareUrl(pathname, buildCurrentQuery());
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Current link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  async function copySavedViewLink(view: SavedFilterView) {
    const url = buildShareUrl(pathname, view.query);
    try {
      await navigator.clipboard.writeText(url);
      setViewMessage("Saved view link copied.");
    } catch {
      setViewMessage("Unable to copy link.");
    }
  }

  function applySavedView(view: SavedFilterView) {
    router.replace(`${pathname}?${view.query}`, { scroll: false });
    setViewMessage(`Applied "${view.name}".`);
  }

  function deleteSavedView(viewId: string) {
    const nextViews = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(nextViews);
    persistSavedFilterViews(FEE_SAVED_VIEWS_KEY, nextViews, FEE_SAVED_VIEW_KEY);
    setViewMessage("Saved view removed.");
  }

  async function handleCreatePlan() {
    if (!planForm.title || !planForm.amount) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createFeePlan({
        title: planForm.title,
        amount: Number(planForm.amount),
        due_day: planForm.due_day ? Number(planForm.due_day) : undefined,
      });
      setMessage("Fee plan created!");
      setPlanForm({ title: "", amount: "", due_day: "" });
      setShowPlanForm(false);
      loadData();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateInvoice() {
    if (!invoiceForm.student_id || !invoiceForm.fee_plan_id || !invoiceForm.amount_due || !invoiceForm.due_date) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createFeeInvoice({
        student_id: invoiceForm.student_id,
        fee_plan_id: invoiceForm.fee_plan_id || undefined,
        period_start: invoiceForm.period_start,
        period_end: invoiceForm.period_end,
        amount_due: Number(invoiceForm.amount_due),
        due_date: invoiceForm.due_date,
      });
      setMessage("Invoice created!");
      setInvoiceForm({ student_id: "", fee_plan_id: "", period_start: "", period_end: "", amount_due: "", due_date: "" });
      setShowInvoiceForm(false);
      loadData();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordPayment() {
    if (!showPaymentForm || !paymentForm.amount) return;
    setSubmitting(true);
    setMessage("");
    try {
      await recordPayment(showPaymentForm, {
        amount: Number(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        reference_no: paymentForm.reference_no || undefined,
      });
      setMessage("Payment recorded!");
      setShowPaymentForm(null);
      setPaymentForm({ amount: "", payment_date: new Date().toISOString().split("T")[0], method: "cash", reference_no: "" });
      loadData();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { paid: "badge-green", issued: "badge-blue", partial: "badge-yellow", overdue: "badge-red", cancelled: "badge-gray", draft: "badge-gray" };
    return <span className={map[status] || "badge-gray"}>{status}</span>;
  };

  if (!isAdmin) {
    return (
      <>
        <Header title="Fees" />
        <div className="p-6">
          <div className="card text-center py-12">
            <p className="text-gray-500">Only school admins can manage fees.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Fee Management" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("created") || message.includes("recorded") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}
        {viewMessage && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            {viewMessage}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "invoices" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => { setTab("invoices"); setPage(1); }}>
            Invoices
          </button>
          <button className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "plans" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => { setTab("plans"); setPage(1); }}>
            Fee Plans
          </button>
        </div>

        <div className="card mb-6">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Invoice Filters</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div>
              <label className="label-text">Date From</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date From"
                value={invoiceFilters.date_from}
                onChange={(e) => {
                  setPage(1);
                  setInvoiceFilters((prev) => ({ ...prev, date_from: e.target.value }));
                }}
              />
            </div>
            <div>
              <label className="label-text">Date To</label>
              <input
                type="date"
                className="input-field"
                aria-label="Date To"
                value={invoiceFilters.date_to}
                onChange={(e) => {
                  setPage(1);
                  setInvoiceFilters((prev) => ({ ...prev, date_to: e.target.value }));
                }}
              />
            </div>
            <div>
              <label className="label-text">Academic Year</label>
              <select
                className="input-field"
                aria-label="Academic Year"
                value={invoiceFilters.academic_year_id}
                onChange={(e) => {
                  setPage(1);
                  setInvoiceFilters((prev) => ({ ...prev, academic_year_id: e.target.value }));
                }}
              >
                <option value="">All Academic Years</option>
                {academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Invoice Status</label>
              <select
                className="input-field"
                aria-label="Invoice Status"
                value={invoiceFilters.status}
                onChange={(e) => {
                  setPage(1);
                  setInvoiceFilters((prev) => ({ ...prev, status: e.target.value }));
                }}
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex items-end">
              <button className="btn-secondary w-full" onClick={clearAllFilters}>Clear all</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasActiveFilters &&
              activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"
                  onClick={filter.clear}
                  type="button"
                >
                  {filter.label} ×
                </button>
              ))}
          </div>
          <SavedViewsPanel
            title="Saved Fee Views"
            views={savedViews}
            onSaveCurrent={saveCurrentView}
            onCopyCurrent={copyCurrentLink}
            onApply={applySavedView}
            onCopy={copySavedViewLink}
            onDelete={deleteSavedView}
            emptyText="Save fee filters to reopen overdue and collection views quickly."
          />
        </div>

        {/* Fee Plans Tab */}
        {tab === "plans" && (
          <>
            <div className="flex justify-end mb-4">
              <button className="btn-primary" onClick={() => setShowPlanForm(!showPlanForm)}>
                {showPlanForm ? "Cancel" : "Create Plan"}
              </button>
            </div>

            {showPlanForm && (
              <div className="card mb-6">
                <h3 className="text-lg font-semibold mb-4">New Fee Plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label-text">Title *</label>
                    <input type="text" className="input-field" value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Amount (PKR) *</label>
                    <input type="number" className="input-field" value={planForm.amount} onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Due Day (1-31)</label>
                    <input type="number" min="1" max="31" className="input-field" value={planForm.due_day} onChange={(e) => setPlanForm({ ...planForm, due_day: e.target.value })} />
                  </div>
                </div>
                <button className="btn-primary" onClick={handleCreatePlan} disabled={submitting}>{submitting ? "Creating..." : "Create"}</button>
              </div>
            )}

            <div className="table-container">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Amount</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Due Day</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
                  ) : plans.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No fee plans found</td></tr>
                  ) : (
                    plans.map((p) => (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.title}</td>
                        <td className="px-4 py-3 text-gray-600">Rs. {Number(p.amount).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600">{p.due_day || "—"}</td>
                        <td className="px-4 py-3">{p.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Invoices Tab */}
        {tab === "invoices" && (
          <>
            <div className="flex justify-end mb-4">
              <button className="btn-primary" onClick={() => setShowInvoiceForm(!showInvoiceForm)}>
                {showInvoiceForm ? "Cancel" : "Create Invoice"}
              </button>
            </div>

            {showInvoiceForm && (
              <div className="card mb-6">
                <h3 className="text-lg font-semibold mb-4">New Invoice</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label-text">Student *</label>
                    <select
                      className="input-field"
                      value={invoiceForm.student_id}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, student_id: e.target.value })}
                    >
                      <option value="">Select student</option>
                      {students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.label} ({student.student_code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Fee Plan *</label>
                    <select
                      className="input-field"
                      value={invoiceForm.fee_plan_id}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, fee_plan_id: e.target.value })}
                    >
                      <option value="">Select fee plan</option>
                      {planOptions.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.title} (Rs. {Number(plan.amount).toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Amount Due *</label>
                    <input type="number" className="input-field" value={invoiceForm.amount_due} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount_due: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Period Start *</label>
                    <input type="date" className="input-field" value={invoiceForm.period_start} onChange={(e) => setInvoiceForm({ ...invoiceForm, period_start: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Period End *</label>
                    <input type="date" className="input-field" value={invoiceForm.period_end} onChange={(e) => setInvoiceForm({ ...invoiceForm, period_end: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Due Date *</label>
                    <input type="date" className="input-field" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} />
                  </div>
                </div>
                <button className="btn-primary" onClick={handleCreateInvoice} disabled={submitting}>{submitting ? "Creating..." : "Create Invoice"}</button>
              </div>
            )}

            {/* Payment Modal */}
            {showPaymentForm && (
              <div className="card mb-6 border-primary-200">
                <h3 className="text-lg font-semibold mb-4">Record Payment</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="label-text">Amount *</label>
                    <input type="number" className="input-field" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Date</label>
                    <input type="date" className="input-field" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-text">Method</label>
                    <select className="input-field" value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-text">Reference</label>
                    <input type="text" className="input-field" placeholder="Optional" value={paymentForm.reference_no} onChange={(e) => setPaymentForm({ ...paymentForm, reference_no: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={handleRecordPayment} disabled={submitting}>{submitting ? "Recording..." : "Record Payment"}</button>
                  <button className="btn-secondary" onClick={() => setShowPaymentForm(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="table-container">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Student</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Period</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Amount Due</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Paid</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No invoices found</td></tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{inv.student_id.slice(0, 8)}...</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{inv.period_start} to {inv.period_end}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">Rs. {Number(inv.amount_due).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600">Rs. {Number(inv.amount_paid).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600">{inv.due_date}</td>
                        <td className="px-4 py-3">{statusBadge(inv.status)}</td>
                        <td className="px-4 py-3 text-right">
                          {inv.status !== "paid" && inv.status !== "cancelled" && (
                            <button className="text-primary-600 hover:text-primary-800 text-sm font-medium" onClick={() => setShowPaymentForm(inv.id)}>
                              Record Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
