import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AdmissionsDashboardPage from "@/app/dashboard/admissions/page";
import AdmissionPipelinePage from "@/app/dashboard/admissions/pipeline/page";
import NewApplicantPage from "@/app/dashboard/admissions/applicants/new/page";

const mockUseAuth = vi.fn();
const mockPush = vi.fn();

const mockGetAdmissionsPipeline = vi.fn();
const mockGetAdmissionApplications = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupAcademicYears = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = "UNKNOWN";
  },
  getAdmissionsPipeline: (...args: unknown[]) => mockGetAdmissionsPipeline(...args),
  getAdmissionApplications: (...args: unknown[]) => mockGetAdmissionApplications(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
  createAdmissionInquiry: vi.fn(),
}));

describe("Admissions core flow access", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAdmissionsPipeline.mockReset();
    mockGetAdmissionApplications.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetLookupAcademicYears.mockReset();
  });

  test("teacher role cannot access admissions dashboard or pipeline", () => {
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

    render(<AdmissionsDashboardPage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();

    render(<AdmissionPipelinePage />);
    expect(screen.getByText(/do not have permission to view the admission pipeline/i)).toBeInTheDocument();
  });

  test("principal can view new applicant page but cannot create", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Pri",
        last_name: "Ncipal",
        email: "principal@agora.com",
        roles: ["principal"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetLookupClassrooms.mockResolvedValue([]);
    mockGetLookupAcademicYears.mockResolvedValue([]);

    render(<NewApplicantPage />);

    await waitFor(() => {
      expect(mockGetLookupClassrooms).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(/Your role can view admissions but cannot create new inquiries/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Inquiry" })).toBeDisabled();
  });
});

