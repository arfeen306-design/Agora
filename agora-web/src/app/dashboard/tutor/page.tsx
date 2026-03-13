"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getTutorConfig,
  getTutorSessions,
  createTutorSession,
  type TutorSession,
  type TutorConfig,
} from "@/lib/api";
import { getLookupSubjects, type LookupSubject } from "@/lib/api";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TutorPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [config, setConfig] = useState<TutorConfig | null>(null);
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [subjects, setSubjects] = useState<LookupSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s, sub] = await Promise.allSettled([
        getTutorConfig(),
        getTutorSessions({ page_size: 20 }),
        getLookupSubjects(),
      ]);
      if (c.status === "fulfilled") setConfig(c.value);
      if (s.status === "fulfilled") setSessions(s.value.data ?? []);
      if (sub.status === "fulfilled") setSubjects(sub.value ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setError("");
    try {
      const session = await createTutorSession({
        topic: newTopic || undefined,
        subject_id: newSubject || undefined,
      });
      router.push(`/dashboard/tutor/${session.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  }

  const activeSessions = sessions.filter((s) => s.status === "active");
  const pastSessions = sessions.filter((s) => s.status !== "active");

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="AI Tutor" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Hero Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-8 mb-8 text-white shadow-xl">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-4xl">🤖</span>
              <h1 className="text-2xl font-bold">AI Tutor</h1>
            </div>
            <p className="text-violet-100 text-sm max-w-lg mb-6">
              Your personal AI tutor is ready to help you learn any subject — ask questions, explore topics, and get step-by-step explanations.
            </p>
            {config?.is_enabled !== false ? (
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-violet-700 shadow hover:bg-violet-50 transition-colors"
                onClick={() => setShowNew(true)}
              >
                ✨ Start New Session
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm text-white/80">
                ⚠️ AI Tutor is currently disabled by your school
              </div>
            )}
          </div>
          {/* Decorative blob */}
          <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-white/5" />
          <div className="absolute -right-4 -bottom-8 h-40 w-40 rounded-full bg-white/5" />
        </div>

        {/* New Session Modal */}
        {showNew && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold mb-1">Start a New Session</h2>
              <p className="text-sm text-gray-500 mb-5">Choose a subject and topic to focus your session, or start open-ended.</p>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="label-text">Subject (optional)</label>
                  <select className="input-field" value={newSubject} onChange={e => setNewSubject(e.target.value)}>
                    <option value="">Any Subject</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-text">What do you want to learn? (optional)</label>
                  <input
                    className="input-field"
                    placeholder="e.g. Quadratic equations, French Revolution…"
                    value={newTopic}
                    onChange={e => setNewTopic(e.target.value)}
                    maxLength={200}
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex gap-3 pt-1">
                  <button type="button" className="btn-secondary flex-1" onClick={() => setShowNew(false)}>Cancel</button>
                  <button type="submit" className="btn-primary flex-1" disabled={creating}>
                    {creating ? "Starting…" : "Start Session →"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Active Sessions */}
            {activeSessions.length > 0 && (
              <div className="mb-8">
                <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Active Sessions
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeSessions.map(s => (
                    <SessionCard key={s.id} session={s} onClick={() => router.push(`/dashboard/tutor/${s.id}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* Past Sessions */}
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Past Sessions</h2>
              {pastSessions.length === 0 && activeSessions.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
                  <div className="text-4xl mb-3">📚</div>
                  <p className="font-semibold text-gray-700">No sessions yet</p>
                  <p className="text-sm text-gray-500 mt-1">Start your first AI tutoring session above</p>
                </div>
              ) : pastSessions.length === 0 ? (
                <p className="text-sm text-gray-500">No completed sessions yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {pastSessions.map(s => (
                    <SessionCard key={s.id} session={s} onClick={() => router.push(`/dashboard/tutor/${s.id}`)} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session, onClick }: { session: TutorSession; onClick: () => void }) {
  const isActive = session.status === "active";
  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-violet-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isActive ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-gray">Closed</span>
            )}
            {session.subject_name && (
              <span className="badge-blue">{session.subject_name}</span>
            )}
          </div>
          <p className="font-semibold text-gray-900 truncate text-sm">
            {session.topic || "General Session"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {session.message_count} messages · {timeAgo(session.started_at)}
          </p>
          {session.summary && (
            <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{session.summary}</p>
          )}
        </div>
        <span className="text-gray-300 group-hover:text-violet-500 transition-colors text-lg">→</span>
      </div>
    </button>
  );
}
