import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import HrDashboardPage from "@/app/dashboard/hr/page";

const mockUseAuth = vi.fn();
const mockGetHrDashboardSummary = vi.fn();
const mockGetPeopleStaff = vi.fn();
const mockGetHrPayrollPeriods = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getHrDashboardSummary: (...args: unknown[]) => mockGetHrDashboardSummary(...args),
  getPeopleStaff: (...args: unknown[]) => mockGetPeopleStaff(...args),
  getHrPayrollPeriods: (...args: unknown[]) => mockGetHrPayrollPeriods(...args),
  ApiError: class extends Error {},
}));

describe("HR dashboard access", () => {
  beforeEach(() => {
    mockGetHrDashboardSummary.mockReset();
    mockGetPeopleStaff.mockReset();
    mockGetHrPayrollPeriods.mockReset();

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-1",
        first_name: "Teacher",
        last_name: "One",
        email: "teacher@agora.com",
        roles: ["teacher"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: true,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  test("non-HR role gets access guard", () => {
    render(<HrDashboardPage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(mockGetHrDashboardSummary).not.toHaveBeenCalled();
  });

  test("hr admin loads dashboard data", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-2",
        first_name: "HR",
        last_name: "Admin",
        email: "hr@agora.com",
        roles: ["hr_admin"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetHrDashboardSummary.mockResolvedValue({
      month: "2026-03",
      active_staff: 23,
      open_payroll_periods: 2,
      pending_adjustments: 4,
      pending_leave_requests: 3,
      current_month_net_payroll: 1500000,
    });
    mockGetPeopleStaff.mockResolvedValue({
      data: [
        {
          id: "s-1",
          user_id: "u-10",
          staff_code: "EMP-001",
          staff_type: "teacher",
          designation: "Mathematics Teacher",
          employment_status: "active",
          first_name: "Areeba",
          last_name: "Khan",
          email: "teacher1@agora.com",
          is_active: true,
          roles: ["teacher"],
        },
      ],
    });
    mockGetHrPayrollPeriods.mockResolvedValue({
      data: [
        {
          id: "p-1",
          period_label: "2026-03 Payroll",
          period_start: "2026-03-01",
          period_end: "2026-03-31",
          status: "generated",
          payroll_record_count: 21,
          net_payroll_total: 1420000,
        },
      ],
    });

    render(<HrDashboardPage />);

    await waitFor(() => {
      expect(mockGetHrDashboardSummary).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Human Resources and Payroll Command")).toBeInTheDocument();
    expect(screen.getByText("Open Payroll Runs")).toBeInTheDocument();
  });
});
