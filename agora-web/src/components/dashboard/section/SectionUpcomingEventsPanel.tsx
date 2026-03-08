import Link from "next/link";

import type { SectionEventItem } from "./types";

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Schedule unavailable";
  return parsed.toLocaleString();
}

export default function SectionUpcomingEventsPanel({
  rows,
}: {
  rows: SectionEventItem[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Upcoming Section Events</h3>
        <Link href="/dashboard/events" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          All Events
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
          No upcoming section events in the next two weeks.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="text-sm font-semibold text-gray-900">{row.title}</p>
              <p className="mt-1 text-xs text-emerald-700">
                {row.eventType} {row.classroomLabel ? `• ${row.classroomLabel}` : ""}
              </p>
              <p className="mt-1 text-xs text-gray-500">{formatDateTime(row.startsAt)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
