import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AdmissionsDashboardPage from "@/app/dashboard/admissions/page";
import AdmissionPipelinePage from "@/app/dashboard/admissions/pipeline/page";
import NewApplicantPage from "@/app/dashboard/admissions/applicants/new/page";

const mockUseAuth = vi.fn();
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();
const mockClipboardWriteText = vi.fn();

const mockGetAdmissionsPipeline = vi.fn();
const mockGetAdmissionApplications = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupAcademicYears = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/dashboard/admissions/pipeline",
  useSearchParams: () => mockSearchParams,
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
    localStorage.clear();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));
    mockGetAdmissionsPipeline.mockReset();
    mockGetAdmissionApplications.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetLookupAcademicYears.mockReset();
    mockClipboardWriteText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
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

  test("restores saved admissions view and syncs URL filters", async () => {
    localStorage.setItem(
      "agora_web_admissions_pipeline_saved_view_v1",
      "search=Ali&academic_year_id=ay-1"
    );

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-front-desk",
        first_name: "Front",
        last_name: "Desk",
        email: "frontdesk@agora.com",
        roles: ["front_desk"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetAdmissionsPipeline.mockResolvedValue({ data: { stages: {} } });
    mockGetAdmissionApplications.mockResolvedValue({ data: [] });
    mockGetLookupAcademicYears.mockResolvedValue([{ id: "ay-1", name: "2025-26", label: "2025-26" }]);

    render(<AdmissionPipelinePage />);

    await waitFor(() => {
      expect(mockGetAdmissionsPipeline).toHaveBeenCalledTimes(1);
    });

    const searchInput = screen.getByLabelText("Search Applicant") as HTMLInputElement;
    const academicYear = screen.getByLabelText("Academic Year") as HTMLSelectElement;
    expect(searchInput.value).toBe("Ali");
    expect(academicYear.value).toBe("ay-1");

    fireEvent.change(screen.getByLabelText("Date From"), { target: { value: "2026-03-01" } });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
      const lastPath = String(mockReplace.mock.calls.at(-1)?.[0] || "");
      expect(lastPath).toContain("search=Ali");
      expect(lastPath).toContain("date_from=2026-03-01");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save this view" }));
    const savedViewsRaw = localStorage.getItem("agora_web_admissions_pipeline_saved_views_v1") || "[]";
    expect(savedViewsRaw).toContain("date_from=2026-03-01");
    expect(localStorage.getItem("agora_web_admissions_pipeline_saved_view_v1")).toContain("date_from=2026-03-01");

    mockReplace.mockClear();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);
    });
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("date_from=2026-03-01"), {
      scroll: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy current link" }));
    expect(mockClipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/admissions/pipeline")
    );
  });
});
