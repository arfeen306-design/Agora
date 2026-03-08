import Link from "next/link";

import type { PrincipalAlert } from "./types";

const variantClasses = {
  danger: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
} as const;

export default function PriorityAlertsPanel({ alerts }: { alerts: PrincipalAlert[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Priority Alerts</h3>
        <Link href="/dashboard/reports" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          View Reports
        </Link>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
          No critical alerts right now. School health is stable.
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <article key={alert.id} className={`rounded-lg border p-3 ${variantClasses[alert.severity]}`}>
              <p className="text-sm font-semibold">{alert.title}</p>
              <p className="mt-1 text-xs">{alert.message}</p>
              {alert.href && alert.actionLabel && (
                <Link href={alert.href} className="mt-2 inline-flex text-xs font-semibold underline">
                  {alert.actionLabel}
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
