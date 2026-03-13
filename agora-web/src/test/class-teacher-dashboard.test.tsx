import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ClassTeacherDashboardPage from "@/app/dashboard/class-teacher/page";

const mockUseAuth = vi.fn();
const mockGetClassTeacherMyClassroom = vi.fn();
const mockGetReportCardHistory = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getClassTeacherMyClassroom: (...args: unknown[]) => mockGetClassTeacherMyClassroom(...args),
  getReportCardHistory: (...args: unknown[]) => mockGetReportCardHistory(...args),
}));

describe("Class teacher dashboard", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Areeba",
        last_name: "Khan",
        roles: ["teacher"],
      },
    });

    mockGetClassTeacherMyClassroom.mockResolvedValue({
      classroom: {
        id: "class-1",
        grade_label: "Grade 9",
        section_label: "A",
        academic_year_id: "year-1",
        academic_year_name: "2025-2026",
      },
      student_count: 24,
      attendance_today: {
        present_count: 21,
        absent_count: 2,
        late_count: 1,
        leave_count: 0,
        total_marked: 24,
      },
      subjects: [
        { classroom_subject_id: "cs-1", subject_id: "sub-1", subject_name: "Mathematics" },
        { classroom_subject_id: "cs-2", subject_id: "sub-2", subject_name: "English" },
      ],
      exam_terms: [{ id: "term-1", name: "Monthly Test", term_type: "monthly" }],
      marks_completion: [
        {
          exam_term_id: "term-1",
          term_name: "Monthly Test",
          assessment_count: 4,
          score_count: 80,
          expected_scores: 96,
          completion_percentage: 83,
        },
      ],
      subject_comment_completion: [
        {
          subject_id: "sub-1",
          subject_name: "Mathematics",
          exam_term_id: "term-1",
          term_name: "Monthly Test",
          total_cards: 24,
          commented_rows: 18,
          completion_percentage: 75,
        },
        {
          subject_id: "sub-2",
          subject_name: "English",
          exam_term_id: "term-1",
          term_name: "Monthly Test",
          total_cards: 24,
          commented_rows: 12,
          completion_percentage: 50,
        },
      ],
      subject_comment_completion_trend: [
        {
          exam_term_id: "term-0",
          term_name: "Weekly Test",
          total_cards: 24,
          commented_rows: 12,
          expected_rows: 48,
          completion_percentage: 25,
        },
        {
          exam_term_id: "term-1",
          term_name: "Monthly Test",
          total_cards: 24,
          commented_rows: 30,
          expected_rows: 48,
          completion_percentage: 63,
        },
      ],
    });

    mockGetReportCardHistory.mockResolvedValue({
      data: {
        items: [],
        kpis: {
          total_cards: 24,
          published_cards: 10,
          draft_cards: 14,
          average_percentage: 77,
          average_attendance_rate: 91,
          grade_distribution: [],
        },
      },
      pagination: {
        page: 1,
        page_size: 10,
        total_items: 24,
        total_pages: 3,
      },
    });
  });

  test("shows the subject comments toolkit summary block", async () => {
    render(<ClassTeacherDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/subject comments toolkit/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/presets ready/i)).toBeInTheDocument();
    expect(screen.getByText(/latest term cards/i)).toBeInTheDocument();
    expect(screen.getByText(/latest term: monthly test/i)).toBeInTheDocument();
    expect(screen.getByText(/comment completion by subject/i)).toBeInTheDocument();
    expect(screen.getByText(/comment completion trend by term/i)).toBeInTheDocument();
    expect(screen.getByText("63% (30/48)")).toBeInTheDocument();
    expect(screen.getByText("75% (18/24)")).toBeInTheDocument();
    expect(screen.getByText("50% (12/24)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mathematics/i })).toHaveAttribute(
      "href",
      "/dashboard/class-teacher/report-cards?subject_id=sub-1&exam_term_id=term-1&comment_status=missing"
    );
    expect(screen.getByRole("link", { name: /^open$/i })).toHaveAttribute(
      "href",
      "/dashboard/class-teacher/report-cards"
    );
  });
});
