import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ReportsPage from "@/app/dashboard/reports/page";

const mockUseAuth = vi.fn();
const mockReplace = vi.fn();
const mockGetExecutiveOverview = vi.fn();
const mockGetAttendanceSummary = vi.fn();
const mockGetHomeworkSummary = vi.fn();
const mockGetMarksSummary = vi.fn();
const mockGetFeesSummary = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupStudents = vi.fn();
const mockGetLookupSubjects = vi.fn();
const mockGetLookupAcademicYears = vi.fn();
const mockSearchParams = new URLSearchParams();
const mockClipboardWriteText = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/dashboard/reports",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getExecutiveOverview: (...args: unknown[]) => mockGetExecutiveOverview(...args),
  getAttendanceSummary: (...args: unknown[]) => mockGetAttendanceSummary(...args),
  getHomeworkSummary: (...args: unknown[]) => mockGetHomeworkSummary(...args),
  getMarksSummary: (...args: unknown[]) => mockGetMarksSummary(...args),
  getFeesSummary: (...args: unknown[]) => mockGetFeesSummary(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getLookupStudents: (...args: unknown[]) => mockGetLookupStudents(...args),
  getLookupSubjects: (...args: unknown[]) => mockGetLookupSubjects(...args),
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
  exportReport: vi.fn(),
}));

describe("Reports executive overview", () => {
  beforeEach(() => {
    localStorage.clear();
    mockReplace.mockReset();
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));
    mockGetExecutiveOverview.mockReset();
    mockGetAttendanceSummary.mockReset();
    mockGetHomeworkSummary.mockReset();
    mockGetMarksSummary.mockReset();
    mockGetFeesSummary.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetLookupStudents.mockReset();
    mockGetLookupSubjects.mockReset();
    mockGetLookupAcademicYears.mockReset();

    mockGetAttendanceSummary.mockResolvedValue({
      data: { total_records: 0, present_count: 0, absent_count: 0, late_count: 0, leave_count: 0, present_rate: 0, absent_rate: 0 },
    });
    mockGetHomeworkSummary.mockResolvedValue({
      data: {
        distinct_homework_count: 0,
        total_assigned: 0,
        submitted_count: 0,
        reviewed_count: 0,
        missing_count: 0,
        pending_count: 0,
        completion_rate: 0,
      },
    });
    mockGetMarksSummary.mockResolvedValue({
      data: {
        score_count: 0,
        assessment_count: 0,
        avg_marks_obtained: 0,
        max_marks_obtained: 0,
        min_marks_obtained: 0,
        avg_percentage: 0,
      },
    });
    mockGetFeesSummary.mockResolvedValue({
      data: {
        total_invoices: 0,
        paid_count: 0,
        overdue_count: 0,
        amount_due_total: 0,
        amount_paid_total: 0,
        outstanding_total: 0,
        overdue_total: 0,
      },
    });
    mockGetLookupClassrooms.mockResolvedValue([]);
    mockGetLookupStudents.mockResolvedValue([]);
    mockGetLookupSubjects.mockResolvedValue([]);
    mockGetLookupAcademicYears.mockResolvedValue([]);
    mockClipboardWriteText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
  });

  test("renders leadership executive overview cards for principal role", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Areeba",
        last_name: "Khan",
        roles: ["principal"],
      },
    });
    mockGetExecutiveOverview.mockResolvedValue({
      data: {
        generated_at: "2026-03-09T00:00:00.000Z",
        window: { date_from: "2026-01-01", date_to: "2026-03-09" },
        kpis: {
          attendance_present_rate: 91.5,
          marks_avg_percentage: 78.2,
          homework_completion_rate: 84.4,
          fee_outstanding_total: 24000,
          fee_overdue_invoices: 6,
        },
        attendance_trend: [],
        marks_trend: [],
        homework_by_classroom: [],
        fee_aging: {
          outstanding_total: 24000,
          overdue_invoices: 6,
          current_bucket_total: 10000,
          bucket_1_30_total: 7000,
          bucket_31_60_total: 5000,
          bucket_61_plus_total: 2000,
        },
        alerts: [],
      },
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(mockGetExecutiveOverview).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Leadership Snapshot")).toBeInTheDocument();
    expect(await screen.findByText("91.5%")).toBeInTheDocument();
  });

  test("does not call executive overview for teacher role", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-teacher",
        first_name: "Teacher",
        last_name: "One",
        roles: ["teacher"],
      },
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(mockGetAttendanceSummary).toHaveBeenCalledTimes(1);
    });
    expect(mockGetExecutiveOverview).not.toHaveBeenCalled();
    expect(screen.queryByText("Leadership Snapshot")).not.toBeInTheDocument();
  });


  test("ignores malformed stored filters without crashing", async () => {
    localStorage.setItem(
      "agora_web_reports_filters_v1",
      JSON.stringify({
        date_from: null,
        date_to: 123,
        academic_year_id: "",
        classroom_id: "",
        student_id: "",
        subject_id: "",
        status: "overdue",
        assessment_type: { bad: true },
      })
    );

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-school-admin",
        first_name: "Admin",
        last_name: "One",
        roles: ["school_admin"],
      },
    });

    mockGetExecutiveOverview.mockResolvedValue({
      data: {
        generated_at: "2026-03-09T00:00:00.000Z",
        window: { date_from: "2026-01-01", date_to: "2026-03-09" },
        kpis: {
          attendance_present_rate: 91.5,
          marks_avg_percentage: 78.2,
          homework_completion_rate: 84.4,
          fee_outstanding_total: 24000,
          fee_overdue_invoices: 6,
        },
        attendance_trend: [],
        marks_trend: [{ period_start: "2026-03-09T00:00:00.000Z", avg_percentage: 78.2 }],
        homework_by_classroom: [],
        fee_aging: {
          outstanding_total: 24000,
          overdue_invoices: 6,
          current_bucket_total: 10000,
          bucket_1_30_total: 7000,
          bucket_31_60_total: 5000,
          bucket_61_plus_total: 2000,
        },
        alerts: [{ key: "homework_low", severity: "warning", message: "Homework is low", value: 33.33 }],
      },
    });

    render(<ReportsPage />);

    expect(await screen.findByText("Leadership Snapshot")).toBeInTheDocument();
    expect((screen.getByLabelText("Date From") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Invoice Status") as HTMLSelectElement).value).toBe("overdue");
  });

  test("restores saved report filters and syncs URL on change", async () => {
    localStorage.setItem(
      "agora_web_reports_filters_v1",
      JSON.stringify({
        date_from: "2026-03-01",
        date_to: "2026-03-10",
        academic_year_id: "",
        classroom_id: "",
        student_id: "",
        subject_id: "",
        status: "issued",
        assessment_type: "",
      })
    );

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-school-admin",
        first_name: "Admin",
        last_name: "One",
        roles: ["school_admin"],
      },
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(mockGetAttendanceSummary).toHaveBeenCalledTimes(1);
    });

    const dateFrom = screen.getByLabelText("Date From") as HTMLInputElement;
    const status = screen.getByLabelText("Invoice Status") as HTMLSelectElement;
    expect(dateFrom.value).toBe("2026-03-01");
    expect(status.value).toBe("issued");

    fireEvent.change(status, { target: { value: "overdue" } });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
      const lastPath = String(mockReplace.mock.calls.at(-1)?.[0] || "");
      expect(lastPath).toContain("status=overdue");
      expect(lastPath).toContain("date_from=2026-03-01");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save this view" }));
    const savedViewsRaw = localStorage.getItem("agora_web_reports_saved_views_v1") || "[]";
    expect(savedViewsRaw).toContain("status=overdue");
    expect(localStorage.getItem("agora_web_reports_saved_view_v1")).toContain("status=overdue");

    mockReplace.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("status=overdue"),
      { scroll: false }
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy current link" }));
    expect(mockClipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/reports")
    );
  });
});
