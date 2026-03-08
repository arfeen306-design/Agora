import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DocumentDetailPage from "@/app/dashboard/documents/[documentId]/page";

const mockUseAuth = vi.fn();
const mockUseParams = vi.fn();

const mockGetDocumentDetail = vi.fn();
const mockGetDocumentDownloadEvents = vi.fn();
const mockIssueDocumentDownloadUrl = vi.fn();
const mockUpdateDocument = vi.fn();
const mockArchiveDocument = vi.fn();
const mockAddDocumentVersion = vi.fn();
const mockSetDocumentAccessRules = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => mockUseParams(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
    code = "UNKNOWN";
  },
  getDocumentDetail: (...args: unknown[]) => mockGetDocumentDetail(...args),
  getDocumentDownloadEvents: (...args: unknown[]) => mockGetDocumentDownloadEvents(...args),
  issueDocumentDownloadUrl: (...args: unknown[]) => mockIssueDocumentDownloadUrl(...args),
  updateDocument: (...args: unknown[]) => mockUpdateDocument(...args),
  archiveDocument: (...args: unknown[]) => mockArchiveDocument(...args),
  addDocumentVersion: (...args: unknown[]) => mockAddDocumentVersion(...args),
  setDocumentAccessRules: (...args: unknown[]) => mockSetDocumentAccessRules(...args),
}));

describe("Document detail page", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ documentId: "doc-1" });
    mockGetDocumentDetail.mockReset();
    mockGetDocumentDownloadEvents.mockReset();
    mockIssueDocumentDownloadUrl.mockReset();
    mockUpdateDocument.mockReset();
    mockArchiveDocument.mockReset();
    mockAddDocumentVersion.mockReset();
    mockSetDocumentAccessRules.mockReset();

    mockIssueDocumentDownloadUrl.mockResolvedValue({
      document_id: "doc-1",
      file_key: "1000/documents/doc-1.pdf",
      download: { url: "http://example.com/download/doc-1" },
    });

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-principal",
        first_name: "Principal",
        last_name: "One",
        email: "principal@agora.com",
        roles: ["principal"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  test("shows access guard for unauthorized role", () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: "u-parent",
        first_name: "Parent",
        last_name: "One",
        email: "parent@agora.com",
        roles: ["parent"],
      },
      loading: false,
      isAdmin: false,
      isTeacher: false,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    render(<DocumentDetailPage />);
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
  });

  test("loads full detail, renders version/access/download sections, and triggers download", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    mockGetDocumentDetail.mockResolvedValue({
      id: "doc-1",
      school_id: "school-1",
      title: "Staff Appointment",
      description: "Appointment letter",
      file_key: "10000000-0000-0000-0000-000000000001/documents/staff-appointment.pdf",
      file_name: "staff-appointment.pdf",
      file_size_bytes: 1200,
      mime_type: "application/pdf",
      category: "appointment_letter",
      scope_type: "staff",
      scope_id: "staff-1",
      uploaded_by_user_id: "u-principal",
      version_no: 1,
      versions_count: 1,
      downloads_count: 2,
      is_archived: false,
      expires_on: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      access_rules: [{
        id: "rule-1",
        access_type: "role",
        role_code: "teacher",
        user_id: null,
        can_view: true,
        can_download: true,
        created_at: new Date().toISOString(),
      }],
      versions: [{
        id: "ver-1",
        version_no: 1,
        file_key: "1000/documents/ver1.pdf",
        file_name: "staff-appointment.pdf",
        file_size_bytes: 1200,
        mime_type: "application/pdf",
        uploaded_by_user_id: "u-principal",
        created_at: new Date().toISOString(),
      }],
    });

    mockGetDocumentDownloadEvents.mockResolvedValue({
      data: [{
        id: "evt-1",
        document_id: "doc-1",
        downloaded_by_user_id: "u-teacher",
        downloaded_by_first_name: "Areeba",
        downloaded_by_last_name: "Khan",
        downloaded_by_email: "teacher1@agora.com",
        downloaded_at: new Date().toISOString(),
        delivery_method: "signed_url",
      }],
      meta: { pagination: { page: 1, page_size: 30, total_items: 1, total_pages: 1 } },
    });

    render(<DocumentDetailPage />);

    await waitFor(() => {
      expect(mockGetDocumentDetail).toHaveBeenCalledWith("doc-1");
    });

    expect(screen.getByText("Staff Appointment")).toBeInTheDocument();
    expect(screen.getByText("Version Management")).toBeInTheDocument();
    expect(screen.getByText("Access Rule Editor")).toBeInTheDocument();
    expect(screen.getByText("Download Timeline")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Download")[0]);

    await waitFor(() => {
      expect(mockIssueDocumentDownloadUrl).toHaveBeenCalledWith("doc-1");
    });

    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
