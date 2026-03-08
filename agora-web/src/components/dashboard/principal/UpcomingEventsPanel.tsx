import Link from "next/link";

import type { PrincipalEventItem } from "./types";

function formatEventDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Schedule unavailable";
  return parsed.toLocaleString();
}

export default function UpcomingEventsPanel({ events }: { events: PrincipalEventItem[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Upcoming Events</h3>
        <Link href="/dashboard/events" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
          All Events
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
          No upcoming events in the next two weeks.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <article key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{event.title}</p>
              <p className="mt-1 text-xs text-gray-600">
                {event.eventType || "school_event"} • {event.targetScope || "school"}
              </p>
              <p className="mt-1 text-xs text-gray-500">{formatEventDate(event.startsAt)}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
