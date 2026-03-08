import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DisciplineDashboardPage from "@/app/dashboard/discipline/page";

const mockUseAuth = vi.fn();
const mockGetDisciplineIncidents = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = "UNKNOWN";
  },
  getDisciplineIncidents: (...args: unknown[]) => mockGetDisciplineIncidents(...args),
}));

describe("Discipline dashboard access", () => {
  beforeEach(() => {
    mockGetDisciplineIncidents.mockReset();
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-accountant",
        first_name: "Acc",
        last_name: "One",
        email: "accountant@agora.com",
        roles: ["accountant"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  test("shows access restricted state for non-discipline roles", () => {
    render(<DisciplineDashboardPage />);

    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(mockGetDisciplineIncidents).not.toHaveBeenCalled();
  });

  test("renders incident rows for authorized role", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-teacher",
        first_name: "Teach",
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

    mockGetDisciplineIncidents.mockResolvedValue({
      data: [
        {
          id: "inc-1",
          student_id: "st-1",
          incident_date: "2026-03-08",
          incident_type: "minor_infraction",
          description: "Disruption",
          severity: "medium",
          status: "reported",
          is_sensitive: false,
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
          reported_by_user_id: "u-teacher",
          student_first_name: "Zain",
          student_last_name: "Khan",
          reported_by_first_name: "Teach",
          reported_by_last_name: "One",
          consequences_count: 0,
        },
      ],
      meta: {
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 1,
          total_pages: 1,
        },
      },
    });

    render(<DisciplineDashboardPage />);

    await waitFor(() => {
      expect(mockGetDisciplineIncidents).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/Behavior and Pastoral Oversight/i)).toBeInTheDocument();
    expect(screen.getByText(/Zain Khan/i)).toBeInTheDocument();
    expect(screen.getByText(/minor infraction/i)).toBeInTheDocument();
  });
});
