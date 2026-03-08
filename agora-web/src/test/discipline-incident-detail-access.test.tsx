import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DisciplineIncidentDetailPage from "@/app/dashboard/discipline/incidents/[incidentId]/page";

const mockUseAuth = vi.fn();
const mockUseParams = vi.fn();
const mockGetDisciplineIncident = vi.fn();
const mockUpdateDisciplineIncident = vi.fn();
const mockCreateDisciplineConsequence = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = "UNKNOWN";
  },
  getDisciplineIncident: (...args: unknown[]) => mockGetDisciplineIncident(...args),
  updateDisciplineIncident: (...args: unknown[]) => mockUpdateDisciplineIncident(...args),
  createDisciplineConsequence: (...args: unknown[]) => mockCreateDisciplineConsequence(...args),
}));

function buildIncident() {
  return {
    id: "inc-1",
    student_id: "student-1",
    incident_date: "2026-03-08",
    incident_type: "minor_infraction",
    description: "Behavior incident",
    severity: "high",
    status: "reported",
    is_sensitive: false,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    student_first_name: "Zain",
    student_last_name: "Khan",
    student_code: "STU-001",
    section_name: "Middle",
    section_code: "MID",
    reported_by_first_name: "Areeba",
    reported_by_last_name: "Khan",
    consequences: [],
  };
}

describe("Discipline incident detail access", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ incidentId: "inc-1" });
    mockGetDisciplineIncident.mockReset();
    mockUpdateDisciplineIncident.mockReset();
    mockCreateDisciplineConsequence.mockReset();
  });

  test("headmistress gets review-only controls and can patch status", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-hm",
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

    mockGetDisciplineIncident.mockResolvedValue(buildIncident());
    mockUpdateDisciplineIncident.mockResolvedValue({ data: buildIncident() });

    render(<DisciplineIncidentDetailPage />);

    await waitFor(() => {
      expect(mockGetDisciplineIncident).toHaveBeenCalledWith("inc-1");
    });

    expect(screen.getByText("Manage Incident")).toBeInTheDocument();
    expect(screen.queryByText("Add Consequence")).not.toBeInTheDocument();
    expect(screen.queryByText("Pastoral Notes (Restricted)")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Resolved" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Review Status" }));

    await waitFor(() => {
      expect(mockUpdateDisciplineIncident).toHaveBeenCalledWith("inc-1", {
        status: "under_review",
      });
    });
  });
});
