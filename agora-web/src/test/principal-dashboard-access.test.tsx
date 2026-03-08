import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import PrincipalDashboardPage from "@/app/dashboard/principal/page";

const mockUseAuth = vi.fn();
const mockGetPrincipalDashboard = vi.fn();
const mockGetFeesSummary = vi.fn();
const mockGetEvents = vi.fn();
const mockGetNotifications = vi.fn();
const mockGetDisciplineIncidents = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getPrincipalDashboard: (...args: unknown[]) => mockGetPrincipalDashboard(...args),
  getFeesSummary: (...args: unknown[]) => mockGetFeesSummary(...args),
  getEvents: (...args: unknown[]) => mockGetEvents(...args),
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  getDisciplineIncidents: (...args: unknown[]) => mockGetDisciplineIncidents(...args),
}));

describe("Principal dashboard access", () => {
  beforeEach(() => {
    mockGetPrincipalDashboard.mockReset();
    mockGetFeesSummary.mockReset();
    mockGetEvents.mockReset();
    mockGetNotifications.mockReset();
    mockGetDisciplineIncidents.mockReset();

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-1",
        first_name: "Role",
        last_name: "Tester",
        email: "role@test.com",
        roles: ["teacher"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: true,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  test("shows access guard for non-leadership role", () => {
    render(<PrincipalDashboardPage />);
    expect(screen.getByText("Leadership Access Required")).toBeInTheDocument();
    expect(mockGetPrincipalDashboard).not.toHaveBeenCalled();
  });

  test("loads dashboard for principal role", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-2",
        first_name: "Areeba",
        last_name: "Khan",
        email: "principal@agora.com",
        roles: ["principal"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetPrincipalDashboard.mockResolvedValue({
      data: {
        attendance_today: {
          total: 120,
          present_count: 108,
          late_count: 7,
          absent_count: 5,
          leave_count: 0,
        },
        section_attendance: [],
        homework_completion_by_section: [],
        marks_upload_status: {
          assessment_count: 4,
          score_count: 72,
          contributing_teachers: 9,
        },
        finance_and_alerts: {
          defaulter_invoices: 3,
          upcoming_events: 2,
          active_delegations: 1,
        },
        generated_at: "2026-03-08T00:00:00.000Z",
      },
    });
    mockGetFeesSummary.mockResolvedValue({
      data: {
        total_invoices: 20,
        paid_count: 10,
        overdue_count: 4,
        amount_due_total: 1000,
        amount_paid_total: 600,
        outstanding_total: 400,
        overdue_total: 120,
      },
    });
    mockGetEvents.mockResolvedValue({ data: [] });
    mockGetNotifications.mockResolvedValue({ data: [] });
    mockGetDisciplineIncidents.mockResolvedValue({ data: [] });

    render(<PrincipalDashboardPage />);

    await waitFor(() => {
      expect(mockGetPrincipalDashboard).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Welcome back, Areeba/i)).toBeInTheDocument();
  });
});
