"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getFeePlans,
  createFeePlan,
  getFeeInvoices,
  createFeeInvoice,
  recordPayment,
  getLookupStudents,
  type LookupStudent,
} from "@/lib/api";

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

export default function FeesPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<"plans" | "invoices">("invoices");
  const [plans, setPlans] = useState<FeePlan[]>([]);
  const [planOptions, setPlanOptions] = useState<FeePlan[]>([]);
  const [invoices, setInvoices] = useState<FeeInvoice[]>([]);
  const [students, setStudents] = useState<LookupStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Forms
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState({ title: "", amount: "", due_day: "" });
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ student_id: "", fee_plan_id: "", period_start: "", period_end: "", amount_due: "", due_date: "" });
  const [showPaymentForm, setShowPaymentForm] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", payment_date: new Date().toISOString().split("T")[0], method: "cash", reference_no: "" });

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadInvoiceLookups = useCallback(async () => {
    try {
      const [studentsData, plansRes] = await Promise.all([
        getLookupStudents({ page_size: 200 }),
        getFeePlans({ page: "1", page_size: "200", is_active: "true" }),
      ]);
      setStudents(studentsData);
      setPlanOptions(plansRes.data as FeePlan[]);
    } catch {
      setStudents([]);
      setPlanOptions([]);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "plans") {
        const res = await getFeePlans({ page: String(page), page_size: "20" });
        setPlans(res.data as FeePlan[]);
        setTotalPages(res.meta?.pagination?.total_pages ?? 1);
      } else {
        const res = await getFeeInvoices({ page: String(page), page_size: "20" });
        setInvoices(res.data as FeeInvoice[]);
        setTotalPages(res.meta?.pagination?.total_pages ?? 1);
      }
    } catch {
      setPlans([]);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadInvoiceLookups();
  }, [loadInvoiceLookups]);

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

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "invoices" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => { setTab("invoices"); setPage(1); }}>
            Invoices
          </button>
          <button className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "plans" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => { setTab("plans"); setPage(1); }}>
            Fee Plans
          </button>
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
