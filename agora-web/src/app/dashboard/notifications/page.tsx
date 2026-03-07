"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { getNotifications, markNotificationRead } from "@/lib/api";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  channel: "in_app" | "push" | "email" | "sms";
  status: "queued" | "sent" | "failed" | "read";
  created_at: string;
}

type SortColumn = "created_at" | "status" | "channel" | "title";

const STORAGE_KEY = "agora_web_notifications_filters_v1";

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: "20",
      };
      if (statusFilter) params.status = statusFilter;
      if (channelFilter) params.channel = channelFilter;

      const res = await getNotifications(params);
      setItems(res.data as NotificationRow[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch (err: unknown) {
      setItems([]);
      setMessage(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, channelFilter]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          statusFilter?: string;
          channelFilter?: string;
          searchInput?: string;
          sortBy?: SortColumn;
          sortDir?: "asc" | "desc";
        };
        if (parsed.statusFilter !== undefined) setStatusFilter(parsed.statusFilter);
        if (parsed.channelFilter !== undefined) setChannelFilter(parsed.channelFilter);
        if (parsed.searchInput !== undefined) {
          setSearchInput(parsed.searchInput);
          setSearch(parsed.searchInput);
        }
        if (parsed.sortBy) setSortBy(parsed.sortBy);
        if (parsed.sortDir) setSortDir(parsed.sortDir);
      }
    } catch {
      // ignore bad local storage payload
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    loadNotifications();
  }, [hydrated, loadNotifications]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        statusFilter,
        channelFilter,
        searchInput,
        sortBy,
        sortDir,
      })
    );
  }, [hydrated, statusFilter, channelFilter, searchInput, sortBy, sortDir]);

  async function markAsRead(id: string) {
    setMessage("");
    try {
      await markNotificationRead(id);
      await loadNotifications();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update notification");
    }
  }

  function toggleSort(column: SortColumn) {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir(column === "created_at" ? "desc" : "asc");
  }

  function sortIndicator(column: SortColumn) {
    if (sortBy !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  function sortHeaderClass(column: SortColumn) {
    return `inline-flex items-center gap-2 transition-colors ${
      sortBy === column ? "text-primary-700 font-semibold" : "text-gray-500 hover:text-gray-700"
    }`;
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      read: "badge-gray",
      sent: "badge-green",
      queued: "badge-blue",
      failed: "badge-red",
    };
    return <span className={styles[status] || "badge-gray"}>{status}</span>;
  };

  const channelBadge = (channel: string) => {
    const styles: Record<string, string> = {
      in_app: "badge-blue",
      push: "badge-green",
      email: "badge-yellow",
      sms: "badge-red",
    };
    return <span className={styles[channel] || "badge-gray"}>{channel}</span>;
  };

  const viewItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) =>
          [item.title, item.body, item.status, item.channel].join(" ").toLowerCase().includes(q)
        )
      : items;

    return [...filtered].sort((a, b) => {
      let left = "";
      let right = "";
      if (sortBy === "created_at") {
        left = new Date(a.created_at).toISOString();
        right = new Date(b.created_at).toISOString();
      } else if (sortBy === "status") {
        left = a.status;
        right = b.status;
      } else if (sortBy === "channel") {
        left = a.channel;
        right = b.channel;
      } else {
        left = a.title;
        right = b.title;
      }
      const cmp = left.localeCompare(right);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, search, sortBy, sortDir]);

  return (
    <>
      <Header title="Notifications" />
      <div className="p-6">
        {message && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="label-text">Status</label>
            <select
              className="input-field"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="read">Read</option>
            </select>
          </div>
          <div>
            <label className="label-text">Channel</label>
            <select
              className="input-field"
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="in_app">In App</option>
              <option value="push">Push</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <button className="btn-secondary" onClick={loadNotifications}>
            Refresh
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setStatusFilter("");
              setChannelFilter("");
              setSearchInput("");
              setSearch("");
              setSortBy("created_at");
              setSortDir("desc");
              setPage(1);
            }}
          >
            Reset
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label-text">Search (debounced)</label>
            <input
              type="text"
              className="input-field"
              placeholder="Search title/body/status/channel"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="flex items-end text-sm text-gray-500">Click column headers to sort.</div>
        </div>

        <div className="mb-4 text-sm text-gray-500">
          Showing <strong>{viewItems.length}</strong> item(s) on this page.
        </div>

        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="card text-center text-gray-400">Loading notifications...</div>
          ) : viewItems.length === 0 ? (
            <div className="card text-center text-gray-400">No notifications found</div>
          ) : (
            viewItems.map((item) => (
              <div key={item.id} className="card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-900">{item.title}</p>
                  {statusBadge(item.status)}
                </div>
                <p className="mb-2 text-sm text-gray-600">{item.body}</p>
                <div className="mb-3 flex items-center gap-2">
                  {channelBadge(item.channel)}
                  <span className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</span>
                </div>
                {item.status !== "read" && (
                  <button className="btn-secondary w-full" onClick={() => markAsRead(item.id)}>
                    Mark read
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="table-container hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("title")} onClick={() => toggleSort("title")}>
                    Title <span className="text-xs">{sortIndicator("title")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Body</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("channel")} onClick={() => toggleSort("channel")}>
                    Channel <span className="text-xs">{sortIndicator("channel")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("status")} onClick={() => toggleSort("status")}>
                    Status <span className="text-xs">{sortIndicator("status")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("created_at")} onClick={() => toggleSort("created_at")}>
                    Created <span className="text-xs">{sortIndicator("created_at")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading notifications...</td>
                </tr>
              ) : viewItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No notifications found</td>
                </tr>
              ) : (
                viewItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.title}</td>
                    <td className="px-4 py-3 text-gray-600">{item.body}</td>
                    <td className="px-4 py-3">{channelBadge(item.channel)}</td>
                    <td className="px-4 py-3">{statusBadge(item.status)}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(item.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      {item.status !== "read" ? (
                        <button className="text-primary-600 hover:text-primary-800 text-sm font-medium" onClick={() => markAsRead(item.id)}>
                          Mark read
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Done</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
