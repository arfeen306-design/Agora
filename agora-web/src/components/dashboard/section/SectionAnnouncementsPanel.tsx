import type { SectionAnnouncementItem } from "./types";

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Schedule unavailable";
  return parsed.toLocaleString();
}

export default function SectionAnnouncementsPanel({
  rows,
}: {
  rows: SectionAnnouncementItem[];
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Section Announcements</h3>
      <p className="mt-1 text-sm text-gray-500">Recent communication relevant to this section.</p>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
            No section announcements yet.
          </div>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="rounded-lg border border-cyan-100 bg-cyan-50/60 p-3">
              <p className="text-sm font-semibold text-gray-900">{row.title}</p>
              <p className="mt-1 text-xs text-cyan-700">
                {row.eventType} {row.classroomLabel ? `• ${row.classroomLabel}` : ""}
              </p>
              {row.description && <p className="mt-1 text-xs text-gray-600">{row.description}</p>}
              <p className="mt-1 text-xs text-gray-500">{formatDateTime(row.startsAt)}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
