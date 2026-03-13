import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ApplicantDetailPage from "@/app/dashboard/admissions/applicants/[studentId]/page";

const mockUseAuth = vi.fn();
const mockGetAdmissionApplication = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupAcademicYears = vi.fn();
const mockGetAdmissionDocuments = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ studentId: "student-1" }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  getAdmissionApplication: (...args: unknown[]) => mockGetAdmissionApplication(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
  getAdmissionDocuments: (...args: unknown[]) => mockGetAdmissionDocuments(...args),
  updateAdmissionStage: vi.fn(),
  admitAdmissionApplicant: vi.fn(),
  issueDocumentDownloadUrl: vi.fn(),
}));

const baseDetail = {
  student: {
    student_id: "student-1",
    student_code: "STD-NEW-01",
    first_name: "Ayan",
    last_name: "Khan",
    admission_status: "under_review",
    student_status: "inactive",
    admission_date: null,
    created_at: "2026-03-13T00:00:00.000Z",
  },
  application: {
    application_id: "app-1",
    guardian_name: "Parent Khan",
    guardian_phone: "+920001234567",
    guardian_email: "parent@example.com",
    inquiry_source: "walk_in",
    desired_grade_label: "Grade 7",
    desired_section_label: "A",
    desired_classroom_id: null,
    desired_academic_year_id: null,
    notes: null,
    stage_notes: null,
    current_status: "under_review",
  },
  enrollment: null,
  history: [],
};

describe("Admissions applicant detail role visibility", () => {
  beforeEach(() => {
    mockGetAdmissionApplication.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetLookupAcademicYears.mockReset();
    mockGetAdmissionDocuments.mockReset();
    mockGetAdmissionApplication.mockResolvedValue(baseDetail);
    mockGetLookupClassrooms.mockResolvedValue([]);
    mockGetLookupAcademicYears.mockResolvedValue([]);
    mockGetAdmissionDocuments.mockResolvedValue({ data: [] });
  });

  test("front desk sees leadership warning instead of approval options at under review stage", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "frontdesk-1",
        roles: ["front_desk"],
      },
    });

    render(<ApplicantDetailPage />);

    await waitFor(() => {
      expect(mockGetAdmissionApplication).toHaveBeenCalledWith("student-1");
    });

    expect(screen.getByText(/needs approval from school leadership/i)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /accepted/i })).not.toBeInTheDocument();
  });

  test("school admin still sees approval stage choices", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "admin-1",
        roles: ["school_admin"],
      },
    });

    render(<ApplicantDetailPage />);

    await waitFor(() => {
      expect(mockGetAdmissionApplication).toHaveBeenCalledWith("student-1");
    });

    expect(screen.getByRole("option", { name: /accepted/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /waitlisted/i })).toBeInTheDocument();
  });
});
