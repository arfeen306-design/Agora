export type AlertSeverity = "danger" | "warning" | "info" | "success";

export interface PrincipalAlert {
  id: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  href?: string;
  actionLabel?: string;
}

export interface PrincipalKpiCard {
  label: string;
  value: string;
  subtext?: string;
  tone: "primary" | "success" | "warning" | "danger";
}

export interface SectionHealthRow {
  sectionId: string;
  sectionName: string;
  sectionCode: string;
  totalRecords: number;
  attendanceRate: number;
  lateCount: number;
  absentCount: number;
  homeworkCompletionRate: number | null;
  missingHomework: number;
}

export interface FinanceSummaryCardData {
  totalInvoices: number;
  paidCount: number;
  overdueCount: number;
  amountDueTotal: number;
  amountPaidTotal: number;
  outstandingTotal: number;
  overdueTotal: number;
}

export interface PrincipalEventItem {
  id: string;
  title: string;
  eventType?: string;
  startsAt: string;
  targetScope?: string;
}

export interface PendingItem {
  id: string;
  label: string;
  value: string;
  tone: "primary" | "warning" | "danger";
  href?: string;
}
