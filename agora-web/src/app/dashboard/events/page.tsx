"use client";

import { useEffect, useState, useCallback } from "react";
import Header from "@/components/Header";
import { getEvents, createEvent } from "@/lib/api";

interface SchoolEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string | null;
  target_scope: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    event_type: "general",
    starts_at: "",
    ends_at: "",
    target_scope: "school",
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEvents({ page: String(page), page_size: "20" });
      setEvents(res.data as SchoolEvent[]);
      setTotalPages(res.meta?.pagination?.total_pages ?? 1);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  async function handleCreate() {
    if (!formData.title || !formData.starts_at) return;
    setSubmitting(true);
    setMessage("");
    try {
      await createEvent({
        title: formData.title,
        description: formData.description || undefined,
        event_type: formData.event_type,
        starts_at: new Date(formData.starts_at).toISOString(),
        ends_at: formData.ends_at ? new Date(formData.ends_at).toISOString() : undefined,
        target_scope: formData.target_scope,
      });
      setMessage("Event created!");
      setFormData({ title: "", description: "", event_type: "general", starts_at: "", ends_at: "", target_scope: "school" });
      setShowForm(false);
      loadEvents();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-PK", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
  }

  const typeBadge = (type: string) => {
    const map: Record<string, string> = {
      general: "badge-blue",
      holiday: "badge-green",
      exam: "badge-red",
      meeting: "badge-yellow",
      sports: "badge-green",
      cultural: "badge-blue",
    };
    return <span className={map[type] || "badge-gray"}>{type}</span>;
  };

  return (
    <>
      <Header title="Events" />
      <div className="p-6">
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${message.includes("created") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-500">School events and calendar</p>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Create Event"}
          </button>
        </div>

        {showForm && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold mb-4">New Event</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label-text">Title *</label>
                <input type="text" className="input-field" placeholder="Event title" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div>
                <label className="label-text">Type</label>
                <select className="input-field" value={formData.event_type} onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}>
                  <option value="general">General</option>
                  <option value="holiday">Holiday</option>
                  <option value="exam">Exam</option>
                  <option value="meeting">Meeting</option>
                  <option value="sports">Sports</option>
                  <option value="cultural">Cultural</option>
                </select>
              </div>
              <div>
                <label className="label-text">Scope</label>
                <select className="input-field" value={formData.target_scope} onChange={(e) => setFormData({ ...formData, target_scope: e.target.value })}>
                  <option value="school">Whole School</option>
                  <option value="classroom">Specific Class</option>
                </select>
              </div>
              <div>
                <label className="label-text">Start Date & Time *</label>
                <input type="datetime-local" className="input-field" value={formData.starts_at} onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })} />
              </div>
              <div>
                <label className="label-text">End Date & Time</label>
                <input type="datetime-local" className="input-field" value={formData.ends_at} onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })} />
              </div>
            </div>
            <div className="mb-4">
              <label className="label-text">Description</label>
              <textarea className="input-field" rows={2} placeholder="Event details..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Event"}
            </button>
          </div>
        )}

        {/* Events Grid */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading events...</div>
        ) : events.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-400">No events found. Create your first event!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((event) => (
              <div key={event.id} className="card hover:border-primary-200 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{event.title}</h3>
                  {typeBadge(event.event_type)}
                </div>
                {event.description && (
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{event.description}</p>
                )}
                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>{formatDate(event.starts_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      {formatTime(event.starts_at)}
                      {event.ends_at && ` - ${formatTime(event.ends_at)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    </svg>
                    <span className="capitalize">{event.target_scope}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
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
