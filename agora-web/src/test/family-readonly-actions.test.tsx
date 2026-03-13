import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import AttendancePage from "@/app/dashboard/attendance/page";
import HomeworkPage from "@/app/dashboard/homework/page";
import MarksPage from "@/app/dashboard/marks/page";

const mockUseAuth = vi.fn();
const mockGetAttendance = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupStudents = vi.fn();
const mockMarkAttendanceBulk = vi.fn();
const mockGetHomework = vi.fn();
const mockCreateHomework = vi.fn();
const mockGetLookupSubjects = vi.fn();
const mockGetAssessments = vi.fn();
const mockCreateAssessment = vi.fn();
const mockBulkScores = vi.fn();
const mockGetPeopleMyStudents = vi.fn();
const mockGetMyReportCardHistory = vi.fn();
const mockDownloadReportCardPdf = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getAttendance: (...args: unknown[]) => mockGetAttendance(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getLookupStudents: (...args: unknown[]) => mockGetLookupStudents(...args),
  markAttendanceBulk: (...args: unknown[]) => mockMarkAttendanceBulk(...args),
  getHomework: (...args: unknown[]) => mockGetHomework(...args),
  createHomework: (...args: unknown[]) => mockCreateHomework(...args),
  getLookupSubjects: (...args: unknown[]) => mockGetLookupSubjects(...args),
  getAssessments: (...args: unknown[]) => mockGetAssessments(...args),
  createAssessment: (...args: unknown[]) => mockCreateAssessment(...args),
  bulkScores: (...args: unknown[]) => mockBulkScores(...args),
  getPeopleMyStudents: (...args: unknown[]) => mockGetPeopleMyStudents(...args),
  getMyReportCardHistory: (...args: unknown[]) => mockGetMyReportCardHistory(...args),
  downloadReportCardPdf: (...args: unknown[]) => mockDownloadReportCardPdf(...args),
}));

describe("Family read-only actions", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Family",
        last_name: "Viewer",
        roles: ["parent", "teacher"],
      },
      token: "token",
      loading: false,
      isAuthenticated: true,
      isAdmin: false,
    });

    mockGetAttendance.mockResolvedValue({ data: [], meta: { pagination: { total_pages: 1 } } });
    mockGetLookupClassrooms.mockResolvedValue([]);
    mockGetLookupStudents.mockResolvedValue([]);
    mockMarkAttendanceBulk.mockResolvedValue({ success: true });
    mockGetHomework.mockResolvedValue({ data: [], meta: { pagination: { total_pages: 1 } } });
    mockCreateHomework.mockResolvedValue({ success: true });
    mockGetLookupSubjects.mockResolvedValue([]);
    mockGetAssessments.mockResolvedValue({ data: [], meta: { pagination: { total_pages: 1 } } });
    mockCreateAssessment.mockResolvedValue({ success: true });
    mockBulkScores.mockResolvedValue({ success: true });
    mockGetPeopleMyStudents.mockResolvedValue([
      {
        id: "student-1",
        student_code: "STU-001",
        first_name: "Ali",
        last_name: "Khan",
        full_name: "Ali Khan",
        relation_type: "father",
        is_primary: true,
        classroom: {
          classroom_id: "class-1",
          grade_label: "Grade 9",
          section_label: "A",
          classroom_code: "9A",
          display_name: "Grade 9 - A",
          class_teacher_name: "Areeba Khan",
        },
      },
    ]);
    mockGetMyReportCardHistory.mockResolvedValue({
      data: {
        students: [{ id: "student-1", student_code: "STU-001", full_name: "Ali Khan" }],
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
        summary: {
          total_cards: 1,
          average_percentage: 88.5,
          latest_published_at: "2026-03-02T00:00:00Z",
        },
      },
      pagination: { page: 1, page_size: 6, total_items: 1, total_pages: 1 },
    });
    mockDownloadReportCardPdf.mockResolvedValue(new Blob(["pdf"]));
  });

  test("attendance page does not expose mark action for family users", async () => {
    render(<AttendancePage />);
    await waitFor(() => {
      expect(screen.queryByText("Mark Attendance")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /child attendance view/i })).toBeInTheDocument();
    expect(screen.getByText(/read-only child attendance view/i)).toBeInTheDocument();
  });

  test("homework page does not expose create action for family users", async () => {
    render(<HomeworkPage />);
    await waitFor(() => {
      expect(screen.queryByText("Create Homework")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/child homework feed/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only child homework view/i)).toBeInTheDocument();
  });

  test("marks page does not expose create action for family users", async () => {
    render(<MarksPage />);
    await waitFor(() => {
      expect(screen.queryByText("Create Assessment")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/child assessment feed/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only child marks and test history view/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /published report cards/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /view details/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /download report card/i })).toBeInTheDocument();
    });
  });
});
