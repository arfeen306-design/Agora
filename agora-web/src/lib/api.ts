const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080/api/v1";
const DEPLOYMENT_DEFAULT_SCHOOL_CODE = process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_CODE || "";
const DEFAULT_SCHOOL_CODE = DEPLOYMENT_DEFAULT_SCHOOL_CODE || "agora_demo";
const SCHOOL_CODE_STORAGE_KEY = "agora_school_code";

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
    summary?: Record<string, unknown>;
    pagination?: {
      page: number;
      page_size: number;
      total_items: number;
      total_pages: number;
    };
    [key: string]: unknown;
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

export function getSavedSchoolCode(): string {
  if (typeof window === "undefined") return DEFAULT_SCHOOL_CODE;
  return localStorage.getItem(SCHOOL_CODE_STORAGE_KEY) || DEFAULT_SCHOOL_CODE;
}

export function hasPresetSchoolCode(): boolean {
  return Boolean(DEPLOYMENT_DEFAULT_SCHOOL_CODE);
}

export function saveSchoolCode(schoolCode: string) {
  if (typeof window === "undefined") return;
  const normalized = schoolCode.trim();
  if (normalized) {
    localStorage.setItem(SCHOOL_CODE_STORAGE_KEY, normalized);
    return;
  }
  localStorage.removeItem(SCHOOL_CODE_STORAGE_KEY);
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
  const normalizedSchoolCode = schoolCode.trim();
  const res = await request<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: { id: string; school_id: string; first_name: string; last_name: string; email: string; roles: string[] };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ school_code: normalizedSchoolCode, email, password }),
  });

  setTokens(res.data.access_token, res.data.refresh_token);
  saveSchoolCode(normalizedSchoolCode);
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

// ─── Admissions ───
export type AdmissionStatus =
  | "inquiry"
  | "applied"
  | "under_review"
  | "test_scheduled"
  | "accepted"
  | "rejected"
  | "admitted"
  | "waitlisted";

export interface AdmissionPipelineStudent {
  student_id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  admission_status: AdmissionStatus;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  desired_grade_label?: string | null;
  desired_section_label?: string | null;
  created_at: string;
}

export interface AdmissionPipelineStage {
  count: number;
  students: AdmissionPipelineStudent[];
}

export interface AdmissionPipelineData {
  stages: Partial<Record<AdmissionStatus, AdmissionPipelineStage>>;
  summary: {
    total: number;
    total_active: number;
    admitted_count: number;
    rejected_count: number;
    conversion_rate: number;
  };
}

export interface AdmissionApplicationRow {
  student_id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  admission_status: AdmissionStatus;
  student_status: string;
  admission_date?: string | null;
  created_at: string;
  application_id?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  inquiry_source?: string | null;
  desired_grade_label?: string | null;
  desired_section_label?: string | null;
  stage_notes?: string | null;
  application_updated_at?: string | null;
}

export interface AdmissionApplicationDetail {
  student: {
    student_id: string;
    student_code: string;
    first_name: string;
    last_name?: string | null;
    admission_status: AdmissionStatus;
    student_status: string;
    admission_date?: string | null;
    created_at: string;
  };
  application: {
    application_id?: string | null;
    inquiry_source?: string | null;
    guardian_name?: string | null;
    guardian_phone?: string | null;
    guardian_email?: string | null;
    desired_grade_label?: string | null;
    desired_section_label?: string | null;
    desired_classroom_id?: string | null;
    desired_academic_year_id?: string | null;
    notes?: string | null;
    stage_notes?: string | null;
    current_status: AdmissionStatus;
    approved_by_user_id?: string | null;
    approved_at?: string | null;
    rejected_by_user_id?: string | null;
    rejected_at?: string | null;
    admitted_by_user_id?: string | null;
    admitted_at?: string | null;
    created_by_user_id?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  };
  enrollment: {
    classroom_id: string;
    academic_year_id: string;
    roll_no?: number | null;
    status: string;
    joined_on?: string | null;
    grade_label?: string | null;
    section_label?: string | null;
    classroom_code?: string | null;
    academic_year_name?: string | null;
  } | null;
  history: Array<{
    id: string;
    from_status?: AdmissionStatus | null;
    to_status: AdmissionStatus;
    notes?: string | null;
    created_at: string;
    changed_by_user_id?: string | null;
    changed_by_first_name?: string | null;
    changed_by_last_name?: string | null;
  }>;
}

export async function getAdmissionsPipeline(params: {
  search?: string;
  limit_per_stage?: number;
  date_from?: string;
  date_to?: string;
  academic_year_id?: string;
} = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.limit_per_stage) query.set("limit_per_stage", String(params.limit_per_stage));
  if (params.date_from) query.set("date_from", params.date_from);
  if (params.date_to) query.set("date_to", params.date_to);
  if (params.academic_year_id) query.set("academic_year_id", params.academic_year_id);
  return request<AdmissionPipelineData>(`/admissions/pipeline${query.toString() ? `?${query}` : ""}`);
}

export async function getAdmissionApplications(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<AdmissionApplicationRow[]>(`/admissions/applications${query ? `?${query}` : ""}`);
}

export async function getAdmissionApplication(studentId: string) {
  const res = await request<AdmissionApplicationDetail>(`/admissions/applications/${studentId}`);
  return res.data;
}

export async function createAdmissionInquiry(data: {
  first_name: string;
  last_name?: string;
  guardian_name: string;
  guardian_phone?: string;
  guardian_email?: string;
  inquiry_source?: string;
  desired_grade_label?: string;
  desired_section_label?: string;
  desired_classroom_id?: string;
  desired_academic_year_id?: string;
  notes?: string;
}) {
  return request("/admissions/inquiries", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAdmissionStage(
  studentId: string,
  data: {
    new_status: AdmissionStatus;
    notes?: string;
    desired_classroom_id?: string;
    desired_academic_year_id?: string;
  }
) {
  return request(`/admissions/${studentId}/stage`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function admitAdmissionApplicant(
  studentId: string,
  data: {
    classroom_id: string;
    academic_year_id?: string;
    roll_no?: number;
    notes?: string;
  }
) {
  return request(`/admissions/${studentId}/admit`, {
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

// ─── Institution Management ───
export interface InstitutionProfile {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is_active: boolean;
  logo_url?: string | null;
  branch_name?: string | null;
  address_line?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  academic_year_label?: string | null;
  school_starts_at?: string | null;
  school_ends_at?: string | null;
  weekly_holidays?: string[];
  late_arrival_cutoff?: string | null;
  attendance_rules?: Record<string, unknown>;
  principal_user_id?: string | null;
  vice_principal_user_id?: string | null;
  principal_first_name?: string | null;
  principal_last_name?: string | null;
  principal_email?: string | null;
  vice_principal_first_name?: string | null;
  vice_principal_last_name?: string | null;
  vice_principal_email?: string | null;
  active_sections: number;
  active_classrooms: number;
  active_staff: number;
  active_students: number;
}

export interface InstitutionSection {
  id: string;
  school_id: string;
  name: string;
  code: string;
  section_type: string;
  head_user_id?: string | null;
  coordinator_user_id?: string | null;
  announcements_enabled: boolean;
  display_order: number;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  class_count?: number;
  active_students?: number;
  head_first_name?: string | null;
  head_last_name?: string | null;
  head_email?: string | null;
  coordinator_first_name?: string | null;
  coordinator_last_name?: string | null;
  coordinator_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstitutionClassroom {
  id: string;
  school_id: string;
  academic_year_id: string;
  grade_label: string;
  section_label: string;
  section_id?: string | null;
  classroom_code?: string | null;
  room_number?: string | null;
  capacity?: number | null;
  is_active: boolean;
  academic_year_name?: string;
  section_name?: string | null;
  section_code?: string | null;
  homeroom_teacher_id?: string | null;
  homeroom_teacher_user_id?: string | null;
  homeroom_teacher_first_name?: string | null;
  homeroom_teacher_last_name?: string | null;
  active_student_count?: number;
  created_at: string;
  updated_at: string;
}

export async function getInstitutionProfile() {
  const res = await request<InstitutionProfile>("/institution/profile");
  return res.data;
}

export async function updateInstitutionProfile(data: Partial<InstitutionProfile>) {
  const res = await request<InstitutionProfile>("/institution/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function getInstitutionSections(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<InstitutionSection[]>(`/institution/sections?${query}`);
}

export async function createInstitutionSection(data: {
  name: string;
  code: string;
  section_type?: "pre_school" | "junior" | "middle" | "senior" | "high_school" | "general";
  head_user_id?: string | null;
  coordinator_user_id?: string | null;
  display_order?: number;
  announcements_enabled?: boolean;
  is_active?: boolean;
}) {
  return request<InstitutionSection>("/institution/sections", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateInstitutionSection(sectionId: string, data: Partial<InstitutionSection>) {
  return request<InstitutionSection>(`/institution/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getInstitutionClassrooms(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<InstitutionClassroom[]>(`/institution/classrooms?${query}`);
}

export async function createInstitutionClassroom(data: {
  academic_year_id: string;
  grade_label: string;
  section_label: string;
  section_id?: string | null;
  classroom_code?: string | null;
  room_number?: string | null;
  homeroom_teacher_user_id?: string | null;
  capacity?: number | null;
  is_active?: boolean;
}) {
  return request<InstitutionClassroom>("/institution/classrooms", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateInstitutionClassroom(classroomId: string, data: Partial<InstitutionClassroom>) {
  return request<InstitutionClassroom>(`/institution/classrooms/${classroomId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface PrincipalAttendanceToday {
  total: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  leave_count: number;
}

export interface PrincipalSectionAttendanceRow {
  section_id: string;
  section_name: string;
  section_code: string;
  attendance_records_today: number;
  present_count: number;
  late_count: number;
  absent_count: number;
}

export interface PrincipalHomeworkCompletionRow {
  section_code: string;
  section_name: string;
  total_submissions: number;
  completed_submissions: number;
  missing_submissions: number;
}

export interface PrincipalMarksUploadStatus {
  assessment_count: number;
  score_count: number;
  contributing_teachers: number;
}

export interface PrincipalFinanceAndAlerts {
  defaulter_invoices: number;
  upcoming_events: number;
  active_delegations: number;
}

export interface PrincipalDashboardData {
  attendance_today: PrincipalAttendanceToday;
  section_attendance: PrincipalSectionAttendanceRow[];
  homework_completion_by_section: PrincipalHomeworkCompletionRow[];
  marks_upload_status: PrincipalMarksUploadStatus;
  finance_and_alerts: PrincipalFinanceAndAlerts;
  generated_at: string;
}

export interface SectionDashboardRow {
  section_id: string;
  section_name: string;
  section_code: string;
  section_type: string;
  class_count: number;
  active_students: number;
  assigned_staff: number;
  attendance_records_today: number;
  late_today: number;
  absent_today: number;
}

export interface SectionDashboardClassAttendanceRow {
  classroom_id: string;
  classroom_label: string;
  classroom_code?: string | null;
  attendance_records_today: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  leave_count: number;
  attendance_rate: number;
}

export interface SectionDashboardTeacherCompletion {
  assigned_staff: number;
  homework_total_submissions: number;
  homework_completed_submissions: number;
  homework_missing_submissions: number;
  marks_assessments_count: number;
  marks_scores_count: number;
}

export interface SectionDashboardLateAbsentStudent {
  attendance_record_id: string;
  student_id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  status: "late" | "absent";
  check_in_at?: string | null;
  classroom_id: string;
  classroom_label: string;
}

export interface SectionDashboardEventItem {
  id: string;
  title: string;
  description?: string | null;
  event_type: string;
  starts_at: string;
  ends_at?: string | null;
  target_scope: "school" | "classroom";
  target_classroom_id?: string | null;
  classroom_label?: string | null;
}

export interface SectionDashboardDetail {
  section: SectionDashboardRow | null;
  class_attendance: SectionDashboardClassAttendanceRow[];
  teacher_completion: SectionDashboardTeacherCompletion;
  late_absent_students: SectionDashboardLateAbsentStudent[];
  upcoming_events: SectionDashboardEventItem[];
  announcements: SectionDashboardEventItem[];
}

export interface SectionDashboardData {
  sections: SectionDashboardRow[];
  selected_section_id?: string | null;
  selected_section_detail?: SectionDashboardDetail | null;
  generated_at: string;
}

export async function getPrincipalDashboard() {
  return request<PrincipalDashboardData>("/institution/dashboards/principal");
}

export async function getSectionDashboard(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<SectionDashboardData>(`/institution/dashboards/section${query ? `?${query}` : ""}`);
}

// ─── People Management ───
export interface StaffMember {
  id: string;
  user_id: string;
  staff_code: string;
  staff_type: string;
  designation?: string | null;
  employment_status: string;
  joining_date?: string | null;
  reporting_manager_user_id?: string | null;
  primary_section_id?: string | null;
  primary_section_name?: string | null;
  first_name: string;
  last_name?: string | null;
  email: string;
  phone?: string | null;
  is_active: boolean;
  roles: string[];
}

export interface StudentMasterRow {
  id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  admission_date?: string | null;
  admission_status: string;
  status: string;
  classroom_id?: string | null;
  roll_no?: number | null;
  grade_label?: string | null;
  section_label?: string | null;
  classroom_code?: string | null;
  section_name?: string | null;
}

export interface StudentParentLink {
  id: string;
  user_id: string;
  relation_type: string;
  is_primary: boolean;
  guardian_name?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
}

export interface StudentDetailRecord {
  student: {
    id: string;
    student_code: string;
    first_name: string;
    last_name?: string | null;
    date_of_birth?: string | null;
    gender?: string | null;
    admission_date?: string | null;
    admission_status: string;
    status: string;
    transport_info?: string | null;
    notes?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    medical_alert?: string | null;
  };
  enrollment: {
    classroom_id: string;
    academic_year_id: string;
    roll_no?: number | null;
    joined_on?: string | null;
    classroom: {
      grade_label: string;
      section_label: string;
      classroom_code?: string | null;
      display_name: string;
    };
    section?: {
      id: string;
      name: string;
      code: string;
    } | null;
    academic_year_name?: string | null;
  } | null;
  parents: StudentParentLink[];
}

export interface StudentTimelineEvent {
  type: "attendance" | "homework_assigned" | "assessment_score" | "fee_invoice" | string;
  date: string;
  time: string;
  data: Record<string, unknown>;
}

export interface StudentTimelineRecord {
  student_id: string;
  events: StudentTimelineEvent[];
}

export interface StudentAcademicSummaryRecord {
  student_id: string;
  attendance_summary: {
    total_days: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
    rate: number;
  };
  homework_summary: {
    total_assigned: number;
    submitted: number;
    completion_rate: number;
  };
  marks_summary: {
    score_count: number;
    assessment_count: number;
    average_percentage: number;
  };
  fee_summary?: {
    total_due: number;
    total_paid: number;
    outstanding: number;
    overdue_count: number;
  } | null;
  generated_at: string;
}

export interface ParentDirectoryRow {
  id: string;
  user_id: string;
  occupation?: string | null;
  guardian_name?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  whatsapp_number?: string | null;
  address_line?: string | null;
  preferred_channel: "in_app" | "push" | "email" | "sms";
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login_at?: string | null;
  linked_students_count: number;
}

export interface ParentLinkedStudentRecord {
  student_id: string;
  student_code: string;
  student_name: string;
  relation_type: string;
  is_primary: boolean;
  status: string;
  classroom?: {
    classroom_id: string;
    grade_label: string;
    section_label: string;
    display_name: string;
  } | null;
}

export interface ParentProfileRecord {
  id: string;
  user_id: string;
  occupation?: string | null;
  guardian_name?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  whatsapp_number?: string | null;
  address_line?: string | null;
  preferred_channel: "in_app" | "push" | "email" | "sms";
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active: boolean;
  last_login_at?: string | null;
  linked_students: ParentLinkedStudentRecord[];
}

export interface ParentStudentLinkInput {
  student_id: string;
  relation_type: string;
  is_primary: boolean;
}

export interface ImportJobRecord {
  id: string;
  school_id: string;
  created_by_user_id?: string | null;
  import_type: "students";
  source_format: "csv" | "xlsx" | "xls";
  source_file_name?: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  mapping?: {
    fields?: Record<string, string>;
    headers?: string[];
  };
  summary?: {
    required_fields?: string[];
    preview_rows?: Array<Record<string, unknown>>;
    error_count?: number;
    academic_year_id?: string;
    imported_count?: number;
    execution_error_count?: number;
    executed_at?: string;
  };
  created_by_first_name?: string | null;
  created_by_last_name?: string | null;
  created_by_email?: string | null;
  created_at: string;
  updated_at: string;
  detected_headers?: string[];
  field_mapping?: Record<string, string>;
  preview_rows?: Array<Record<string, unknown>>;
  errors?: Array<{
    row_number: number;
    field_name: string;
    issue: string;
    raw_value?: string;
  }>;
  imported_count?: number;
  failed_count?: number;
}

export async function getPeopleStaff(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<StaffMember[]>(`/people/staff?${query}`);
}

export async function createPeopleStaff(data: {
  first_name: string;
  last_name?: string;
  email: string;
  phone?: string;
  temporary_password?: string;
  roles: string[];
  staff_code: string;
  staff_type: string;
  designation?: string;
  joining_date?: string;
  employment_status?: string;
  reporting_manager_user_id?: string | null;
  primary_section_id?: string | null;
  id_document_no?: string;
  appointment_document_url?: string;
  policy_acknowledged_at?: string;
}) {
  return request("/people/staff", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePeopleStaff(staffId: string, data: Record<string, unknown>) {
  return request(`/people/staff/${staffId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getPeopleStudents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<StudentMasterRow[]>(`/people/students?${query}`);
}

export async function createPeopleStudent(data: Record<string, unknown>) {
  return request("/people/students", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getPeopleStudent(studentId: string) {
  const res = await request<StudentDetailRecord>(`/people/students/${studentId}`);
  return res.data;
}

export async function getPeopleStudentTimeline(studentId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<StudentTimelineRecord>(
    `/people/students/${studentId}/timeline${query ? `?${query}` : ""}`
  );
  return res.data;
}

export async function getPeopleStudentAcademicSummary(studentId: string) {
  const res = await request<StudentAcademicSummaryRecord>(`/people/students/${studentId}/academic-summary`);
  return res.data;
}

export async function getPeopleParents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<ParentDirectoryRow[]>(`/people/parents?${query}`);
}

export async function createPeopleParent(data: {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  temporary_password?: string;
  is_active?: boolean;
  occupation?: string;
  guardian_name?: string;
  father_name?: string;
  mother_name?: string;
  whatsapp_number?: string;
  address_line?: string;
  preferred_channel?: "in_app" | "push" | "email" | "sms";
  linked_students?: ParentStudentLinkInput[];
}) {
  return request("/people/parents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getPeopleParent(parentId: string) {
  const res = await request<ParentProfileRecord>(`/people/parents/${parentId}`);
  return res.data;
}

export async function updatePeopleParent(
  parentId: string,
  data: {
    first_name?: string;
    last_name?: string | null;
    email?: string;
    phone?: string | null;
    is_active?: boolean;
    occupation?: string | null;
    guardian_name?: string | null;
    father_name?: string | null;
    mother_name?: string | null;
    whatsapp_number?: string | null;
    address_line?: string | null;
    preferred_channel?: "in_app" | "push" | "email" | "sms";
    linked_students?: ParentStudentLinkInput[];
  }
) {
  return request<ParentProfileRecord>(`/people/parents/${parentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function previewStudentImport(data: {
  source_file_name: string;
  source_format?: "csv" | "xlsx" | "xls";
  file_base64: string;
  import_type?: "students";
  mapping?: Record<string, string>;
  default_academic_year_id?: string;
}) {
  const res = await request<ImportJobRecord>("/people/imports/students/preview", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function executeImportJob(
  jobId: string,
  data: {
    create_parent_accounts?: boolean;
  } = {}
) {
  return request<ImportJobRecord>(`/people/imports/jobs/${jobId}/execute`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getImportJobs(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<ImportJobRecord[]>(`/people/imports/jobs?${query}`);
}

export async function getImportJob(jobId: string) {
  const res = await request<ImportJobRecord>(`/people/imports/jobs/${jobId}`);
  return res.data;
}

export async function getImportErrors(jobId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/people/imports/jobs/${jobId}/errors?${query}`);
}

export async function exportImportErrorsCsv(jobId: string) {
  return requestBlob(`/people/imports/jobs/${jobId}/errors?format=csv`);
}

// ─── RBAC / Delegation ───
export interface RoleTemplate {
  id: number;
  code: string;
  description: string;
  assigned_users: number;
  permissions: Array<{
    code: string;
    module: string;
    description: string;
    scope_level: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
  }>;
}

export interface DelegationRecord {
  id: string;
  granted_by_user_id: string;
  granted_to_user_id: string;
  permission_code: string;
  scope_type: string;
  scope_id?: string | null;
  grant_reason?: string | null;
  starts_at: string;
  ends_at?: string | null;
  is_active: boolean;
  granted_by_first_name?: string | null;
  granted_by_last_name?: string | null;
  granted_by_email?: string | null;
  granted_to_first_name?: string | null;
  granted_to_last_name?: string | null;
  granted_to_email?: string | null;
}

export async function getRbacTemplates() {
  const res = await request<RoleTemplate[]>("/rbac/templates");
  return res.data;
}

export async function updateRbacTemplate(
  roleCode: string,
  data: {
    permissions: Array<{
      code: string;
      scope_level?: "school" | "section" | "classroom";
      can_view?: boolean;
      can_create?: boolean;
      can_edit?: boolean;
      can_delete?: boolean;
    }>;
  }
) {
  return request(`/rbac/templates/${roleCode}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getDelegations(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<DelegationRecord[]>(`/rbac/delegations?${query}`);
}

export async function createDelegation(data: {
  granted_to_user_id: string;
  permission_code: string;
  scope_type?: "school" | "section" | "classroom";
  scope_id?: string | null;
  starts_at?: string;
  ends_at?: string | null;
  grant_reason?: string;
}) {
  return request<DelegationRecord>("/rbac/delegations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function revokeDelegation(delegationId: string) {
  return request<DelegationRecord>(`/rbac/delegations/${delegationId}/revoke`, {
    method: "PATCH",
  });
}

export async function getMyEffectivePermissions() {
  return request("/rbac/me/effective-permissions");
}

export async function getLookupSections(params: { search?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  const res = await request<Array<{ id: string; name: string; code: string; label: string }>>(
    `/lookups/sections${suffix ? `?${suffix}` : ""}`
  );
  return res.data;
}

export async function getLookupStaff(params: {
  search?: string;
  page_size?: number;
  staff_type?: string;
  section_id?: string;
} = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  if (params.staff_type) query.set("staff_type", params.staff_type);
  if (params.section_id) query.set("section_id", params.section_id);
  const suffix = query.toString();
  const res = await request<Array<{ id: string; user_id: string; staff_type: string; label: string; email: string }>>(
    `/lookups/staff${suffix ? `?${suffix}` : ""}`
  );
  return res.data;
}

export async function getLookupAcademicYears(params: { search?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  const res = await request<Array<{ id: string; name: string; is_current: boolean; label: string }>>(
    `/lookups/academic-years${suffix ? `?${suffix}` : ""}`
  );
  return res.data;
}

export async function previewPeopleImport(data: {
  source_file_name: string;
  source_format?: "csv" | "xlsx" | "xls";
  file_base64: string;
  import_type: "students" | "staff" | "parents";
  mapping?: Record<string, string>;
  default_academic_year_id?: string;
}) {
  const { import_type, ...payload } = data;
  const res = await request<ImportJobRecord>(`/people/imports/${import_type}/preview`, {
    method: "POST",
    body: JSON.stringify({ import_type, ...payload }),
  });
  return res.data;
}

export async function getPeopleMyStudents() {
  const res = await request<MyLinkedStudentRecord[]>("/people/me/students");
  return res.data;
}

export async function getMyReportCardHistory(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return request<FamilyReportCardHistoryPayload>(
    `/report-cards/mine/history${query.toString() ? `?${query.toString()}` : ""}`
  );
}

export async function getExecutiveOverview(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return request<ExecutiveOverviewRecord>(
    `/reports/executive/overview${query.toString() ? `?${query.toString()}` : ""}`
  );
}

export async function getFeesFinanceSummary(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return request<FeesFinanceSummaryRecord>(
    `/fees/summary${query.toString() ? `?${query.toString()}` : ""}`
  );
}

export async function getTutorConfig() {
  const res = await request<TutorConfig>("/tutor/config");
  return res.data;
}

export async function getTutorSessions(params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return request<TutorSession[]>(`/tutor/sessions${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function createTutorSession(data: { topic?: string; subject_id?: string }) {
  const res = await request<TutorSession>("/tutor/sessions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function getTutorSession(sessionId: string) {
  const res = await request<{ session: TutorSession; messages: TutorMessage[] }>(`/tutor/sessions/${sessionId}`);
  return {
    ...res.data.session,
    messages: res.data.messages || [],
  } as TutorSessionDetail;
}

export async function sendTutorMessage(
  sessionId: string,
  content: string
): Promise<{
  user_message: TutorMessage;
  assistant_message: TutorMessage;
  session_message_count: number;
  token_budget: { used: number; remaining: number };
}> {
  const res = await request<{
    user_message: Partial<TutorMessage>;
    assistant_message: Partial<TutorMessage>;
    session_message_count: number;
    token_budget: { used: number; remaining: number };
  }>(`/tutor/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  const now = new Date().toISOString();
  return {
    ...res.data,
    user_message: {
      id: res.data.user_message?.id || `user-${Date.now()}`,
      session_id: sessionId,
      role: "user",
      content: res.data.user_message?.content || content,
      token_count: res.data.user_message?.token_count ?? null,
      model: res.data.user_message?.model ?? null,
      latency_ms: res.data.user_message?.latency_ms ?? null,
      created_at: res.data.user_message?.created_at || now,
    },
    assistant_message: {
      id: res.data.assistant_message?.id || `assistant-${Date.now()}`,
      session_id: sessionId,
      role: "assistant",
      content: res.data.assistant_message?.content || "",
      token_count: res.data.assistant_message?.token_count ?? null,
      model: res.data.assistant_message?.model ?? null,
      latency_ms: res.data.assistant_message?.latency_ms ?? null,
      created_at: res.data.assistant_message?.created_at || now,
    },
  };
}

export async function closeTutorSession(sessionId: string) {
  const res = await request<TutorSession>(`/tutor/sessions/${sessionId}/close`, {
    method: "POST",
  });
  return res.data;
}

// ─── Timetable ───
export interface TimetableSlotRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  period_id: string;
  day_of_week: number;
  day_name: string;
  is_active: boolean;
  period_number: number;
  period_label: string;
  starts_at: string;
  ends_at: string;
  is_break: boolean;
}

export interface TimetableEntryRow {
  id: string;
  slot_id: string;
  classroom_id: string;
  subject_id: string | null;
  teacher_id: string | null;
  entry_type: "teaching" | "activity" | "study_hall" | "break";
  room_number: string | null;
  notes: string | null;
  is_active: boolean;
  day_of_week: number;
  day_name?: string;
  period_number: number;
  period_label: string;
  starts_at?: string;
  ends_at?: string;
  subject_code?: string | null;
  subject_name?: string | null;
  teacher_first_name?: string | null;
  teacher_last_name?: string | null;
  teacher_name?: string;
  classroom_label?: string;
}

export interface TimetableSubstitutionRow {
  id: string;
  timetable_entry_id: string;
  substitute_teacher_id: string;
  substitution_date: string;
  reason: string | null;
  is_active: boolean;
  classroom_id?: string;
  classroom_label?: string;
  slot_id?: string;
  day_of_week?: number;
  day_name?: string;
  period_number?: number;
  period_label?: string;
  substitute_teacher_name?: string;
  original_teacher_name?: string;
}

export interface ClassroomTimetablePayload {
  classroom: {
    id: string;
    grade_label: string;
    section_label: string;
    room_number: string | null;
    label: string;
  };
  academic_year_id: string;
  slots: TimetableSlotRow[];
  entries: TimetableEntryRow[];
  substitutions: TimetableSubstitutionRow[];
}

export interface TeacherTimetablePayload {
  teacher?: {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  teacher_id?: string;
  academic_year_id: string;
  entries: TimetableEntryRow[];
}

export async function getTimetablePeriods(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/timetable/periods${query ? `?${query}` : ""}`);
}

export async function createTimetablePeriod(data: {
  academic_year_id: string;
  period_number: number;
  label: string;
  starts_at: string;
  ends_at: string;
  is_break?: boolean;
  is_active?: boolean;
}) {
  return request("/timetable/periods", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTimetablePeriod(periodId: string, data: Record<string, unknown>) {
  return request(`/timetable/periods/${periodId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function generateTimetableSlots(data: { academic_year_id: string; weekdays?: number[] }) {
  return request<{ academic_year_id: string; weekdays: number[]; generated_slots: number }>(
    "/timetable/slots/generate",
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

export async function getTimetableSlots(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<TimetableSlotRow[]>(`/timetable/slots${query ? `?${query}` : ""}`);
  return res.data;
}

export async function createTimetableEntry(data: {
  classroom_id: string;
  slot_id: string;
  subject_id?: string;
  teacher_id?: string;
  entry_type?: "teaching" | "activity" | "study_hall" | "break";
  room_number?: string;
  notes?: string;
}) {
  return request<TimetableEntryRow>("/timetable/entries", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTimetableEntry(entryId: string, data: Record<string, unknown>) {
  return request<TimetableEntryRow>(`/timetable/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTimetableEntry(entryId: string) {
  return request<{ id: string; is_active: boolean }>(`/timetable/entries/${entryId}`, {
    method: "DELETE",
  });
}

export async function getClassroomTimetable(classroomId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<ClassroomTimetablePayload>(
    `/timetable/classrooms/${classroomId}${query ? `?${query}` : ""}`
  );
  return res.data;
}

export async function getTeacherTimetable(teacherId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<TeacherTimetablePayload>(
    `/timetable/teachers/${teacherId}${query ? `?${query}` : ""}`
  );
  return res.data;
}

export async function getTimetableTeachers(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<Array<{
    id: string;
    user_id: string;
    employee_code: string;
    designation: string | null;
    first_name: string;
    last_name: string | null;
    email: string;
    label: string;
  }>>(`/timetable/teachers${query ? `?${query}` : ""}`);
  return res.data;
}

export async function getMyTeacherTimetable(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<TeacherTimetablePayload>(`/timetable/teachers/me${query ? `?${query}` : ""}`);
  return res.data;
}

export async function getTimetableSubstitutions(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<TimetableSubstitutionRow[]>(`/timetable/substitutions${query ? `?${query}` : ""}`);
}

export async function createTimetableSubstitution(data: {
  timetable_entry_id: string;
  substitution_date: string;
  substitute_teacher_id: string;
  reason?: string;
}) {
  return request<TimetableSubstitutionRow>("/timetable/substitutions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function revokeTimetableSubstitution(substitutionId: string) {
  return request<TimetableSubstitutionRow>(`/timetable/substitutions/${substitutionId}/revoke`, {
    method: "PATCH",
  });
}

// ─── Discipline ───
export type DisciplineIncidentType =
  | "minor_infraction"
  | "major_infraction"
  | "positive_behavior"
  | "bullying"
  | "safety_concern";

export type DisciplineSeverity = "low" | "medium" | "high" | "critical";
export type DisciplineIncidentStatus = "reported" | "under_review" | "resolved" | "escalated";
export type DisciplineConsequenceType =
  | "verbal_warning"
  | "written_warning"
  | "detention"
  | "suspension"
  | "parent_meeting"
  | "community_service"
  | "other";

export interface DisciplineConsequenceRecord {
  id: string;
  incident_id: string;
  consequence_type: DisciplineConsequenceType;
  description?: string | null;
  starts_on: string;
  ends_on?: string | null;
  parent_notified: boolean;
  parent_notified_at?: string | null;
  administered_by_user_id: string;
  administered_by_first_name?: string | null;
  administered_by_last_name?: string | null;
  created_at: string;
}

export interface DisciplineIncidentRecord {
  id: string;
  student_id: string;
  classroom_id?: string | null;
  section_id?: string | null;
  reported_by_user_id: string;
  incident_date: string;
  incident_type: DisciplineIncidentType;
  description: string;
  location?: string | null;
  witnesses?: string | null;
  severity: DisciplineSeverity;
  status: DisciplineIncidentStatus;
  resolution_notes?: string | null;
  pastoral_notes?: string | null;
  resolved_by_user_id?: string | null;
  resolved_at?: string | null;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
  student_code?: string;
  student_first_name?: string;
  student_last_name?: string | null;
  grade_label?: string | null;
  section_label?: string | null;
  classroom_code?: string | null;
  room_number?: string | null;
  section_name?: string | null;
  section_code?: string | null;
  reported_by_first_name?: string | null;
  reported_by_last_name?: string | null;
  resolved_by_first_name?: string | null;
  resolved_by_last_name?: string | null;
  consequences_count?: number;
  consequences?: DisciplineConsequenceRecord[];
}

export interface StudentDisciplineSummaryRecord {
  student_id: string;
  total_incidents: number;
  open_incidents: number;
  escalated_incidents: number;
  resolved_incidents: number;
  by_severity: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  consequence_count: number;
  incidents: DisciplineIncidentRecord[];
}

export async function getDisciplineIncidents(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<DisciplineIncidentRecord[]>(`/discipline/incidents${query ? `?${query}` : ""}`);
}

export async function createDisciplineIncident(data: {
  student_id: string;
  incident_date: string;
  incident_type: DisciplineIncidentType;
  description: string;
  location?: string;
  witnesses?: string;
  severity: DisciplineSeverity;
  status?: "reported" | "under_review" | "escalated";
  resolution_notes?: string;
  pastoral_notes?: string;
  classroom_id?: string;
  section_id?: string;
  is_sensitive?: boolean;
}) {
  return request<DisciplineIncidentRecord>("/discipline/incidents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getDisciplineIncident(incidentId: string) {
  const res = await request<DisciplineIncidentRecord>(`/discipline/incidents/${incidentId}`);
  return res.data;
}

export async function updateDisciplineIncident(incidentId: string, data: Record<string, unknown>) {
  return request<DisciplineIncidentRecord>(`/discipline/incidents/${incidentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function createDisciplineConsequence(
  incidentId: string,
  data: {
    consequence_type: DisciplineConsequenceType;
    description?: string;
    starts_on: string;
    ends_on?: string;
    parent_notified?: boolean;
  }
) {
  return request<DisciplineConsequenceRecord>(`/discipline/incidents/${incidentId}/consequences`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getStudentDisciplineSummary(studentId: string) {
  const res = await request<StudentDisciplineSummaryRecord>(`/discipline/students/${studentId}/summary`);
  return res.data;
}

// ─── HR & Payroll ───
export interface HrDashboardSummary {
  month: string;
  active_staff: number;
  open_payroll_periods: number;
  pending_adjustments: number;
  pending_leave_requests: number;
  current_month_net_payroll: number;
  staff_attendance_today?: {
    total_active_staff: number;
    marked_staff: number;
    unmarked_staff: number;
    present_count: number;
    late_count: number;
    absent_count: number;
    leave_count: number;
  };
}

export interface HrSalaryStructureRecord {
  id: string;
  school_id: string;
  staff_profile_id: string;
  effective_from: string;
  effective_to?: string | null;
  base_salary: number;
  allowances_json: Array<{ label: string; amount: number }>;
  deductions_json: Array<{ label: string; amount: number }>;
  bonuses_json: Array<{ label: string; amount: number }>;
  provident_fund: number;
  gop_fund: number;
  currency_code: string;
  is_active: boolean;
  notes?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrSalaryAdjustmentRecord {
  id: string;
  school_id: string;
  staff_profile_id: string;
  adjustment_type: "increment" | "allowance" | "deduction" | "bonus" | "one_time";
  amount: number;
  is_recurring: boolean;
  effective_on: string;
  expires_on?: string | null;
  reason?: string | null;
  notes?: string | null;
  status: "pending" | "approved" | "rejected";
  approved_by_user_id?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrPayrollPeriodRecord {
  id: string;
  school_id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  status: "draft" | "generated" | "closed" | "paid";
  generated_by_user_id?: string | null;
  generated_at?: string | null;
  closed_at?: string | null;
  payroll_record_count?: number;
  net_payroll_total?: number;
  created_at: string;
  updated_at: string;
}

export interface HrPayrollRecord {
  id: string;
  school_id: string;
  payroll_period_id: string;
  staff_profile_id: string;
  salary_structure_id?: string | null;
  base_salary: number;
  allowances_total: number;
  deductions_total: number;
  bonus_total: number;
  provident_fund: number;
  gop_fund: number;
  gross_salary: number;
  net_salary: number;
  breakdown_json: Record<string, unknown>;
  payment_status: "pending" | "paid" | "cancelled";
  paid_on?: string | null;
  payment_method?: string | null;
  finance_notes?: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
  period_label?: string;
  period_start?: string;
  period_end?: string;
  user_id?: string;
  staff_code?: string | null;
  designation?: string | null;
  first_name?: string;
  last_name?: string | null;
  email?: string;
}

export interface HrAttendanceSummary {
  month: string;
  date_from: string;
  date_to: string;
  total_days: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  leave_days: number;
  first_check_in?: string | null;
  last_check_out?: string | null;
}

export interface HrLeaveSummary {
  month: string;
  total_requests: number;
  approved_requests: number;
  pending_requests: number;
  approved_days: number;
}

export interface HrSelfOverview {
  profile: Record<string, unknown>;
  attendance_summary: HrAttendanceSummary;
  leave_summary: HrLeaveSummary;
  current_salary_structure?: HrSalaryStructureRecord | null;
  adjustments: HrSalaryAdjustmentRecord[];
  payroll_history: HrPayrollRecord[];
  payroll_pagination?: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
  documents: Array<{
    id: string;
    category: string;
    document_name: string;
    file_url: string;
    expires_on?: string | null;
    is_active: boolean;
    created_at: string;
  }>;
}

export interface HrStaffProfilePayload {
  profile: Record<string, unknown>;
  attendance_summary: Record<string, unknown>;
  leave_summary: Record<string, unknown>;
  latest_payroll_record?: Record<string, unknown> | null;
  latest_salary_structure?: Record<string, unknown> | null;
}

export async function getHrDashboardSummary(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<HrDashboardSummary>(
    `/people/hr/dashboard/summary${query ? `?${query}` : ""}`
  );
  return res.data;
}

export async function getHrStaffProfile(staffId: string) {
  const res = await request<HrStaffProfilePayload>(`/people/hr/staff/${staffId}/profile`);
  return res.data;
}

export async function updateHrStaffProfile(staffId: string, data: Record<string, unknown>) {
  const res = await request(`/people/hr/staff/${staffId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function getHrSalaryStructures(staffId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<HrSalaryStructureRecord[]>(
    `/people/hr/staff/${staffId}/salary-structures${query ? `?${query}` : ""}`
  );
}

export async function createHrSalaryStructure(
  staffId: string,
  data: {
    effective_from: string;
    base_salary: number;
    allowances?: Array<{ label: string; amount: number }>;
    deductions?: Array<{ label: string; amount: number }>;
    bonuses?: Array<{ label: string; amount: number }>;
    provident_fund?: number;
    gop_fund?: number;
    currency_code?: string;
    notes?: string;
  }
) {
  return request<HrSalaryStructureRecord>(`/people/hr/staff/${staffId}/salary-structures`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getHrSalaryAdjustments(staffId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<HrSalaryAdjustmentRecord[]>(
    `/people/hr/staff/${staffId}/adjustments${query ? `?${query}` : ""}`
  );
}

export async function createHrSalaryAdjustment(
  staffId: string,
  data: {
    adjustment_type: "increment" | "allowance" | "deduction" | "bonus" | "one_time";
    amount: number;
    is_recurring?: boolean;
    effective_on: string;
    expires_on?: string;
    reason?: string;
    notes?: string;
    status?: "pending" | "approved" | "rejected";
  }
) {
  return request<HrSalaryAdjustmentRecord>(`/people/hr/staff/${staffId}/adjustments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createHrAttendanceLog(
  staffId: string,
  data: {
    attendance_date: string;
    check_in_at?: string;
    check_out_at?: string;
    status?: "present" | "absent" | "late" | "leave";
    note?: string;
  }
) {
  return request(`/people/hr/staff/${staffId}/attendance-logs`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createHrLeaveRecord(
  staffId: string,
  data: {
    leave_type?: string;
    starts_on: string;
    ends_on: string;
    total_days?: number;
    status?: "pending" | "approved" | "rejected" | "cancelled";
    reason?: string;
  }
) {
  return request(`/people/hr/staff/${staffId}/leave-records`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getHrPayrollPeriods(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<HrPayrollPeriodRecord[]>(`/people/hr/payroll/periods${query ? `?${query}` : ""}`);
}

export async function createHrPayrollPeriod(data: {
  period_label: string;
  period_start: string;
  period_end: string;
}) {
  return request<HrPayrollPeriodRecord>("/people/hr/payroll/periods", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface HrPayrollGenerateResult {
  period_id: string;
  period_status: string;
  generated_records: number;
  skipped_staff_without_structure: number;
}

export async function generateHrPayroll(periodId: string) {
  return request<HrPayrollGenerateResult>(`/people/hr/payroll/periods/${periodId}/generate`, {
    method: "POST",
  });
}

export async function getHrPayrollRecords(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<HrPayrollRecord[]>(`/people/hr/payroll/records${query ? `?${query}` : ""}`);
}

export async function getHrPayrollRecord(recordId: string) {
  const res = await request<HrPayrollRecord>(`/people/hr/payroll/records/${recordId}`);
  return res.data;
}

export async function updateHrPayrollPayment(
  recordId: string,
  data: {
    payment_status: "pending" | "paid" | "cancelled";
    paid_on?: string;
    payment_method?: string;
    finance_notes?: string;
  }
) {
  return request<HrPayrollRecord>(`/people/hr/payroll/records/${recordId}/payment`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getHrSalarySlip(recordId: string) {
  const res = await request(`/people/hr/payroll/records/${recordId}/salary-slip?format=json`);
  return res.data;
}

export async function downloadHrSalarySlipPdf(recordId: string) {
  return requestBlob(`/people/hr/payroll/records/${recordId}/salary-slip?format=pdf`);
}

export async function getMyHrOverview() {
  const res = await request<HrSelfOverview>("/people/hr/me/overview");
  return res.data;
}

export async function getMyHrAttendanceSummary(params: { month?: string } = {}) {
  const query = new URLSearchParams();
  if (params.month) query.set("month", params.month);
  const suffix = query.toString();
  const res = await request<{ attendance: HrAttendanceSummary; leave: HrLeaveSummary }>(
    `/people/hr/me/attendance-summary${suffix ? `?${suffix}` : ""}`
  );
  return res.data;
}

export async function getMyHrPayrollRecords(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return request<HrPayrollRecord[]>(`/people/hr/me/payroll-records${query ? `?${query}` : ""}`);
}

export async function getMyHrSalarySlip(recordId: string) {
  const res = await request<HrPayrollRecord>(`/people/hr/me/payroll-records/${recordId}/salary-slip?format=json`);
  return res.data;
}

export async function downloadMyHrSalarySlipPdf(recordId: string) {
  return requestBlob(`/people/hr/me/payroll-records/${recordId}/salary-slip?format=pdf`);
}

// ─── Document Vault ───
export interface DocumentCategoryOption {
  code: string;
  label: string;
  allowed_scope_types?: string[];
}

export interface DocumentVaultItem {
  id: string;
  school_id: string;
  title: string;
  description?: string | null;
  file_key: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  category: string;
  scope_type: string;
  scope_id?: string | null;
  uploaded_by_user_id?: string | null;
  uploaded_by_first_name?: string | null;
  uploaded_by_last_name?: string | null;
  version_no: number;
  versions_count?: number;
  downloads_count?: number;
  is_archived: boolean;
  expires_on?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentVaultAccessRule {
  id: string;
  access_type: "role" | "user";
  role_code?: string | null;
  user_id?: string | null;
  can_view: boolean;
  can_download: boolean;
  created_at: string;
}

export interface DocumentVaultVersion {
  id: string;
  version_no: number;
  file_key: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by_user_id?: string | null;
  created_at: string;
}

export interface DocumentVaultDetailPayload extends DocumentVaultItem {
  access_rules: DocumentVaultAccessRule[];
  versions: DocumentVaultVersion[];
}

export interface DocumentAccessRuleInput {
  access_type: "role" | "user";
  role_code?: string;
  user_id?: string;
  can_view?: boolean;
  can_download?: boolean;
}

export interface CreateDocumentPayload {
  title: string;
  description?: string;
  file_key: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  category: string;
  scope_type: string;
  scope_id?: string | null;
  expires_on?: string | null;
  metadata?: Record<string, unknown>;
  access_rules?: DocumentAccessRuleInput[];
}

export interface UpdateDocumentPayload {
  title?: string;
  description?: string | null;
  category?: string;
  scope_type?: string;
  scope_id?: string | null;
  expires_on?: string | null;
  is_archived?: boolean;
  metadata?: Record<string, unknown>;
  access_rules?: DocumentAccessRuleInput[];
}

export interface DocumentDownloadTarget {
  url: string;
  expires_at?: string;
  method?: string;
}

export interface DocumentDownloadEvent {
  id: string;
  document_id: string;
  downloaded_by_user_id?: string | null;
  downloaded_by_first_name?: string | null;
  downloaded_by_last_name?: string | null;
  downloaded_by_email?: string | null;
  downloaded_at: string;
  delivery_method: string;
}

export interface DocumentDownloadsReportRow {
  document_id: string;
  title: string;
  category: string;
  scope_type: string;
  scope_id?: string | null;
  downloads_count: number;
  unique_downloaders: number;
  last_downloaded_at?: string | null;
}

export async function getDocumentCategories() {
  const res = await request<DocumentCategoryOption[]>("/documents/categories");
  return res.data;
}

export async function getDocuments(
  params: {
    search?: string;
    category?: string;
    scope_type?: string;
    scope_id?: string;
    include_archived?: boolean;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.scope_type) query.set("scope_type", params.scope_type);
  if (params.scope_id) query.set("scope_id", params.scope_id);
  if (params.include_archived) query.set("include_archived", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(`/documents${suffix ? `?${suffix}` : ""}`);
}

export async function createDocument(data: CreateDocumentPayload) {
  const res = await request<DocumentVaultItem>("/documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateDocument(documentId: string, data: UpdateDocumentPayload) {
  const res = await request<DocumentVaultItem>(`/documents/${documentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function getDocumentDetail(documentId: string) {
  const res = await request<DocumentVaultDetailPayload>(`/documents/${documentId}`);
  return res.data;
}

export async function getStudentDocuments(
  studentId: string,
  params: {
    include_archived?: boolean;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.include_archived) query.set("include_archived", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(
    `/documents/student/${studentId}${suffix ? `?${suffix}` : ""}`
  );
}

export async function getStaffDocuments(
  staffId: string,
  params: {
    include_archived?: boolean;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.include_archived) query.set("include_archived", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(
    `/documents/staff/${staffId}${suffix ? `?${suffix}` : ""}`
  );
}

export async function getAdmissionDocuments(
  applicationId: string,
  params: {
    include_archived?: boolean;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.include_archived) query.set("include_archived", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(
    `/documents/admission/${applicationId}${suffix ? `?${suffix}` : ""}`
  );
}

export async function getFinanceDocuments(
  financeId: string,
  params: {
    include_archived?: boolean;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.include_archived) query.set("include_archived", "true");
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(
    `/documents/finance/${financeId}${suffix ? `?${suffix}` : ""}`
  );
}

export async function setDocumentAccessRules(documentId: string, accessRules: DocumentAccessRuleInput[]) {
  const res = await request<{
    document_id: string;
    access_rules: DocumentVaultAccessRule[];
  }>(`/documents/${documentId}/access`, {
    method: "POST",
    body: JSON.stringify({ access_rules: accessRules }),
  });
  return res.data;
}

export async function archiveDocument(documentId: string, isArchived = true) {
  const res = await request<DocumentVaultItem>(`/documents/${documentId}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ is_archived: isArchived }),
  });
  return res.data;
}

export async function addDocumentVersion(
  documentId: string,
  data: {
    file_key: string;
    file_name: string;
    file_size_bytes: number;
    mime_type: string;
  }
) {
  const res = await request<DocumentVaultVersion>(`/documents/${documentId}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function issueDocumentDownloadUrl(documentId: string) {
  const res = await request<{
    document_id: string;
    file_key: string;
    download: DocumentDownloadTarget;
  }>(`/documents/${documentId}/download-url`, {
    method: "POST",
  });
  return res.data;
}

export async function getDocumentDownloadEvents(
  documentId: string,
  params: {
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentDownloadEvent[]>(
    `/documents/${documentId}/download-events${suffix ? `?${suffix}` : ""}`
  );
}

export async function getDocumentExpiryReport(
  params: {
    status?: "all" | "expired" | "expiring" | "active";
    within_days?: number;
    category?: string;
    scope_type?: string;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.within_days) query.set("within_days", String(params.within_days));
  if (params.category) query.set("category", params.category);
  if (params.scope_type) query.set("scope_type", params.scope_type);
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentVaultItem[]>(
    `/documents/reports/expiry${suffix ? `?${suffix}` : ""}`
  );
}

export async function getDocumentDownloadsReport(
  params: {
    days?: number;
    category?: string;
    scope_type?: string;
    page?: number;
    page_size?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.days) query.set("days", String(params.days));
  if (params.category) query.set("category", params.category);
  if (params.scope_type) query.set("scope_type", params.scope_type);
  if (params.page) query.set("page", String(params.page));
  if (params.page_size) query.set("page_size", String(params.page_size));
  const suffix = query.toString();
  return request<DocumentDownloadsReportRow[]>(
    `/documents/reports/downloads${suffix ? `?${suffix}` : ""}`
  );
}

// ─── Class Teacher / Exam Terms / Report Cards / Setup Wizard ───
export interface PaginationPayload {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface ClassTeacherStudentRow {
  id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  roll_no?: number | null;
  student_user_id?: string | null;
}

export interface ClassTeacherExamTerm {
  id: string;
  name: string;
  term_type: "midterm" | "final" | "monthly";
  is_locked: boolean;
  starts_on?: string | null;
  ends_on?: string | null;
}

export interface ClassTeacherMyClassroomPayload {
  classroom: {
    id: string;
    grade_label: string;
    section_label: string;
    classroom_code?: string | null;
    academic_year_id: string;
    academic_year_name?: string | null;
    capacity?: number | null;
  } | null;
  message?: string;
  student_count: number;
  attendance_today: {
    present_count: number;
    absent_count: number;
    late_count: number;
    leave_count: number;
    total_marked: number;
  };
  subjects: Array<{
    classroom_subject_id?: string;
    subject_id: string;
    subject_name: string;
    subject_code?: string | null;
    teacher_id?: string | null;
    teacher_user_id?: string | null;
    teacher_first_name?: string | null;
    teacher_last_name?: string | null;
  }>;
  exam_terms: ClassTeacherExamTerm[];
  marks_completion: Array<{
    exam_term_id: string;
    term_name: string;
    assessment_count: number;
    score_count: number;
    expected_scores: number;
    completion_percentage: number;
  }>;
  subject_comment_completion: Array<{
    subject_id: string;
    subject_name: string;
    exam_term_id: string;
    term_name: string;
    total_cards: number;
    commented_rows: number;
    completion_percentage: number;
  }>;
  subject_comment_completion_trend: Array<{
    exam_term_id: string;
    term_name: string;
    term_type: string;
    total_cards: number;
    commented_rows: number;
    expected_rows: number;
    completion_percentage: number;
  }>;
}

export interface ClassTeacherConsolidatedPayload {
  classroom: {
    id: string;
    grade_label: string;
    section_label: string;
    classroom_code?: string | null;
  };
  exam_term: {
    id: string;
    name: string;
    term_type: string;
    starts_on?: string | null;
    ends_on?: string | null;
    is_locked: boolean;
  };
  subjects: Array<{
    subject_id: string;
    subject_name: string;
    subject_code?: string | null;
    assessment_count: number;
    total_max_marks: number;
  }>;
  students: Array<{
    student_id: string;
    full_name: string;
    roll_no?: number | null;
    subjects: Array<{
      subject_id: string;
      marks_obtained: number;
      max_marks: number;
      percentage: number | null;
      is_complete: boolean;
    }>;
  }>;
  summary: {
    student_count: number;
    subject_count: number;
    score_count: number;
    expected_scores: number;
    completion_percentage: number;
  };
}

export interface ClassTeacherReportCardHistoryItem {
  id: string;
  student_id: string;
  student_code: string;
  student_name: string;
  roll_no?: number | null;
  status: "draft" | "published";
  percentage: number | null;
  grade?: string | null;
  attendance_present: number;
  attendance_total: number;
  attendance_rate: number | null;
  generated_at: string;
  published_at?: string | null;
  updated_at?: string | null;
}

export interface ClassTeacherReportCardDetail {
  id: string;
  student: {
    id: string;
    student_code: string;
    first_name: string;
    last_name?: string | null;
    full_name: string;
  };
  classroom: {
    id: string;
    grade_label: string;
    section_label: string;
    classroom_code?: string | null;
  };
  exam_term: {
    id: string;
    name: string;
    term_type: string;
    starts_on?: string | null;
    ends_on?: string | null;
  };
  grading_scale: {
    id: string;
    name: string;
  };
  summary: {
    total_marks_obtained: number | null;
    total_max_marks: number | null;
    percentage: number | null;
    grade?: string | null;
    attendance_present: number;
    attendance_total: number;
    remarks?: string | null;
    status: "draft" | "published";
    generated_at: string;
    published_at?: string | null;
  };
  subjects: Array<{
    id: string;
    subject_id?: string | null;
    subject_name: string;
    marks_obtained: number;
    max_marks: number;
    percentage: number | null;
    grade?: string | null;
    comment_category?: string | null;
    teacher_comment?: string | null;
    sort_order?: number | null;
  }>;
}

export interface SetupWizardStepRecord {
  code: string;
  label: string;
  description: string;
  owner_module: string;
  auto_completed: boolean;
  manual_completed: boolean;
  is_completed: boolean;
  completed_at?: string | null;
  completed_by_user_id?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SetupWizardStatusRecord {
  steps: SetupWizardStepRecord[];
  total_steps: number;
  completed_steps: number;
  completion_percent: number;
  launch_ready: boolean;
  launched_at?: string | null;
  launched_by_user_id?: string | null;
  launched_snapshot?: unknown;
}

export interface ExecutiveOverviewRecord {
  generated_at: string;
  window: {
    date_from?: string | null;
    date_to?: string | null;
    academic_year_id?: string | null;
    classroom_id?: string | null;
    section_id?: string | null;
    trend_points?: number;
  };
  kpis: {
    attendance_present_rate: number;
    marks_avg_percentage: number;
    homework_completion_rate: number;
    fee_outstanding_total: number;
    fee_overdue_invoices: number;
  };
  attendance_trend: Array<{
    period_start: string;
    period_end?: string | null;
    present_rate: number;
    present_count?: number;
    absent_count?: number;
    late_count?: number;
  }>;
  marks_trend: Array<{
    period_start: string;
    period_end?: string | null;
    average_percentage?: number;
    avg_percentage?: number;
    score_count?: number;
  }>;
  homework_by_classroom: Array<{
    classroom_id?: string | null;
    classroom_label?: string | null;
    completion_rate: number;
    assigned_count?: number;
    submitted_count?: number;
  }>;
  fee_aging: {
    total_outstanding: number;
    overdue_amount: number;
    overdue_invoices: number;
  };
  alerts: Array<{
    key?: string;
    severity: "critical" | "warning" | "info";
    code?: string;
    label?: string;
    title?: string;
    message: string;
    value?: number | string | null;
  }>;
}

export interface FeesFinanceSummaryRecord {
  generated_at: string;
  totals: {
    total_invoices: number;
    total_due: number;
    total_paid: number;
    total_outstanding: number;
    overdue_amount: number;
    defaulter_students: number;
  };
  status_breakdown: {
    draft_count: number;
    issued_count: number;
    partial_count: number;
    paid_count: number;
    overdue_count: number;
    cancelled_count: number;
  };
}

export interface MyLinkedStudentRecord {
  id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  relation_type?: string | null;
  is_primary?: boolean;
  classroom_id?: string | null;
  grade_label?: string | null;
  section_label?: string | null;
  classroom_code?: string | null;
  class_teacher_name?: string | null;
}

export interface FamilyVisibleStudent {
  id: string;
  student_code: string;
  first_name: string;
  last_name?: string | null;
  grade_label?: string | null;
  section_label?: string | null;
  classroom_code?: string | null;
}

export interface FamilyReportCardHistoryItem {
  id: string;
  student_id: string;
  status: string;
  percentage: number | null;
  grade?: string | null;
  attendance_present?: number | null;
  attendance_total?: number | null;
  attendance_rate?: number | null;
  generated_at?: string | null;
  published_at?: string | null;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  grade_label?: string | null;
  section_label?: string | null;
  classroom_label?: string | null;
  classroom_code?: string | null;
  exam_term_id?: string | null;
  exam_term_name?: string | null;
  exam_term_type?: string | null;
}

export interface FamilyReportCardHistoryPayload {
  students: FamilyVisibleStudent[];
  items: FamilyReportCardHistoryItem[];
  summary: {
    total_cards: number;
    average_percentage: number;
    latest_published_at?: string | null;
  };
}

export interface TutorConfig {
  id?: string;
  school_id?: string;
  is_enabled: boolean;
  enabled_subjects?: string[];
  system_prompt_override?: string | null;
  difficulty_level?: "easy" | "medium" | "hard" | "adaptive";
  max_messages_per_session?: number;
  max_sessions_per_day?: number;
  allowed_roles?: string[];
  metadata?: Record<string, unknown>;
}

export interface TutorMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  token_count?: number | null;
  model?: string | null;
  latency_ms?: number | null;
  created_at: string;
}

export interface TutorSession {
  id: string;
  school_id?: string;
  student_id?: string;
  user_id?: string;
  subject_id?: string | null;
  topic?: string | null;
  status: "active" | "closed" | "expired";
  model_used?: string | null;
  subject_name?: string | null;
  message_count: number;
  total_tokens_used?: number;
  summary?: string | null;
  started_at: string;
  closed_at?: string | null;
  updated_at?: string;
}

export interface TutorSessionDetail extends TutorSession {
  messages: TutorMessage[];
}

function normalizePagination(meta?: ApiResponse["meta"]): PaginationPayload {
  return {
    page: Number(meta?.pagination?.page || meta?.page || 1),
    page_size: Number(meta?.pagination?.page_size || meta?.page_size || 25),
    total_items: Number(meta?.pagination?.total_items || meta?.total_items || 0),
    total_pages: Number(meta?.pagination?.total_pages || meta?.total_pages || 1),
  };
}

export async function getClassTeacherMyClassroom() {
  const res = await request<ClassTeacherMyClassroomPayload>("/class-teacher/my-classroom");
  return res.data;
}

export async function getClassTeacherStudents() {
  const res = await request<ClassTeacherStudentRow[]>("/class-teacher/students");
  return res.data;
}

export async function getClassTeacherSubjectTeachers() {
  const res = await request("/class-teacher/subject-teachers");
  return res.data;
}

export async function assignClassTeacherSubjectTeacher(data: {
  subject_id: string;
  teacher_user_id: string;
}) {
  const res = await request("/class-teacher/subject-teachers", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function removeClassTeacherSubjectTeacher(classroomSubjectId: string) {
  const res = await request(`/class-teacher/subject-teachers/${classroomSubjectId}`, {
    method: "DELETE",
  });
  return res.data;
}

export async function getExamTerms(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<ClassTeacherExamTerm[]>(`/exam-terms${query ? `?${query}` : ""}`);
  return {
    data: res.data,
    pagination: normalizePagination(res.meta),
  };
}

export async function createExamTerm(data: {
  name: string;
  term_type: "midterm" | "final" | "monthly";
  academic_year_id: string;
  starts_on?: string;
  ends_on?: string;
}) {
  const res = await request<ClassTeacherExamTerm>("/exam-terms", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateExamTerm(termId: string, data: {
  name?: string;
  term_type?: "midterm" | "final" | "monthly";
  starts_on?: string | null;
  ends_on?: string | null;
  is_locked?: boolean;
}) {
  const res = await request<ClassTeacherExamTerm>(`/exam-terms/${termId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function deleteExamTerm(termId: string) {
  const res = await request<{ id: string }>(`/exam-terms/${termId}`, {
    method: "DELETE",
  });
  return res.data;
}

export async function getReportCardsConsolidated(params: {
  classroom_id: string;
  exam_term_id: string;
}) {
  const query = new URLSearchParams(params).toString();
  const res = await request<ClassTeacherConsolidatedPayload>(`/report-cards/consolidated?${query}`);
  return res.data;
}

export async function getReportCardHistory(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const res = await request<{
    classroom: ClassTeacherConsolidatedPayload["classroom"];
    exam_term: ClassTeacherConsolidatedPayload["exam_term"];
    items: ClassTeacherReportCardHistoryItem[];
    kpis: {
      total_cards: number;
      published_cards: number;
      draft_cards: number;
      average_percentage: number;
      average_attendance_rate: number;
      grade_distribution: Array<{
        grade: string;
        count: number;
        percentage: number;
      }>;
    };
  }>(`/report-cards/history?${query.toString()}`);
  return {
    data: res.data,
    pagination: normalizePagination(res.meta),
  };
}

export async function getReportCard(reportCardId: string) {
  const res = await request<ClassTeacherReportCardDetail>(`/report-cards/${reportCardId}`);
  return res.data;
}

export async function bulkGenerateReportCards(data: {
  classroom_id: string;
  exam_term_id: string;
  remarks?: string;
}) {
  const res = await request<{
    generated_count: number;
    report_cards: Array<{
      id: string;
      student_id: string;
      status: string;
      percentage: number | null;
      grade?: string | null;
    }>;
  }>("/report-cards/bulk-generate", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function updateReportCardSubjectComments(
  reportCardId: string,
  data: {
    comments: Array<{
      report_card_subject_id: string;
      comment_category?: string | null;
      teacher_comment?: string | null;
    }>;
  }
) {
  const res = await request<{ id: string; updated_count: number }>(`/report-cards/${reportCardId}/subject-comments`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function downloadReportCardPdf(reportCardId: string) {
  return requestBlob(`/report-cards/${reportCardId}/pdf`);
}

export async function publishReportCard(reportCardId: string) {
  const res = await request<{ id: string; status: string; published_at?: string | null }>(
    `/report-cards/${reportCardId}/publish`,
    { method: "PATCH" }
  );
  return res.data;
}

export async function unpublishReportCard(reportCardId: string) {
  const res = await request<{ id: string; status: string; published_at?: string | null }>(
    `/report-cards/${reportCardId}/unpublish`,
    { method: "PATCH" }
  );
  return res.data;
}

export async function bulkPublishReportCards(data: { classroom_id: string; exam_term_id: string }) {
  const res = await request<{ updated_count: number }>("/report-cards/bulk-publish", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.data;
}

export async function getSetupWizardStatus() {
  const res = await request<SetupWizardStatusRecord>("/institution/setup-wizard/status");
  return res.data;
}

export async function updateSetupWizardStep(
  stepCode: string,
  data: { is_completed: boolean; notes?: string; metadata?: Record<string, unknown> }
) {
  const res = await request<{ step: unknown; status: SetupWizardStatusRecord }>(
    `/institution/setup-wizard/steps/${stepCode}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
  return res.data;
}

export async function launchSetupWizard() {
  const res = await request<{
    launched_at?: string | null;
    launched_by_user_id?: string | null;
    status: SetupWizardStatusRecord;
  }>("/institution/setup-wizard/launch", {
    method: "POST",
  });
  return res.data;
}
