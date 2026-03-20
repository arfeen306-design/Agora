import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import TimetableDashboardPage from "@/app/dashboard/timetable/page";

const mockUseAuth = vi.fn();
const mockGetLookupAcademicYears = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetTimetableTeachers = vi.fn();
const mockGetLookupSubjects = vi.fn();
const mockGetTimetableSlots = vi.fn();
const mockGetTimetableSubstitutions = vi.fn();
const mockGetClassroomTimetable = vi.fn();
const mockGetMyTeacherTimetable = vi.fn();
const mockGetTeacherTimetable = vi.fn();
const mockGenerateTimetableViaEngine = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getTimetableTeachers: (...args: unknown[]) => mockGetTimetableTeachers(...args),
  getLookupSubjects: (...args: unknown[]) => mockGetLookupSubjects(...args),
  getTimetableSlots: (...args: unknown[]) => mockGetTimetableSlots(...args),
  getTimetableSubstitutions: (...args: unknown[]) => mockGetTimetableSubstitutions(...args),
  getClassroomTimetable: (...args: unknown[]) => mockGetClassroomTimetable(...args),
  getMyTeacherTimetable: (...args: unknown[]) => mockGetMyTeacherTimetable(...args),
  getTeacherTimetable: (...args: unknown[]) => mockGetTeacherTimetable(...args),
  generateTimetableViaEngine: (...args: unknown[]) => mockGenerateTimetableViaEngine(...args),
  createTimetableEntry: vi.fn(),
  createTimetablePeriod: vi.fn(),
  createTimetableSubstitution: vi.fn(),
  generateTimetableSlots: vi.fn(),
  revokeTimetableSubstitution: vi.fn(),
}));

describe("Timetable dashboard access", () => {
  beforeEach(() => {
    mockGetLookupAcademicYears.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetTimetableTeachers.mockReset();
    mockGetLookupSubjects.mockReset();
    mockGetTimetableSlots.mockReset();
    mockGetTimetableSubstitutions.mockReset();
    mockGetClassroomTimetable.mockReset();
    mockGetMyTeacherTimetable.mockReset();
    mockGetTeacherTimetable.mockReset();
    mockGenerateTimetableViaEngine.mockReset();
  });

  test("shows access required for unsupported roles", () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "parent-1",
        first_name: "Parent",
        last_name: "User",
        email: "parent@agora.com",
        roles: ["parent"],
      },
      loading: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<TimetableDashboardPage />);

    expect(screen.getByText("Timetable Access Required")).toBeInTheDocument();
    expect(mockGetLookupAcademicYears).not.toHaveBeenCalled();
  });

  test("teacher role loads own timetable view", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "teacher-1",
        first_name: "Areeba",
        last_name: "Khan",
        email: "teacher1@agora.com",
        roles: ["teacher"],
      },
      loading: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetLookupAcademicYears.mockResolvedValue([
      { id: "y1", name: "2025-2026", is_current: true, label: "2025-2026" },
    ]);
    mockGetLookupClassrooms.mockResolvedValue([
      { id: "c1", grade_label: "Grade 7", section_label: "A", academic_year_name: "2025-2026", label: "Grade 7 - A" },
    ]);
    mockGetTimetableTeachers.mockResolvedValue([
      {
        id: "t1",
        user_id: "teacher-1",
        employee_code: "T-001",
        designation: "Math Teacher",
        first_name: "Areeba",
        last_name: "Khan",
        email: "teacher1@agora.com",
        label: "Areeba Khan",
      },
    ]);
    mockGetLookupSubjects.mockResolvedValue([]);
    mockGetTimetableSlots.mockResolvedValue([]);
    mockGetTimetableSubstitutions.mockResolvedValue({ data: [] });
    mockGetMyTeacherTimetable.mockResolvedValue({
      teacher_id: "t1",
      academic_year_id: "y1",
      entries: [],
    });
    mockGetClassroomTimetable.mockResolvedValue({
      classroom: { id: "c1", grade_label: "Grade 7", section_label: "A", room_number: "201", label: "Grade 7 - A" },
      academic_year_id: "y1",
      slots: [],
      entries: [],
      substitutions: [],
    });

    render(<TimetableDashboardPage />);

    await waitFor(() => {
      expect(mockGetMyTeacherTimetable).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Teacher Timetable View")).toBeInTheDocument();
    expect(screen.getByText("Substitution Manager")).toBeInTheDocument();
  });

  test("leadership can trigger generation via external engine and see the summary", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "admin-1",
        first_name: "Admin",
        last_name: "User",
        email: "admin@agora.com",
        roles: ["school_admin"],
      },
      loading: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetLookupAcademicYears.mockResolvedValue([
      { id: "y1", name: "2025-2026", is_current: true, label: "2025-2026" },
    ]);
    mockGetLookupClassrooms.mockResolvedValue([
      { id: "c1", grade_label: "Grade 7", section_label: "A", academic_year_name: "2025-2026", label: "Grade 7 - A" },
    ]);
    mockGetTimetableTeachers.mockResolvedValue([
      {
        id: "t1",
        user_id: "teacher-1",
        employee_code: "T-001",
        designation: "Math Teacher",
        first_name: "Areeba",
        last_name: "Khan",
        email: "teacher1@agora.com",
        label: "Areeba Khan",
      },
    ]);
    mockGetLookupSubjects.mockResolvedValue([]);
    mockGetTimetableSlots.mockResolvedValue([]);
    mockGetTimetableSubstitutions.mockResolvedValue({ data: [] });
    mockGetTeacherTimetable.mockResolvedValue({
      teacher_id: "t1",
      academic_year_id: "y1",
      entries: [],
    });
    mockGetClassroomTimetable.mockResolvedValue({
      classroom: { id: "c1", grade_label: "Grade 7", section_label: "A", room_number: "201", label: "Grade 7 - A" },
      academic_year_id: "y1",
      slots: [],
      entries: [],
      substitutions: [],
    });
    mockGenerateTimetableViaEngine.mockResolvedValue({
      academic_year_id: "y1",
      academic_year_name: "2025-2026",
      project: { id: 7, name: "Agora | Demo | 2025-2026", academic_year: "2025-2026" },
      synced: { subjects: 6, teachers: 4, rooms: 1, classes: 1, lessons: 8 },
      validation: { warnings: [], readiness_summary: { warnings_count: 0 } },
      generation: { run_id: 91, entries_count: 8, message: "Scheduled 8 entries." },
      import: { imported_count: 8 },
      unscheduled_lessons: [],
    });

    render(<TimetableDashboardPage />);

    const button = await screen.findByRole("button", { name: /generate via engine/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockGenerateTimetableViaEngine).toHaveBeenCalledWith({ academic_year_id: "y1" });
    });

    expect(await screen.findByText(/engine sync summary/i)).toBeInTheDocument();
    expect(screen.getByText(/timetable engine generated 8 active entries/i)).toBeInTheDocument();
    expect(screen.getByText(/scheduled 8 entries\./i)).toBeInTheDocument();
    expect(screen.getByText(/no unscheduled lessons returned by the engine/i)).toBeInTheDocument();
  });
});
