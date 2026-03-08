import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import ParentDirectoryPage from "@/app/dashboard/people/parents/page";
import ParentProfilePage from "@/app/dashboard/people/parents/[parentId]/page";

const mockUseAuth = vi.fn();
const mockUseParams = vi.fn();

const mockGetPeopleParents = vi.fn();
const mockCreatePeopleParent = vi.fn();
const mockGetLookupStudents = vi.fn();
const mockGetLookupClassrooms = vi.fn();
const mockGetLookupSections = vi.fn();
const mockGetPeopleParent = vi.fn();
const mockUpdatePeopleParent = vi.fn();
const mockGetFeeInvoices = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
}));

vi.mock("@/lib/api", () => ({
  getPeopleParents: (...args: unknown[]) => mockGetPeopleParents(...args),
  createPeopleParent: (...args: unknown[]) => mockCreatePeopleParent(...args),
  getLookupStudents: (...args: unknown[]) => mockGetLookupStudents(...args),
  getLookupClassrooms: (...args: unknown[]) => mockGetLookupClassrooms(...args),
  getLookupSections: (...args: unknown[]) => mockGetLookupSections(...args),
  getPeopleParent: (...args: unknown[]) => mockGetPeopleParent(...args),
  updatePeopleParent: (...args: unknown[]) => mockUpdatePeopleParent(...args),
  getFeeInvoices: (...args: unknown[]) => mockGetFeeInvoices(...args),
}));

describe("Parent pages access", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ parentId: "parent-1" });
    mockGetPeopleParents.mockReset();
    mockCreatePeopleParent.mockReset();
    mockGetLookupStudents.mockReset();
    mockGetLookupClassrooms.mockReset();
    mockGetLookupSections.mockReset();
    mockGetPeopleParent.mockReset();
    mockUpdatePeopleParent.mockReset();
    mockGetFeeInvoices.mockReset();

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-student",
        first_name: "Student",
        last_name: "User",
        email: "student@agora.com",
        roles: ["student"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  test("parent directory is blocked for student role", () => {
    render(<ParentDirectoryPage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.getByText(/do not have permission to view the parent directory/i)).toBeInTheDocument();
  });

  test("parent profile is blocked for student role", () => {
    render(<ParentProfilePage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.getByText(/do not have permission to access parent profiles/i)).toBeInTheDocument();
  });

  test("principal can load parent directory list", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Principal",
        last_name: "User",
        email: "principal@agora.com",
        roles: ["principal"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetLookupSections.mockResolvedValue([{ id: "sec-1", label: "Middle (MID)" }]);
    mockGetLookupClassrooms.mockResolvedValue([{ id: "cls-1", label: "Grade 7 - A" }]);
    mockGetLookupStudents.mockResolvedValue([]);
    mockGetPeopleParents.mockResolvedValue({
      data: [
        {
          id: "parent-1",
          first_name: "Amina",
          last_name: "Khan",
          guardian_name: "Amina Khan",
          email: "amina@agora.com",
          phone: "+92000111",
          whatsapp_number: "+92000111",
          preferred_channel: "in_app",
          is_active: true,
          linked_students_count: 1,
          last_login_at: null,
        },
      ],
      meta: {
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 1,
          total_pages: 1,
        },
      },
    });

    render(<ParentDirectoryPage />);

    await waitFor(() => {
      expect(mockGetPeopleParents).toHaveBeenCalled();
    });
    expect(screen.getByText("Parent Directory and Linkage Center")).toBeInTheDocument();
    expect(screen.getAllByText("Amina Khan").length).toBeGreaterThan(0);
  });

  test("principal can load parent profile with linked children and fee summary", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Principal",
        last_name: "User",
        email: "principal@agora.com",
        roles: ["principal"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    mockGetLookupStudents.mockResolvedValue([
      {
        id: "student-1",
        student_code: "STU-001",
        first_name: "Zain",
        last_name: "Khan",
        classroom_id: "class-1",
        classroom_label: "Grade 7 - A",
        label: "Zain Khan",
      },
    ]);
    mockGetPeopleParent.mockResolvedValue({
      id: "parent-1",
      user_id: "user-parent-1",
      first_name: "Amina",
      last_name: "Khan",
      guardian_name: "Amina Khan",
      father_name: "Tariq Khan",
      mother_name: "Sara Khan",
      email: "amina@agora.com",
      phone: "+92000111",
      whatsapp_number: "+92000111",
      address_line: "Street 1",
      preferred_channel: "in_app",
      occupation: "Engineer",
      is_active: true,
      last_login_at: null,
      linked_students: [
        {
          student_id: "student-1",
          student_code: "STU-001",
          student_name: "Zain Khan",
          relation_type: "guardian",
          is_primary: true,
          status: "active",
          classroom: {
            classroom_id: "class-1",
            grade_label: "Grade 7",
            section_label: "A",
            display_name: "Grade 7 - A",
          },
        },
      ],
    });
    mockGetFeeInvoices.mockResolvedValue({
      data: [
        {
          id: "inv-1",
          amount_due: 1000,
          amount_paid: 700,
          status: "partial",
        },
      ],
    });

    render(<ParentProfilePage />);

    await waitFor(() => {
      expect(mockGetPeopleParent).toHaveBeenCalledWith("parent-1");
    });
    const parentNames = await screen.findAllByText("Amina Khan");
    expect(parentNames.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Linked Children").length).toBeGreaterThan(0);
    expect(screen.getByText("Zain Khan")).toBeInTheDocument();
  });
});
