const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080/api/v1";

interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: Array<{ field: string; issue: string }>;
  };
  meta?: {
    request_id?: string;
    page?: number;
    page_size?: number;
    total_items?: number;
    total_pages?: number;
    pagination?: {
      page: number;
      page_size: number;
      total_items: number;
      total_pages: number;
    };
  };
}

export interface LookupClassroom {
  id: string;
  grade_label: string;
  section_label: string;
  academic_year_name: string;
  label: string;
}

export interface LookupStudent {
  id: string;
  student_code: string;
  first_name: string;
  last_name: string | null;
  classroom_id: string;
  classroom_label: string;
  label: string;
}

export interface LookupSubject {
  id: string;
  code: string;
  name: string;
  label: string;
}

class ApiError extends Error {
  code: string;
  status: number;
  details?: Array<{ field: string; issue: string }>;

  constructor(status: number, code: string, message: string, details?: Array<{ field: string; issue: string }>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agora_access_token");
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem("agora_access_token", access);
  localStorage.setItem("agora_refresh_token", refresh);
}

function clearTokens() {
  localStorage.removeItem("agora_access_token");
  localStorage.removeItem("agora_refresh_token");
  localStorage.removeItem("agora_user");
}

async function request<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      clearTokens();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    throw new ApiError(
      res.status,
      body.error?.code || "UNKNOWN",
      body.error?.message || "Request failed",
      body.error?.details
    );
  }

  return body as ApiResponse<T>;
}

async function requestBlob(
  endpoint: string,
  options: RequestInit = {}
): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearTokens();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    throw new ApiError(
      res.status,
      body.error?.code || "UNKNOWN",
      body.error?.message || "Request failed",
      body.error?.details
    );
  }

  return res.blob();
}

// ─── Auth ───
export async function login(schoolCode: string, email: string, password: string) {
  const res = await request<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: { id: string; school_id: string; first_name: string; last_name: string; email: string; roles: string[] };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ school_code: schoolCode, email, password }),
  });

  setTokens(res.data.access_token, res.data.refresh_token);
  localStorage.setItem("agora_user", JSON.stringify(res.data.user));
  return res.data;
}

export async function logout() {
  const refreshToken = localStorage.getItem("agora_refresh_token");
  try {
    await request("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // ignore
  }
  clearTokens();
}

export async function getMe() {
  const res = await request<{
    id: string;
    school_id: string;
    first_name: string;
    last_name: string;
    email: string;
    roles: string[];
  }>("/auth/me");
  return res.data;
}

// ─── Attendance ───
export async function getAttendance(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return request(`/attendance?${query}`);
}

export async function markAttendanceBulk(data: {
  classroom_id: string;
  attendance_date: string;
  entries: Array<{ student_id: string; status: string; note?: string }>;
}) {
  return request("/attendance/bulk", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Lookup helpers ───
export async function getLookupClassrooms(params: { search?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  const res = await request<LookupClassroom[]>(`/lookups/classrooms${suffix ? `?${suffix}` : ""}`);
  return res.data;
}

export async function getLookupStudents(params: { classroom_id?: string; search?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.classroom_id) query.set("classroom_id", params.classroom_id);
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  const res = await request<LookupStudent[]>(`/lookups/students${suffix ? `?${suffix}` : ""}`);
  return res.data;
}

export async function getLookupSubjects(params: { classroom_id?: string; search?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.classroom_id) query.set("classroom_id", params.classroom_id);
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  const res = await request<LookupSubject[]>(`/lookups/subjects${suffix ? `?${suffix}` : ""}`);
  return res.data;
}

// ─── Homework ───
export async function getHomework(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return request(`/homework?${query}`);
}

export async function createHomework(data: {
  classroom_id: string;
  subject_id?: string;
  title: string;
  description?: string;
  due_at?: string;
}) {
  return request("/homework", { method: "POST", body: JSON.stringify(data) });
}

export async function getSubmissions(homeworkId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/homework/${homeworkId}/submissions?${query}`);
}

// ─── Marks / Assessments ───
export async function getAssessments(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return request(`/assessments?${query}`);
}

export async function createAssessment(data: {
  classroom_id: string;
  subject_id?: string;
  title: string;
  assessment_type: string;
  max_marks: number;
  assessment_date?: string;
}) {
  return request("/assessments", { method: "POST", body: JSON.stringify(data) });
}

export async function bulkScores(assessmentId: string, scores: Array<{ student_id: string; marks_obtained: number; remarks?: string }>) {
  return request(`/assessments/${assessmentId}/scores/bulk`, {
    method: "POST",
    body: JSON.stringify({ scores }),
  });
}

export async function getStudentMarksSummary(studentId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/students/${studentId}/marks/summary?${query}`);
}

// ─── Messaging ───
export async function getConversations(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/conversations?${query}`);
}

export async function createConversation(data: { kind: string; title?: string; participant_user_ids: string[] }) {
  return request("/conversations", { method: "POST", body: JSON.stringify(data) });
}

export async function getMessages(conversationId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/conversations/${conversationId}/messages?${query}`);
}

export async function sendMessage(conversationId: string, body: string) {
  return request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// ─── Notifications ───
export async function getNotifications(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/notifications?${query}`);
}

export async function markNotificationRead(notificationId: string) {
  return request(`/notifications/${notificationId}/read`, { method: "PATCH" });
}

// ─── Fees ───
export async function getFeePlans(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/fees/plans?${query}`);
}

export async function createFeePlan(data: {
  title: string;
  amount: number;
  due_day?: number;
  academic_year_id?: string;
  classroom_id?: string;
}) {
  return request("/fees/plans", { method: "POST", body: JSON.stringify(data) });
}

export async function getFeeInvoices(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/fees/invoices?${query}`);
}

export async function createFeeInvoice(data: {
  student_id: string;
  fee_plan_id?: string;
  period_start: string;
  period_end: string;
  amount_due: number;
  due_date: string;
}) {
  return request("/fees/invoices", { method: "POST", body: JSON.stringify(data) });
}

export async function recordPayment(invoiceId: string, data: {
  amount: number;
  payment_date: string;
  method: string;
  reference_no?: string;
  notes?: string;
}) {
  return request(`/fees/invoices/${invoiceId}/payments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Events ───
export async function getEvents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/events?${query}`);
}

export async function createEvent(data: {
  title: string;
  description?: string;
  event_type?: string;
  starts_at: string;
  ends_at?: string;
  target_scope?: string;
  target_classroom_id?: string;
}) {
  return request("/events", { method: "POST", body: JSON.stringify(data) });
}

// ─── Reports ───
export async function getAttendanceSummary(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/reports/attendance/summary?${query}`);
}

export async function getHomeworkSummary(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/reports/homework/summary?${query}`);
}

export async function getMarksSummary(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/reports/marks/summary?${query}`);
}

export async function getFeesSummary(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/reports/fees/summary?${query}`);
}

type ReportKind = "attendance" | "homework" | "marks" | "fees";
type ExportFormat = "csv" | "pdf";

export async function exportReport(
  report: ReportKind,
  format: ExportFormat,
  params: Record<string, string> = {}
) {
  const query = new URLSearchParams({
    ...params,
    format,
  }).toString();
  return requestBlob(`/reports/${report}/export?${query}`);
}

// ─── Admin Audit ───
export async function getAuditLogs(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/admin/audit-logs?${query}`);
}

export async function exportAuditLogs(format: ExportFormat, params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    ...params,
    format,
  }).toString();
  return requestBlob(`/admin/audit-logs/export?${query}`);
}

// ─── Internal Observability ───
function internalHeaders(internalApiKey: string) {
  return {
    "X-Internal-Api-Key": internalApiKey,
  };
}

export async function getObservabilityMetrics(internalApiKey: string) {
  return request("/internal/observability/metrics", {
    headers: internalHeaders(internalApiKey),
  });
}

export async function getObservabilityReady(internalApiKey: string) {
  return request("/internal/observability/ready", {
    headers: internalHeaders(internalApiKey),
  });
}

export async function getObservabilitySlo(internalApiKey: string) {
  return request("/internal/observability/slo", {
    headers: internalHeaders(internalApiKey),
  });
}

export { ApiError, clearTokens, getToken };
