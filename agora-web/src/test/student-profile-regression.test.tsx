import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import StudentProfilePage from "@/app/dashboard/students/[studentId]/profile/page";

const mockUseAuth = vi.fn();
const mockUseParams = vi.fn();

const mockGetPeopleStudent = vi.fn();
const mockGetPeopleStudentAcademicSummary = vi.fn();
const mockGetPeopleStudentTimeline = vi.fn();
const mockGetStudentMarksSummary = vi.fn();
const mockGetFeeInvoices = vi.fn();
const mockGetStudentDisciplineSummary = vi.fn();

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
  getPeopleStudent: (...args: unknown[]) => mockGetPeopleStudent(...args),
  getPeopleStudentAcademicSummary: (...args: unknown[]) => mockGetPeopleStudentAcademicSummary(...args),
  getPeopleStudentTimeline: (...args: unknown[]) => mockGetPeopleStudentTimeline(...args),
  getStudentMarksSummary: (...args: unknown[]) => mockGetStudentMarksSummary(...args),
  getFeeInvoices: (...args: unknown[]) => mockGetFeeInvoices(...args),
  getStudentDisciplineSummary: (...args: unknown[]) => mockGetStudentDisciplineSummary(...args),
}));

function buildStudentProfile() {
  return {
    student: {
      id: "student-1",
      student_code: "STU-001",
      first_name: "Zain",
      last_name: "Khan",
      date_of_birth: "2014-02-01",
      gender: "male",
      admission_date: "2025-04-01",
      admission_status: "admitted",
      status: "active",
      transport_info: null,
      notes: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      medical_alert: null,
    },
    enrollment: {
      classroom_id: "class-1",
      academic_year_id: "year-1",
      roll_no: 7,
      joined_on: "2025-04-01",
      classroom: {
        grade_label: "Grade 7",
        section_label: "A",
        classroom_code: "G7-A",
        display_name: "Grade 7 - A",
      },
      section: {
        id: "section-1",
        name: "Middle",
        code: "MID",
      },
      academic_year_name: "2025-2026",
    },
    parents: [],
  };
}

describe("Student profile regression coverage", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ studentId: "student-1" });
    mockGetPeopleStudent.mockReset();
    mockGetPeopleStudentAcademicSummary.mockReset();
    mockGetPeopleStudentTimeline.mockReset();
    mockGetStudentMarksSummary.mockReset();
    mockGetFeeInvoices.mockReset();
    mockGetStudentDisciplineSummary.mockReset();
  });

  test("shows access restricted state for role without student profile access", async () => {
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

    render(<StudentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    });
  });

  test("renders discipline summary and keeps honest documents placeholder", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-admin",
        first_name: "Admin",
        last_name: "User",
        email: "admin@agora.com",
        roles: ["school_admin"],
      },
      loading: false,
      isAdmin: true,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetPeopleStudent.mockResolvedValue(buildStudentProfile());
    mockGetPeopleStudentAcademicSummary.mockResolvedValue({
      student_id: "student-1",
      attendance_summary: {
        total_days: 30,
        present: 28,
        absent: 1,
        late: 1,
        leave: 0,
        rate: 93.33,
      },
      homework_summary: {
        total_assigned: 20,
        submitted: 18,
        completion_rate: 90,
      },
      marks_summary: {
        score_count: 12,
        assessment_count: 4,
        average_percentage: 84.5,
      },
      fee_summary: {
        total_due: 1000,
        total_paid: 700,
        outstanding: 300,
        overdue_count: 1,
      },
      generated_at: "2026-03-08T00:00:00.000Z",
    });
    mockGetPeopleStudentTimeline.mockResolvedValue({
      student_id: "student-1",
      events: [],
    });
    mockGetStudentMarksSummary.mockResolvedValue({
      data: {
        overall_average: 84.5,
        subject_averages: [],
        trend: [],
      },
    });
    mockGetFeeInvoices.mockResolvedValue({ data: [] });
    mockGetStudentDisciplineSummary.mockResolvedValue({
      student_id: "student-1",
      total_incidents: 2,
      open_incidents: 1,
      escalated_incidents: 0,
      resolved_incidents: 1,
      by_severity: {
        low: 0,
        medium: 1,
        high: 1,
        critical: 0,
      },
      consequence_count: 1,
      incidents: [
        {
          id: "inc-1",
          student_id: "student-1",
          incident_date: "2026-03-02",
          incident_type: "minor_infraction",
          description: "Disruptive behavior",
          severity: "medium",
          status: "under_review",
          is_sensitive: false,
          created_at: "2026-03-02T09:00:00.000Z",
          updated_at: "2026-03-02T09:00:00.000Z",
          consequences: [],
        },
      ],
    });

    render(<StudentProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("Zain Khan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Discipline" }));
    expect(
      screen.getByText(/Incident History/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Total Incidents/i)).toBeInTheDocument();
    expect(screen.getByText(/minor infraction/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(
      screen.getByText(/Student documents, certificates, and report cards will appear here in the upcoming document module/i)
    ).toBeInTheDocument();
  });
});
