import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import FeesPage from "@/app/dashboard/fees/page";

const mockUseAuth = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();
const mockClipboardWriteText = vi.fn();

const mockGetFeePlans = vi.fn();
const mockGetFeeInvoices = vi.fn();
const mockGetLookupAcademicYears = vi.fn();
const mockGetLookupStudents = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => "/dashboard/fees",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", () => ({
  getFeePlans: (...args: unknown[]) => mockGetFeePlans(...args),
  getFeeInvoices: (...args: unknown[]) => mockGetFeeInvoices(...args),
  getLookupAcademicYears: (...args: unknown[]) => mockGetLookupAcademicYears(...args),
  getLookupStudents: (...args: unknown[]) => mockGetLookupStudents(...args),
  createFeePlan: vi.fn(),
  createFeeInvoice: vi.fn(),
  recordPayment: vi.fn(),
}));

describe("Fees filters persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    mockReplace.mockReset();
    mockSearchParams.forEach((_value, key) => mockSearchParams.delete(key));

    mockGetFeePlans.mockReset();
    mockGetFeeInvoices.mockReset();
    mockGetLookupAcademicYears.mockReset();
    mockGetLookupStudents.mockReset();

    mockUseAuth.mockReturnValue({
      user: {
        id: "u-admin",
        first_name: "Admin",
        last_name: "One",
        roles: ["school_admin"],
      },
      isAdmin: true,
    });

    mockGetFeePlans.mockResolvedValue({ data: [], meta: { pagination: { total_pages: 1 } } });
    mockGetFeeInvoices.mockResolvedValue({ data: [], meta: { pagination: { total_pages: 1 } } });
    mockGetLookupAcademicYears.mockResolvedValue([{ id: "ay-1", label: "2025-26" }]);
    mockGetLookupStudents.mockResolvedValue([]);
    mockClipboardWriteText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
  });

  test("restores saved filters and updates URL after filter change", async () => {
    localStorage.setItem(
      "agora_web_fees_filters_v1",
      JSON.stringify({
        date_from: "2026-03-01",
        date_to: "2026-03-31",
        academic_year_id: "",
        status: "issued",
      })
    );

    render(<FeesPage />);

    await waitFor(() => {
      expect(mockGetFeeInvoices).toHaveBeenCalled();
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
    const savedViewsRaw = localStorage.getItem("agora_web_fees_saved_views_v1") || "[]";
    expect(savedViewsRaw).toContain("status=overdue");
    expect(localStorage.getItem("agora_web_fees_saved_view_v1")).toContain("status=overdue");

    mockReplace.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("status=overdue"),
      { scroll: false }
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy current link" }));
    expect(mockClipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("/dashboard/fees")
    );
  });
});
