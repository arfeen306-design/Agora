import { render, screen, waitFor } from "@testing-library/react";
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
});
