import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import AdminCommandCenter from "@/components/dashboard/admin/AdminCommandCenter";

const mockGetInstitutionProfile = vi.fn();
const mockGetInstitutionSections = vi.fn();
const mockGetPrincipalDashboard = vi.fn();
const mockGetExecutiveOverview = vi.fn();
const mockGetAdmissionsPipeline = vi.fn();
const mockGetHrDashboardSummary = vi.fn();
const mockGetFeesFinanceSummary = vi.fn();
const mockGetEvents = vi.fn();
const mockGetNotifications = vi.fn();
const mockGetLookupAcademicYears = vi.fn();

vi.mock("@/lib/api", () => ({
  getInstitutionProfile: (...args: unknown[]) => mockGetInstitutionProfile(...args),
  getInstitutionSections: (...args: unknown[]) => mockGetInstitutionSections(...args),
  getPrincipalDashboard: (...args: unknown[]) => mockGetPrincipalDashboard(...args),
  getExecutiveOverview: (...args: unknown[]) => mockGetExecutiveOverview(...args),
  getAdmissionsPipeline: (...args: unknown[]) => mockGetAdmissionsPipeline(...args),
  getHrDashboardSummary: (...args: unknown[]) => mockGetHrDashboardSummary(...args),
  getFeesFinanceSummary: (...args: unknown[]) => mockGetFeesFinanceSummary(...args),
  getEvents: (...args: unknown[]) => mockGetEvents(...args),
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
}));

describe("Admin command center", () => {
  test("renders school-wide summary cards and pipeline panel", async () => {
    mockGetLookupAcademicYears.mockResolvedValue([
      {
        id: "ay-current",
        name: "2025-2026",
        is_current: true,
        label: "2025-2026 (Current)",
      },
    ]);
    mockGetInstitutionProfile.mockResolvedValue({
      id: "school-1",
      name: "Agora School",
      branch_name: "Main",
      active_students: 420,
      active_staff: 52,
      principal_first_name: "Areeba",
      principal_last_name: "Khan",
    });
    mockGetInstitutionSections.mockResolvedValue({
      data: [
        {
          id: "sec-1",
          name: "Middle",
          code: "MID",
          active_students: 180,
          head_user_id: "head-1",
          head_first_name: "Sara",
          head_last_name: "Noor",
        },
      ],
    });
    mockGetPrincipalDashboard.mockResolvedValue({
      data: {
        attendance_today: {
          total: 400,
          present_count: 360,
          late_count: 20,
          absent_count: 20,
          leave_count: 0,
        },
      },
    });
    mockGetExecutiveOverview.mockResolvedValue({
      data: {
        attendance_trend: [{ period_start: "2026-03-01", present_rate: 88 }],
        alerts: [],
      },
    });
    mockGetAdmissionsPipeline.mockResolvedValue({
      data: {
        stages: { inquiry: { count: 9, students: [] }, under_review: { count: 3, students: [] } },
        summary: { total: 12, total_active: 10, admitted_count: 1, rejected_count: 1, conversion_rate: 0.5 },
      },
    });
    mockGetHrDashboardSummary.mockResolvedValue({
      month: "2026-03",
      active_staff: 52,
      open_payroll_periods: 1,
      pending_adjustments: 2,
      pending_leave_requests: 1,
      current_month_net_payroll: 1500000,
      staff_attendance_today: {
        total_active_staff: 52,
        marked_staff: 49,
        unmarked_staff: 3,
        present_count: 43,
        late_count: 3,
        absent_count: 2,
        leave_count: 1,
      },
    });
    mockGetFeesFinanceSummary.mockResolvedValue({
      data: {
        totals: {
          total_invoices: 200,
          total_due: 3000000,
          total_paid: 2450000,
          total_outstanding: 550000,
          overdue_amount: 175000,
          defaulter_students: 28,
        },
      },
    });
    mockGetEvents.mockResolvedValue({ data: [] });
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<AdminCommandCenter firstName="Admin" />);

    await waitFor(() => {
      expect(screen.getByText("Admin Command Center")).toBeInTheDocument();
    });
    expect(screen.getByText("Welcome back, Admin!")).toBeInTheDocument();
    expect(screen.getByText("Admissions Progress")).toBeInTheDocument();
    expect(screen.getByText("Section Enrollment Load")).toBeInTheDocument();
    expect(screen.getByText("Operations Queue")).toBeInTheDocument();
    expect(screen.getByText("Quick Admin Actions")).toBeInTheDocument();
    expect(mockGetLookupAcademicYears).toHaveBeenCalledWith({ page_size: 50 });
    expect(mockGetExecutiveOverview).toHaveBeenCalled();
    expect(mockGetAdmissionsPipeline).toHaveBeenCalled();
  });
});
