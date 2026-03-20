import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import SectionDashboardPage from "@/app/dashboard/section/page";

const mockUseAuth = vi.fn();
const mockGetSectionDashboard = vi.fn();
const mockGetDisciplineIncidents = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getSectionDashboard: (...args: unknown[]) => mockGetSectionDashboard(...args),
  getDisciplineIncidents: (...args: unknown[]) => mockGetDisciplineIncidents(...args),
}));

describe("Section dashboard access", () => {
  beforeEach(() => {
    mockGetSectionDashboard.mockReset();
    mockGetDisciplineIncidents.mockReset();
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-1",
        first_name: "Teacher",
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
  });

  test("shows headmistress-only access state for non-HM role", () => {
    render(<SectionDashboardPage />);
    expect(screen.getByText("Headmistress Access Required")).toBeInTheDocument();
    expect(mockGetSectionDashboard).not.toHaveBeenCalled();
  });

  test("shows operational empty state when headmistress has no section assignment", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-2",
        first_name: "HM",
        last_name: "One",
        email: "hm@agora.com",
        roles: ["headmistress"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    mockGetSectionDashboard.mockResolvedValue({
      data: {
        sections: [],
        selected_section_id: null,
        selected_section_detail: null,
        generated_at: "2026-03-08T00:00:00.000Z",
      },
    });

    render(<SectionDashboardPage />);

    await waitFor(() => {
      expect(mockGetSectionDashboard).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("No Section Assigned")).toBeInTheDocument();
  });

  test("loads the section operations workspace for an assigned headmistress", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-3",
        first_name: "HM",
        last_name: "Lead",
        email: "hmlead@agora.com",
        roles: ["headmistress"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    mockGetSectionDashboard.mockResolvedValue({
      data: {
        sections: [
          {
            section_id: "section-1",
            section_name: "Middle School",
            section_code: "MID",
            section_type: "middle",
            class_count: 3,
            active_students: 90,
            assigned_staff: 8,
            linked_parents: 86,
            late_today: 4,
            absent_today: 2,
            head_user_id: "u-3",
            head_name: "HM Lead",
            coordinator_user_id: null,
            coordinator_name: null,
          },
        ],
        selected_section_id: "section-1",
        selected_section_detail: {
          section: {
            section_id: "section-1",
            section_name: "Middle School",
            section_code: "MID",
            section_type: "middle",
            class_count: 3,
            active_students: 90,
            assigned_staff: 8,
            linked_parents: 86,
            late_today: 4,
            absent_today: 2,
          },
          leadership: {
            head_user_id: "u-3",
            head_name: "HM Lead",
            coordinator_user_id: null,
            coordinator_name: null,
          },
          parent_access_summary: {
            linked_parents: 86,
            active_students: 90,
          },
          student_attendance_today: {
            total: 90,
            present_count: 82,
            late_count: 4,
            absent_count: 3,
            leave_count: 1,
          },
          staff_attendance_today: {
            total: 8,
            present_count: 7,
            late_count: 1,
            absent_count: 0,
            leave_count: 0,
          },
          class_attendance: [
            {
              classroom_id: "class-1",
              classroom_label: "Grade 7 - A",
              classroom_code: "G7-A",
              room_number: "12",
              homeroom_teacher_name: "Sara Khan",
              active_students: 30,
              present_count: 27,
              late_count: 1,
              absent_count: 1,
              leave_count: 1,
              attendance_rate: 90,
            },
          ],
          staff_profiles: [
            {
              staff_profile_id: "staff-1",
              user_id: "user-1",
              first_name: "Sara",
              last_name: "Khan",
              staff_code: "STF-001",
              staff_type: "teacher",
              designation: "Homeroom Teacher",
              department: "Academics",
              attendance_status: "present",
            },
          ],
          late_absent_students: [],
          upcoming_events: [],
          announcements: [],
          result_progress_by_term: [
            {
              exam_term_id: "term-1",
              term_name: "Midterm",
              term_type: "midterm",
              starts_on: "2026-03-01",
              ends_on: "2026-03-10",
              total_report_cards: 90,
              published_report_cards: 72,
              draft_report_cards: 18,
              average_percentage: 78.2,
            },
          ],
          admissions_summary: {
            inquiry_count: 3,
            applied_count: 2,
            under_review_count: 1,
            accepted_count: 1,
            waitlisted_count: 0,
            rejected_count: 0,
          },
          admission_records: [],
          timetable_summary: {
            entries_count: 24,
            classrooms_with_timetable: 3,
            substitutions_this_week: 1,
          },
          timetable_preview: [],
          movement_summary: {
            inactive_enrollments: 2,
            transferred_students: 1,
            promoted_students: 3,
            withdrawn_students: 1,
          },
        },
        generated_at: "2026-03-08T00:00:00.000Z",
      },
    });

    render(<SectionDashboardPage />);

    await waitFor(() => {
      expect(mockGetSectionDashboard).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/Middle School section operations/i)).toBeInTheDocument();
    expect(screen.getByText(/Headmistress section workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/All classes in this section/i)).toBeInTheDocument();
    expect(screen.getByText(/Section staff and managers/i)).toBeInTheDocument();
  });
});
