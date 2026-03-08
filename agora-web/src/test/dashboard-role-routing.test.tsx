import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DashboardPage from "@/app/dashboard/page";

const mockUseAuth = vi.fn();
const mockReplace = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

vi.mock("@/lib/api", () => ({
  getAttendance: vi.fn(),
  getHomework: vi.fn(),
  getEvents: vi.fn(),
  getNotifications: vi.fn(),
}));

describe("Role-aware dashboard routing", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  test("principal users are redirected to principal dashboard", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Pri",
        last_name: "Ncipal",
        roles: ["principal"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/principal");
    });
    expect(screen.getByText("Opening Principal Dashboard...")).toBeInTheDocument();
  });

  test("vice principal users are redirected to principal dashboard", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Vice",
        last_name: "Principal",
        roles: ["vice_principal"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/principal");
    });
    expect(screen.getByText("Opening Principal Dashboard...")).toBeInTheDocument();
  });

  test("headmistress users are redirected to section dashboard", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Head",
        last_name: "Mistress",
        roles: ["headmistress"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/section");
    });
    expect(screen.getByText("Opening Section Dashboard...")).toBeInTheDocument();
  });

  test("front desk users are redirected to admissions dashboard", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Front",
        last_name: "Desk",
        roles: ["front_desk"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/admissions");
    });
    expect(screen.getByText("Opening Admissions Dashboard...")).toBeInTheDocument();
  });

  test("school admin stays on default dashboard shell", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Admin",
        last_name: "User",
        roles: ["school_admin"],
      },
      isAdmin: true,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Welcome back, Admin!")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("teacher stays on default classroom dashboard shell", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Teacher",
        last_name: "User",
        roles: ["teacher"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Welcome back, Teacher!")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
