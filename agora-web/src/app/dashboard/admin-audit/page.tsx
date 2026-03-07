"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { exportAuditLogs, getAuditLogs } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface AuditLog {
  id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_name: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

type SortColumn = "created_at" | "actor" | "action" | "entity";

const STORAGE_KEY = "agora_web_admin_audit_filters_v1";

export default function AdminAuditPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [filters, setFilters] = useState({
    action: "",
    entity_name: "",
    date_from: "",
    date_to: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hydrated, setHydrated] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: "20",
      };
      if (filters.action) params.action = filters.action;
      if (filters.entity_name) params.entity_name = filters.entity_name;
      if (filters.date_from) params.date_from = new Date(filters.date_from).toISOString();
      if (filters.date_to) params.date_to = new Date(filters.date_to).toISOString();

      const res = await getAuditLogs(params);
      setItems(res.data as AuditLog[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch (err: unknown) {
      setItems([]);
      setMessage(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [filters.action, filters.entity_name, filters.date_from, filters.date_to, page]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          filters?: { action: string; entity_name: string; date_from: string; date_to: string };
          searchInput?: string;
          sortBy?: SortColumn;
          sortDir?: "asc" | "desc";
        };
        if (parsed.filters) setFilters(parsed.filters);
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
    if (!isAdmin || !hydrated) return;
    loadLogs();
  }, [isAdmin, hydrated, loadLogs]);

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
        filters,
        searchInput,
        sortBy,
        sortDir,
      })
    );
  }, [hydrated, filters, searchInput, sortBy, sortDir]);

  async function handleExport(format: "csv" | "pdf") {
    setDownloading(format);
    setMessage("");

    try {
      const params: Record<string, string> = { max_rows: "5000" };
      if (filters.action) params.action = filters.action;
      if (filters.entity_name) params.entity_name = filters.entity_name;
      if (filters.date_from) params.date_from = new Date(filters.date_from).toISOString();
      if (filters.date_to) params.date_to = new Date(filters.date_to).toISOString();

      const blob = await exportAuditLogs(format, params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `agora-audit-logs-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to export audit logs");
    } finally {
      setDownloading(null);
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

  const viewItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) =>
          [
            item.actor_name || "",
            item.actor_email || "",
            item.action,
            item.entity_name,
            item.entity_id || "",
            JSON.stringify(item.metadata || {}),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : items;

    return [...filtered].sort((a, b) => {
      let left = "";
      let right = "";
      if (sortBy === "created_at") {
        left = new Date(a.created_at).toISOString();
        right = new Date(b.created_at).toISOString();
      } else if (sortBy === "actor") {
        left = `${a.actor_name || ""} ${a.actor_email || ""}`;
        right = `${b.actor_name || ""} ${b.actor_email || ""}`;
      } else if (sortBy === "action") {
        left = a.action;
        right = b.action;
      } else {
        left = a.entity_name;
        right = b.entity_name;
      }
      const cmp = left.localeCompare(right);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, search, sortBy, sortDir]);

  if (!isAdmin) {
    return (
      <>
        <Header title="Audit Logs" />
        <div className="p-6">
          <div className="card py-12 text-center">
            <p className="text-gray-500">Only school admins can access audit logs.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Admin Audit Logs" />
      <div className="p-6">
        {message && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {message}
          </div>
        )}

        <div className="card mb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="label-text">Action</label>
              <input
                className="input-field"
                placeholder="POST events"
                value={filters.action}
                onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Entity</label>
              <input
                className="input-field"
                placeholder="events/homework"
                value={filters.entity_name}
                onChange={(e) => setFilters((prev) => ({ ...prev, entity_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Date From</label>
              <input
                type="datetime-local"
                className="input-field"
                value={filters.date_from}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_from: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Date To</label>
              <input
                type="datetime-local"
                className="input-field"
                value={filters.date_to}
                onChange={(e) => setFilters((prev) => ({ ...prev, date_to: e.target.value }))}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => {
                setPage(1);
                loadLogs();
              }}
              disabled={loading}
            >
              {loading ? "Loading..." : "Apply Filters"}
            </button>
            <button className="btn-secondary" onClick={() => handleExport("csv")} disabled={downloading !== null}>
              {downloading === "csv" ? "Exporting..." : "Export CSV"}
            </button>
            <button className="btn-secondary" onClick={() => handleExport("pdf")} disabled={downloading !== null}>
              {downloading === "pdf" ? "Exporting..." : "Export PDF"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setFilters({ action: "", entity_name: "", date_from: "", date_to: "" });
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
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label-text">Search (debounced)</label>
            <input
              className="input-field"
              placeholder="Search actor/action/entity/metadata"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <div className="flex items-end text-sm text-gray-500">Click column headers to sort.</div>
        </div>

        <div className="mb-4 text-sm text-gray-500">
          Showing <strong>{viewItems.length}</strong> row(s) on this page.
        </div>

        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="card text-center text-gray-400">Loading audit logs...</div>
          ) : viewItems.length === 0 ? (
            <div className="card text-center text-gray-400">No audit logs found</div>
          ) : (
            viewItems.map((item) => (
              <div key={item.id} className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">{item.actor_name || "System"}</p>
                  <p className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString()}</p>
                </div>
                <p className="text-xs text-gray-500">{item.actor_email || "—"}</p>
                <p className="mt-2 text-sm font-medium text-gray-900">{item.action}</p>
                <p className="text-sm text-gray-600">
                  {item.entity_name}
                  {item.entity_id ? ` (${item.entity_id.slice(0, 8)}...)` : ""}
                </p>
                <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                  {JSON.stringify(item.metadata || {}, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>

        <div className="table-container hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("created_at")} onClick={() => toggleSort("created_at")}>
                    Time <span className="text-xs">{sortIndicator("created_at")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("actor")} onClick={() => toggleSort("actor")}>
                    Actor <span className="text-xs">{sortIndicator("actor")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("action")} onClick={() => toggleSort("action")}>
                    Action <span className="text-xs">{sortIndicator("action")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  <button className={sortHeaderClass("entity")} onClick={() => toggleSort("entity")}>
                    Entity <span className="text-xs">{sortIndicator("entity")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading audit logs...</td>
                </tr>
              ) : viewItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No audit logs found</td>
                </tr>
              ) : (
                viewItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{new Date(item.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.actor_name || "System"}</p>
                      <p className="text-xs text-gray-500">{item.actor_email || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{item.action}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.entity_name}
                      {item.entity_id ? ` (${item.entity_id.slice(0, 8)}...)` : ""}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <pre className="max-w-sm overflow-auto whitespace-pre-wrap">{JSON.stringify(item.metadata || {}, null, 2)}</pre>
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
