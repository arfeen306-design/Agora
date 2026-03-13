import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import NotificationsPage from "@/app/dashboard/notifications/page";

const mockUseAuth = vi.fn();
const mockGetNotifications = vi.fn();
const mockMarkNotificationRead = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", () => ({
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
}));

describe("Family notifications center", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: {
        first_name: "Parent",
        last_name: "User",
        roles: ["parent"],
      },
    });

    mockGetNotifications.mockResolvedValue({
      data: [
        {
          id: "note-1",
          title: "Zain arrived at school",
          body: "Attendance marked present at 7:54 AM.",
          channel: "in_app",
          status: "queued",
          created_at: "2026-03-13T07:54:00Z",
        },
        {
          id: "note-2",
          title: "Monthly test published",
          body: "The latest marks report is now available.",
          channel: "push",
          status: "sent",
          created_at: "2026-03-13T08:30:00Z",
        },
      ],
      meta: { pagination: { total_pages: 1, total_items: 2 } },
    });

    mockMarkNotificationRead.mockResolvedValue({ success: true });
  });

  test("shows richer family communication sections", async () => {
    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText(/family communication center/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: /unread priority notices/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent communication timeline/i })).toBeInTheDocument();
    expect(screen.getAllByText(/zain arrived at school/i).length).toBeGreaterThan(0);
  });
});
