import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DashboardPage from "@/app/dashboard/page";

const mockUseAuth = vi.fn();
const mockReplace = vi.fn();
const mockGetAttendance = vi.fn();
const mockGetHomework = vi.fn();
const mockGetEvents = vi.fn();
const mockGetNotifications = vi.fn();
const mockGetPeopleMyStudents = vi.fn();
const mockGetPeopleStudentAcademicSummary = vi.fn();
const mockGetPeopleStudentTimeline = vi.fn();
const mockGetStudentMarksSummary = vi.fn();
const mockGetMyReportCardHistory = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

vi.mock("@/lib/api", () => ({
  getAttendance: (...args: unknown[]) => mockGetAttendance(...args),
  getHomework: (...args: unknown[]) => mockGetHomework(...args),
  getEvents: (...args: unknown[]) => mockGetEvents(...args),
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  getPeopleMyStudents: (...args: unknown[]) => mockGetPeopleMyStudents(...args),
  getPeopleStudentAcademicSummary: (...args: unknown[]) => mockGetPeopleStudentAcademicSummary(...args),
  getPeopleStudentTimeline: (...args: unknown[]) => mockGetPeopleStudentTimeline(...args),
  getStudentMarksSummary: (...args: unknown[]) => mockGetStudentMarksSummary(...args),
  getMyReportCardHistory: (...args: unknown[]) => mockGetMyReportCardHistory(...args),
}));

vi.mock("@/components/dashboard/admin/AdminCommandCenter", () => ({
  default: ({ firstName }: { firstName?: string }) => <div>Welcome back, {firstName || "Admin"}!</div>,
}));

describe("Role-aware dashboard routing", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockGetAttendance.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetHomework.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetEvents.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetNotifications.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetPeopleMyStudents.mockResolvedValue([]);
    mockGetPeopleStudentAcademicSummary.mockResolvedValue(null);
    mockGetPeopleStudentTimeline.mockResolvedValue({ events: [] });
    mockGetStudentMarksSummary.mockResolvedValue({ data: { trend: [], overall_average: 0 } });
    mockGetMyReportCardHistory.mockResolvedValue({
      data: { items: [], summary: { total_cards: 0, average_percentage: 0, latest_published_at: null } },
    });
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
    expect(screen.getByText("Opening your role dashboard...")).toBeInTheDocument();
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
    expect(screen.getByText("Opening your role dashboard...")).toBeInTheDocument();
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
    expect(screen.getByText("Opening your role dashboard...")).toBeInTheDocument();
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
    expect(screen.getByText("Opening your role dashboard...")).toBeInTheDocument();
  });

  test("hr admin users are redirected to hr dashboard", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "HR",
        last_name: "Admin",
        roles: ["hr_admin"],
      },
      isAdmin: false,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard/hr");
    });
    expect(screen.getByText("Opening your role dashboard...")).toBeInTheDocument();
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

  test("parent dashboard shows status-style actions instead of teacher actions", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Parent",
        last_name: "User",
        roles: ["parent"],
      },
      isAdmin: false,
    });
    mockGetPeopleMyStudents.mockResolvedValue([
      {
        id: "student-1",
        student_code: "STU-001",
        first_name: "Ali",
        last_name: "Khan",
        full_name: "Ali Khan",
        relation_type: "father",
        is_primary: true,
        classroom: null,
      },
    ]);
    mockGetPeopleStudentAcademicSummary.mockResolvedValue({
      student_id: "student-1",
      attendance_summary: { total_days: 1, present: 1, absent: 0, late: 0, leave: 0, rate: 100 },
      homework_summary: { total_assigned: 2, submitted: 1, completion_rate: 50 },
      marks_summary: { score_count: 0, assessment_count: 0, average_percentage: 0 },
      generated_at: new Date().toISOString(),
    });
    mockGetPeopleStudentTimeline.mockResolvedValue({ student_id: "student-1", events: [] });
    mockGetStudentMarksSummary.mockResolvedValue({ data: { overall_average: 0, trend: [], subject_averages: [] } });
    mockGetAttendance.mockResolvedValue({ data: [{ status: "present" }], meta: { pagination: { total_items: 1 } } });
    mockGetEvents.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetNotifications.mockResolvedValue({ data: [], meta: { pagination: { total_items: 0 } } });
    mockGetMyReportCardHistory.mockResolvedValue({
      data: {
        items: [
          {
            id: "rc-1",
            student_id: "student-1",
            student_code: "STU-001",
            student_name: "Ali Khan",
            classroom_label: "Grade 9-A",
            classroom_code: "9A",
            exam_term: { id: "term-1", name: "Monthly Test", term_type: "monthly" },
            percentage: 88.5,
            grade: "A",
            attendance_present: 18,
            attendance_total: 20,
            attendance_rate: 90,
            generated_at: "2026-03-01T00:00:00Z",
            published_at: "2026-03-02T00:00:00Z",
            status: "published",
          },
        ],
        summary: { total_cards: 1, average_percentage: 88.5, latest_published_at: "2026-03-02T00:00:00Z" },
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("View Attendance")).toBeInTheDocument();
    });
    expect(screen.getByText("View Homework")).toBeInTheDocument();
    expect(screen.getByText("Progress Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Activity Timeline")).toBeInTheDocument();
    expect(screen.getByText("Report Card History")).toBeInTheDocument();
    expect(screen.getByText("Read-Only Family Shortcuts")).toBeInTheDocument();
    expect(screen.queryByText("Mark Attendance")).not.toBeInTheDocument();
    expect(screen.queryByText("Add Homework")).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
