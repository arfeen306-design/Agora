import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ClassTeacherReportCardsPage from "@/app/dashboard/class-teacher/report-cards/page";

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

const mockGetClassTeacherMyClassroom = vi.fn();
const mockGetReportCardHistory = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/dashboard/class-teacher/report-cards",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  bulkGenerateReportCards: vi.fn(),
  bulkPublishReportCards: vi.fn(),
  downloadReportCardPdf: vi.fn(),
  getClassTeacherMyClassroom: (...args: unknown[]) => mockGetClassTeacherMyClassroom(...args),
  getReportCard: vi.fn(),
  getReportCardHistory: (...args: unknown[]) => mockGetReportCardHistory(...args),
  publishReportCard: vi.fn(),
  unpublishReportCard: vi.fn(),
  updateReportCardSubjectComments: vi.fn(),
}));

describe("Class teacher report cards prefill", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));
    mockSearchParams.set("subject_id", "sub-1");
    mockSearchParams.set("exam_term_id", "term-1");
    mockSearchParams.set("comment_status", "missing");

    mockGetClassTeacherMyClassroom.mockResolvedValue({
      classroom: {
        id: "class-1",
        grade_label: "Grade 9",
        section_label: "A",
        academic_year_id: "year-1",
        academic_year_name: "2025-2026",
      },
      subjects: [
        { subject_id: "sub-1", subject_name: "Mathematics" },
        { subject_id: "sub-2", subject_name: "English" },
      ],
      exam_terms: [{ id: "term-1", name: "Monthly Test", term_type: "monthly" }],
    });

    mockGetReportCardHistory.mockResolvedValue({
      data: {
        items: [],
        kpis: {
          total_cards: 0,
          published_cards: 0,
          draft_cards: 0,
          average_percentage: 0,
          average_attendance_rate: 0,
          grade_distribution: [],
        },
      },
      pagination: {
        page: 1,
        page_size: 25,
        total_items: 0,
        total_pages: 1,
      },
    });
  });

  test("prefills focused subject from query params", async () => {
    render(<ClassTeacherReportCardsPage />);

    await waitFor(() => {
      expect(mockGetClassTeacherMyClassroom).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByLabelText("Focus Subject")).toHaveValue("sub-1");
    expect(screen.getByLabelText("Comment Status")).toHaveValue("missing");
    expect(screen.getByText(/Focused subject: Mathematics/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetReportCardHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          classroom_id: "class-1",
          exam_term_id: "term-1",
          subject_id: "sub-1",
          comment_status: "missing",
        })
      );
    });
  });
});
