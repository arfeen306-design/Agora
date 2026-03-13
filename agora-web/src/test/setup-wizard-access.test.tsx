import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import SetupWizardPage from "@/app/dashboard/setup-wizard/page";

const mockUseAuth = vi.fn();
const mockGetSetupWizardStatus = vi.fn();
const mockUpdateSetupWizardStep = vi.fn();
const mockLaunchSetupWizard = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  getSetupWizardStatus: (...args: unknown[]) => mockGetSetupWizardStatus(...args),
  updateSetupWizardStep: (...args: unknown[]) => mockUpdateSetupWizardStep(...args),
  launchSetupWizard: (...args: unknown[]) => mockLaunchSetupWizard(...args),
}));

function buildStatus() {
  return {
    steps: [
      {
        code: "school_profile",
        label: "School Profile",
        description: "Set school profile",
        owner_module: "institution",
        auto_completed: true,
        manual_completed: false,
        is_completed: true,
      },
      {
        code: "academic_year",
        label: "Academic Year",
        description: "Set current academic year",
        owner_module: "institution",
        auto_completed: false,
        manual_completed: false,
        is_completed: false,
      },
    ],
    total_steps: 2,
    completed_steps: 1,
    completion_percent: 50,
    launch_ready: false,
    launched_at: null,
    launched_by_user_id: null,
    launched_snapshot: null,
  };
}

describe("Setup wizard page access", () => {
  beforeEach(() => {
    mockGetSetupWizardStatus.mockReset();
    mockUpdateSetupWizardStep.mockReset();
    mockLaunchSetupWizard.mockReset();
  });

  test("blocks student role from setup wizard", () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-student",
        first_name: "Student",
        last_name: "User",
        email: "student@agora.com",
        roles: ["student"],
      },
    });

    render(<SetupWizardPage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.getByText(/first-time setup wizard/i)).toBeInTheDocument();
  });

  test("principal can view setup wizard steps", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Principal",
        last_name: "User",
        email: "principal@agora.com",
        roles: ["principal"],
      },
    });
    mockGetSetupWizardStatus.mockResolvedValue(buildStatus());

    render(<SetupWizardPage />);

    await waitFor(() => {
      expect(mockGetSetupWizardStatus).toHaveBeenCalled();
    });

    expect(screen.getByText("School Launch Readiness Wizard")).toBeInTheDocument();
    expect(screen.getByText("School Profile")).toBeInTheDocument();
    expect(screen.getByText("Academic Year")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch School" })).toBeDisabled();
  });

  test("front desk gets read-only setup wizard access", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-frontdesk",
        first_name: "Front",
        last_name: "Desk",
        email: "frontdesk@agora.com",
        roles: ["front_desk"],
      },
    });
    mockGetSetupWizardStatus.mockResolvedValue(buildStatus());

    render(<SetupWizardPage />);

    await waitFor(() => {
      expect(mockGetSetupWizardStatus).toHaveBeenCalled();
    });

    expect(screen.queryByRole("button", { name: "Mark Complete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch School" })).toBeDisabled();
  });
});
