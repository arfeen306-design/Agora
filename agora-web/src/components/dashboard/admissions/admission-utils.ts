import type { AdmissionStatus } from "@/lib/api";

export const ADMISSION_STAGE_ORDER: AdmissionStatus[] = [
  "inquiry",
  "applied",
  "under_review",
  "test_scheduled",
  "accepted",
  "waitlisted",
  "rejected",
  "admitted",
];

export const ADMISSION_STAGE_LABEL: Record<AdmissionStatus, string> = {
  inquiry: "Inquiry",
  applied: "Applied",
  under_review: "Under Review",
  test_scheduled: "Test Scheduled",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  admitted: "Admitted",
};

export const ADMISSION_STAGE_STYLE: Record<AdmissionStatus, string> = {
  inquiry: "bg-sky-100 text-sky-700 border-sky-200",
  applied: "bg-indigo-100 text-indigo-700 border-indigo-200",
  under_review: "bg-amber-100 text-amber-700 border-amber-200",
  test_scheduled: "bg-purple-100 text-purple-700 border-purple-200",
  accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  waitlisted: "bg-yellow-100 text-yellow-800 border-yellow-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  admitted: "bg-green-100 text-green-700 border-green-200",
};

export function admissionStatusLabel(status: AdmissionStatus | string) {
  return ADMISSION_STAGE_LABEL[status as AdmissionStatus] || status.replace(/_/g, " ");
}

export function admissionStatusClass(status: AdmissionStatus | string) {
  return ADMISSION_STAGE_STYLE[status as AdmissionStatus] || "bg-gray-100 text-gray-700 border-gray-200";
}

export function percentage(value: number, total: number) {
  if (!total) return 0;
  return (value / total) * 100;
}
