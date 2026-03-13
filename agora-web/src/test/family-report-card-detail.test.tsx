import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import FamilyReportCardDetailPage from "@/app/dashboard/marks/report-cards/[reportCardId]/page";

const mockUseAuth = vi.fn();
const mockGetReportCard = vi.fn();
const mockDownloadReportCardPdf = vi.fn();
const mockGetMyReportCardHistory = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ reportCardId: "rc-1" }),
}));

vi.mock("@/lib/api", () => ({
  getReportCard: (...args: unknown[]) => mockGetReportCard(...args),
  downloadReportCardPdf: (...args: unknown[]) => mockDownloadReportCardPdf(...args),
  getMyReportCardHistory: (...args: unknown[]) => mockGetMyReportCardHistory(...args),
}));

describe("Family report card detail", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Parent",
        last_name: "User",
        roles: ["parent"],
      },
    });

    mockGetReportCard.mockImplementation(async (reportCardId: string) => {
      if (reportCardId === "rc-older") {
        return {
          id: "rc-older",
          student: {
            id: "student-1",
            student_code: "STU-001",
            first_name: "Ali",
            last_name: "Khan",
            full_name: "Ali Khan",
          },
          classroom: {
            id: "class-1",
            grade_label: "Grade 9",
            section_label: "A",
            classroom_code: "9A",
          },
          exam_term: {
            id: "term-0",
            name: "Midterm",
            term_type: "midterm",
          },
          grading_scale: {
            id: "scale-1",
            name: "Default Scale",
          },
          summary: {
            total_marks_obtained: 162,
            total_max_marks: 200,
            percentage: 81.2,
            grade: "B",
            attendance_present: 16,
            attendance_total: 20,
            remarks: "Good base, needs more consistency.",
            status: "published",
            generated_at: "2025-12-01T00:00:00Z",
            published_at: "2025-12-02T00:00:00Z",
          },
          subjects: [
            {
              id: "old-subject-row-1",
              subject_id: "sub-1",
              subject_name: "Mathematics",
              marks_obtained: 40,
              max_marks: 50,
              percentage: 80,
              grade: "B",
              comment_category: "good_better",
              teacher_comment: "Performs well and usually solves questions with clear working.",
              sort_order: 1,
            },
            {
              id: "old-subject-row-2",
              subject_id: "sub-2",
              subject_name: "English",
              marks_obtained: 43,
              max_marks: 50,
              percentage: 86,
              grade: "A",
              comment_category: "good_better",
              teacher_comment: "Reads carefully and communicates ideas in an organized way.",
              sort_order: 2,
            },
          ],
        };
      }

      return {
        id: "rc-1",
        student: {
          id: "student-1",
          student_code: "STU-001",
          first_name: "Ali",
          last_name: "Khan",
          full_name: "Ali Khan",
        },
        classroom: {
          id: "class-1",
          grade_label: "Grade 9",
          section_label: "A",
          classroom_code: "9A",
        },
        exam_term: {
          id: "term-1",
          name: "Monthly Test",
          term_type: "monthly",
        },
        grading_scale: {
          id: "scale-1",
          name: "Default Scale",
        },
        summary: {
          total_marks_obtained: 177,
          total_max_marks: 200,
          percentage: 88.5,
          grade: "A",
          attendance_present: 18,
          attendance_total: 20,
          remarks: "Strong improvement this term.",
          status: "published",
          generated_at: "2026-03-01T00:00:00Z",
          published_at: "2026-03-02T00:00:00Z",
        },
        subjects: [
          {
            id: "subject-row-1",
            subject_id: "sub-1",
            subject_name: "Mathematics",
            marks_obtained: 45,
            max_marks: 50,
            percentage: 90,
            grade: "A",
            comment_category: "extraordinary",
            teacher_comment: "Shows exceptional accuracy and solves complex problems with confidence.",
            sort_order: 1,
          },
          {
            id: "subject-row-2",
            subject_id: "sub-2",
            subject_name: "English",
            marks_obtained: 42,
            max_marks: 50,
            percentage: 84,
            grade: "A",
            comment_category: "average",
            teacher_comment: "Can communicate simple ideas but needs clearer structure and accuracy.",
            sort_order: 2,
          },
        ],
      };
    });

    mockDownloadReportCardPdf.mockResolvedValue(new Blob(["pdf"]));
    mockGetMyReportCardHistory.mockResolvedValue({
      data: {
        items: [
          {
            id: "rc-older",
            student_id: "student-1",
            student_code: "STU-001",
            student_name: "Ali Khan",
            classroom_label: "Grade 9-A",
            classroom_code: "9A",
            exam_term: { id: "term-0", name: "Midterm", term_type: "midterm" },
            percentage: 81.2,
            grade: "B",
            attendance_present: 16,
            attendance_total: 20,
            attendance_rate: 80,
            generated_at: "2025-12-01T00:00:00Z",
            published_at: "2025-12-02T00:00:00Z",
            status: "published",
          },
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
          total_cards: 2,
          average_percentage: 84.85,
          latest_published_at: "2026-03-02T00:00:00Z",
        },
      },
    });
  });

  test("renders subject-by-subject report card detail for family users", async () => {
    render(<FamilyReportCardDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Ali Khan")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: /subject breakdown/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /improvement trend/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /previous term comparison/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /subject-level comparison/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /best improved subject/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /needs support subject/i })).toBeInTheDocument();
    expect(screen.getAllByText(/trend snapshot/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mathematics").length).toBeGreaterThan(0);
    expect(screen.getAllByText("English").length).toBeGreaterThan(0);
    expect(screen.getByText(/strong improvement this term/i)).toBeInTheDocument();
    expect(screen.getByText(/\+7.3%/i)).toBeInTheDocument();
    expect(screen.getAllByText(/midterm/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/teacher recommendation/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/shows exceptional accuracy and solves complex problems with confidence/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/extraordinary/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/top gain/i)).toBeInTheDocument();
      expect(screen.getByText(/watch closely/i)).toBeInTheDocument();
      expect(screen.getAllByText(/\+10.0%/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/-2.0%/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument();
  });
});
