import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import Sidebar from "@/components/Sidebar";

const mockUseAuth = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

function buildUser(roles: string[]) {
  return {
    id: "user-1",
    school_id: "school-1",
    first_name: "Role",
    last_name: "Tester",
    email: "role@test.com",
    roles,
  };
}

describe("Sidebar role visibility", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseAuth.mockReturnValue({
      user: buildUser(["teacher"]),
      token: "token",
      loading: false,
      isAuthenticated: true,
      isAdmin: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
  });

  test("principal sees leadership links but not school-admin-only links", () => {
    mockUseAuth.mockReturnValue({
      user: buildUser(["principal"]),
      token: "token",
      loading: false,
      isAuthenticated: true,
      isAdmin: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<Sidebar />);

    expect(screen.getByText("Principal Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Access Control")).toBeInTheDocument();
    expect(screen.getByText("HR & Payroll")).toBeInTheDocument();
    expect(screen.queryByText("Audit Logs")).not.toBeInTheDocument();
  });

  test("front desk sees admissions links but not people-management root screen", () => {
    mockUseAuth.mockReturnValue({
      user: buildUser(["front_desk"]),
      token: "token",
      loading: false,
      isAuthenticated: true,
      isAdmin: false,
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<Sidebar />);

    expect(screen.getByText("Admissions")).toBeInTheDocument();
    expect(screen.getByText("Admission Pipeline")).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });

  test("school admin can see admin-only navigation", () => {
    mockUseAuth.mockReturnValue({
      user: buildUser(["school_admin"]),
      token: "token",
      loading: false,
      isAuthenticated: true,
      isAdmin: true,
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<Sidebar />);

    expect(screen.getByText("Audit Logs")).toBeInTheDocument();
    expect(screen.getByText("Observability")).toBeInTheDocument();
  });

  test("teacher sees self-service HR link only for own finance view", () => {
    render(<Sidebar />);
    expect(screen.getByText("My HR & Finance")).toBeInTheDocument();
    expect(screen.queryByText("HR & Payroll")).not.toBeInTheDocument();
  });
});
