"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import {
  getObservabilityMetrics,
  getObservabilityReady,
  getObservabilitySlo,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface AlertRow {
  key: string;
  severity: "warning" | "critical";
  message: string;
  value?: number;
  threshold?: number;
}

export default function ObservabilityPage() {
  const { isAdmin } = useAuth();
  const [internalKey, setInternalKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState<Record<string, unknown> | null>(null);
  const [slo, setSlo] = useState<Record<string, unknown> | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem("agora_internal_api_key") || "";
    setInternalKey(cached);
    setSavedKey(cached);
  }, []);

  const activeKey = useMemo(() => savedKey || internalKey, [savedKey, internalKey]);

  const loadData = useCallback(async () => {
    if (!activeKey) {
      setMessage("Enter internal API key first.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const [metricsRes, readyRes, sloRes] = await Promise.all([
        getObservabilityMetrics(activeKey),
        getObservabilityReady(activeKey),
        getObservabilitySlo(activeKey),
      ]);

      setMetrics(metricsRes.data as Record<string, unknown>);
      setReady(readyRes.data as Record<string, unknown>);
      const sloData = sloRes.data as Record<string, unknown>;
      setSlo(sloData);
      setAlerts((sloData.alerts as AlertRow[]) || []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load observability data");
      setMetrics(null);
      setReady(null);
      setSlo(null);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [activeKey]);

  function saveKey() {
    if (!internalKey.trim()) {
      setMessage("Please enter a valid internal API key.");
      return;
    }
    localStorage.setItem("agora_internal_api_key", internalKey.trim());
    setSavedKey(internalKey.trim());
    setMessage("Internal key saved for this browser.");
  }

  if (!isAdmin) {
    return (
      <>
        <Header title="Observability" />
        <div className="p-6">
          <div className="card py-12 text-center">
            <p className="text-gray-500">Only school admins can access observability tools.</p>
          </div>
        </div>
      </>
    );
  }

  const uptimeSeconds = Number((metrics?.uptime_seconds as number) || 0);
  const requestsTotal = Number((metrics?.requests as { total?: number })?.total || 0);
  const errorTotal = Number((metrics?.errors as { total?: number })?.total || 0);
  const errorBudget = Number(
    ((slo?.slo as { error_budget_remaining_percent?: number })?.error_budget_remaining_percent as number) || 0
  );
  const queueDepth = Number(
    (((slo?.workers as { notifications?: { queued_count?: number } })?.notifications?.queued_count as number) || 0)
  );

  return (
    <>
      <Header title="Observability" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("saved") ? "border border-green-200 bg-green-50 text-green-700" : "border border-red-200 bg-red-50 text-red-700"}`}>
            {message}
          </div>
        )}

        <div className="card mb-6">
          <h3 className="mb-3 text-lg font-semibold">Internal API Key</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[320px] flex-1">
              <label className="label-text">X-Internal-Api-Key</label>
              <input
                type="password"
                className="input-field"
                placeholder="Paste internal key"
                value={internalKey}
                onChange={(e) => setInternalKey(e.target.value)}
              />
            </div>
            <button className="btn-secondary" onClick={saveKey}>
              Save Key
            </button>
            <button className="btn-primary" onClick={loadData} disabled={loading || !activeKey}>
              {loading ? "Refreshing..." : "Refresh Metrics"}
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="card">
            <p className="text-sm text-gray-500">Ready</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {(ready?.ready as boolean) ? "Yes" : "No"}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Uptime (s)</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{uptimeSeconds}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Requests</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{requestsTotal}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Errors</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{errorTotal}</p>
          </div>
          <div className="card">
            <p className="text-sm text-gray-500">Error Budget Left</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{errorBudget}%</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-lg font-semibold">Worker Queue</h3>
            <p className="text-sm text-gray-600">
              Notification queued count: <strong>{queueDepth}</strong>
            </p>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify((slo?.workers as { notifications?: unknown })?.notifications || {}, null, 2)}
            </pre>
          </div>

          <div className="card">
            <h3 className="mb-3 text-lg font-semibold">SLO Snapshot</h3>
            <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify(slo?.slo || {}, null, 2)}
            </pre>
          </div>
        </div>

        <div className="card mb-6">
          <h3 className="mb-3 text-lg font-semibold">Active Alerts</h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-gray-500">No active alerts.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert, idx) => (
                <div
                  key={`${alert.key}-${idx}`}
                  className={`rounded-lg border p-3 ${
                    alert.severity === "critical"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-yellow-200 bg-yellow-50 text-yellow-700"
                  }`}
                >
                  <p className="text-sm font-semibold uppercase">{alert.severity} - {alert.key}</p>
                  <p className="text-sm">{alert.message}</p>
                  {typeof alert.value === "number" && typeof alert.threshold === "number" && (
                    <p className="text-xs">value: {alert.value} | threshold: {alert.threshold}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-lg font-semibold">Raw Metrics</h3>
          <pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
            {JSON.stringify(metrics || {}, null, 2)}
          </pre>
        </div>
      </div>
    </>
  );
}
