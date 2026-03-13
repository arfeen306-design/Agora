import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

function TutorConfigPanel({ config, onSave }) {
  const [enabled, setEnabled] = useState(config?.is_enabled ?? false);
  const [difficulty, setDifficulty] = useState(config?.difficulty_level ?? 'adaptive');
  const [maxMsg, setMaxMsg] = useState(config?.max_messages_per_session ?? 50);
  const [maxSessions, setMaxSessions] = useState(config?.max_sessions_per_day ?? 10);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateTutorConfig({ is_enabled: enabled, difficulty_level: difficulty, max_messages_per_session: Number(maxMsg), max_sessions_per_day: Number(maxSessions) });
      onSave?.();
    } catch(err) { alert(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div><div className="card-title">⚙️ Tutor Configuration</div><div className="card-sub">Control AI tutor behavior for this school</div></div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>
      <div className="toggle-row">
        <div><div className="toggle-label">Enable AI Tutor</div><div className="toggle-desc">Allow students to start AI tutoring sessions</div></div>
        <label className="toggle"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span className="toggle-slider" /></label>
      </div>
      <div className="toggle-row">
        <div><div className="toggle-label">Difficulty Level</div><div className="toggle-desc">Question complexity for students</div></div>
        <select className="select" value={difficulty} onChange={e => setDifficulty(e.target.value)}>
          {['easy','medium','hard','adaptive'].map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
        </select>
      </div>
      <div className="toggle-row">
        <div><div className="toggle-label">Max Messages / Session</div><div className="toggle-desc">Upper limit per conversation</div></div>
        <input type="number" className="select" value={maxMsg} onChange={e => setMaxMsg(e.target.value)} min={5} max={200} style={{ width: 80 }} />
      </div>
      <div className="toggle-row">
        <div><div className="toggle-label">Max Sessions / Day</div><div className="toggle-desc">Per student daily cap</div></div>
        <input type="number" className="select" value={maxSessions} onChange={e => setMaxSessions(e.target.value)} min={1} max={100} style={{ width: 80 }} />
      </div>
    </div>
  );
}

export default function Tutor() {
  const [config, setConfig] = useState(null);
  const [usage, setUsage] = useState(null);
  const [trends, setTrends] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [period, setPeriod] = useState('daily');
  const [loading, setLoading] = useState(true);

  async function load() {
    const [c, u, t, l, s] = await Promise.allSettled([
      api.tutorConfig(), api.tutorUsage(),
      api.tutorTrends(period, 30), api.tutorLeaderboard(30), api.tutorAdminSessions({ page_size: 10 })
    ]);
    if (c.status === 'fulfilled') setConfig(c.value);
    if (u.status === 'fulfilled') setUsage(u.value);
    if (t.status === 'fulfilled') setTrends(t.value);
    if (l.status === 'fulfilled') setLeaderboard(l.value);
    if (s.status === 'fulfilled') setSessions(s.value);
    setLoading(false);
  }

  useEffect(() => { load(); }, [period]);

  async function terminate(id) {
    if (!confirm('Force-terminate this session?')) return;
    try { await api.terminateSession(id); load(); } catch(err) { alert(err.message); }
  }

  const chartData = (trends?.trends || []).slice(0,14).reverse().map(d => ({
    day: new Date(d.period_start).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    sessions: d.sessions, students: d.unique_students, tokens: d.tokens_used,
  }));

  if (loading) return <div className="spinner" />;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">🤖 AI Tutor</div>
        <div className="page-desc">Configure, monitor and moderate the AI tutoring system</div>
      </div>

      <div className="stat-grid">
        {[
          { icon: '📚', label: 'Sessions (Month)', value: usage?.stats?.total_sessions ?? 0, color: 'accent' },
          { icon: '👤', label: 'Unique Students', value: usage?.stats?.unique_students ?? 0, color: 'teal' },
          { icon: '💬', label: 'Messages', value: usage?.stats?.total_messages ?? 0, color: 'amber' },
          { icon: '📖', label: 'Subjects Used', value: usage?.stats?.subjects_used ?? 0, color: 'green' },
        ].map(s => (
          <div key={s.label} className={`stat-card ${s.color}`}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <TutorConfigPanel config={config} onSave={load} />

      <div className="card">
        <div className="card-header">
          <div><div className="card-title">📈 Engagement Trends</div></div>
          <div className="tab-row">
            {['daily','weekly','monthly'].map(p => (
              <button key={p} className={`tab${period===p?' active':''}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        </div>
        {chartData.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#161c2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sessions" stroke="#6366f1" strokeWidth={2} dot={false} name="Sessions" />
                <Line type="monotone" dataKey="students" stroke="#14b8a6" strokeWidth={2} dot={false} name="Students" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">No data yet</div></div>}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div className="card-title">🏆 Student Leaderboard</div></div>
          {leaderboard?.top_students?.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Student</th><th>Sessions</th><th>Subjects</th></tr></thead>
                <tbody>
                  {leaderboard.top_students.slice(0,8).map((s,i) => (
                    <tr key={s.student_id}>
                      <td><span className={`badge badge-${i<3?'amber':'muted'}`}>{i+1}</span></td>
                      <td>{s.first_name} {s.last_name}</td>
                      <td><strong>{s.session_count}</strong></td>
                      <td>{s.subjects_explored}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><div className="empty-icon">🏆</div><div className="empty-text">No data yet</div></div>}
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">🔥 Top Subjects</div></div>
          {leaderboard?.top_subjects?.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Subject</th><th>Sessions</th><th>Students</th></tr></thead>
                <tbody>
                  {leaderboard.top_subjects.slice(0,8).map(s => (
                    <tr key={s.subject_name}>
                      <td>{s.subject_name}</td>
                      <td><strong>{s.session_count}</strong></td>
                      <td>{s.unique_students}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><div className="empty-icon">📖</div><div className="empty-text">No subjects yet</div></div>}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">🗂️ Active Sessions</div><div className="stat-sub">{sessions?.pagination?.total_items ?? 0} total</div></div>
        {sessions?.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Topic</th><th>Messages</th><th>Status</th><th>Started</th><th></th></tr></thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td>{s.student_first} {s.student_last}</td>
                    <td>{s.topic || <span style={{color:'var(--muted)'}}>General</span>}</td>
                    <td>{s.message_count}</td>
                    <td><span className={`badge badge-${s.status==='active'?'green':s.status==='closed'?'muted':'amber'}`}>{s.status}</span></td>
                    <td style={{color:'var(--muted)'}}>{new Date(s.started_at).toLocaleDateString()}</td>
                    <td>{s.status==='active' && <button className="btn btn-danger btn-sm" onClick={() => terminate(s.id)}>Terminate</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><div className="empty-icon">🗂️</div><div className="empty-text">No sessions yet</div><div className="empty-sub">Sessions will appear here once students start chatting</div></div>}
      </div>
    </div>
  );
}
