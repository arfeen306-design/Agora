import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import SectionDashboardPage from "@/app/dashboard/section/page";

const mockUseAuth = vi.fn();
const mockGetSectionDashboard = vi.fn();
const mockGetDisciplineIncidents = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getSectionDashboard: (...args: unknown[]) => mockGetSectionDashboard(...args),
  getDisciplineIncidents: (...args: unknown[]) => mockGetDisciplineIncidents(...args),
}));

describe("Section dashboard access", () => {
  beforeEach(() => {
    mockGetSectionDashboard.mockReset();
    mockGetDisciplineIncidents.mockReset();
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

  test("shows headmistress-only access state for non-HM role", () => {
    render(<SectionDashboardPage />);
    expect(screen.getByText("Headmistress Access Required")).toBeInTheDocument();
    expect(mockGetSectionDashboard).not.toHaveBeenCalled();
  });

  test("shows operational empty state when headmistress has no section assignment", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-2",
        first_name: "HM",
        last_name: "One",
        email: "hm@agora.com",
        roles: ["headmistress"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    mockGetSectionDashboard.mockResolvedValue({
      data: {
        sections: [],
        selected_section_id: null,
        selected_section_detail: null,
        generated_at: "2026-03-08T00:00:00.000Z",
      },
    });

    render(<SectionDashboardPage />);

    await waitFor(() => {
      expect(mockGetSectionDashboard).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("No Section Assigned")).toBeInTheDocument();
  });
});
