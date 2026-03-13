import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className={`stat-card ${color || ''}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function Home({ user }) {
  const [health, setHealth] = useState(null);
  const [usage, setUsage] = useState(null);
  const [notifAnalytics, setNotifAnalytics] = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.health(), api.tutorUsage(), api.notificationAnalytics(30), api.tutorTrends('daily', 14)
    ]).then(([h, u, n, t]) => {
      if (h.status === 'fulfilled') setHealth(h.value);
      if (u.status === 'fulfilled') setUsage(u.value);
      if (n.status === 'fulfilled') setNotifAnalytics(n.value);
      if (t.status === 'fulfilled') setTrends(t.value);
      setLoading(false);
    });
  }, []);

  const chartData = (trends?.trends || []).slice(0, 14).reverse().map(d => ({
    day: new Date(d.period_start).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    sessions: d.sessions,
    students: d.unique_students,
    messages: d.total_messages,
  }));

  const channelData = (notifAnalytics?.channel_stats || []).map(c => ({
    channel: c.channel,
    sent: c.sent,
    failed: c.failed,
    queued: c.queued,
  }));

  if (loading) return <div className="spinner" />;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Welcome back, {user?.first_name} 👋</div>
        <div className="page-desc">Here's what's happening across your school today.</div>
      </div>

      <div className="stat-grid">
        <StatCard icon="🔗" label="API Status" value={health?.status === 'ok' ? 'Online' : 'Down'} sub={`DB: ${health?.db}`} color="green" />
        <StatCard icon="⏱️" label="Uptime" value={health ? `${Math.round(health.uptime_seconds / 60)}m` : '—'} sub="since last restart" color="accent" />
        <StatCard icon="🤖" label="Tutor Sessions" value={usage?.stats?.total_sessions ?? 0} sub="this month" color="teal" />
        <StatCard icon="📊" label="Total Messages" value={usage?.stats?.total_messages ?? 0} sub="across all sessions" color="amber" />
        <StatCard icon="🔔" label="Notifications" value={notifAnalytics?.summary?.last_7d ?? 0} sub="last 7 days" color="rose" />
        <StatCard icon="👥" label="AI Students" value={usage?.stats?.unique_students ?? 0} sub="unique users this month" />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">📈 Tutor Activity (14 days)</div>
              <div className="card-sub">Daily sessions and unique students</div>
            </div>
          </div>
          {chartData.length > 0 ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="gSessions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gStudents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#161c2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#e2e8f0' }} />
                  <Area type="monotone" dataKey="sessions" stroke="#6366f1" fill="url(#gSessions)" strokeWidth={2} name="Sessions" />
                  <Area type="monotone" dataKey="students" stroke="#14b8a6" fill="url(#gStudents)" strokeWidth={2} name="Students" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">No activity yet</div><div className="empty-sub">Start some AI tutor sessions</div></div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">🔔 Notification Channels (30d)</div>
              <div className="card-sub">Delivery breakdown by channel</div>
            </div>
          </div>
          {channelData.length > 0 ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="channel" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#161c2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sent" fill="#22c55e" radius={[4,4,0,0]} name="Sent" />
                  <Bar dataKey="failed" fill="#f43f5e" radius={[4,4,0,0]} name="Failed" />
                  <Bar dataKey="queued" fill="#f59e0b" radius={[4,4,0,0]} name="Queued" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty"><div className="empty-icon">🔔</div><div className="empty-text">No notifications yet</div><div className="empty-sub">Notifications will appear here once sent</div></div>
          )}
        </div>
      </div>

      {/* Token Budget */}
      {usage?.budget && (
        <div className="card">
          <div className="card-header"><div className="card-title">🪙 Token Budget</div></div>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Used', value: usage.budget.used?.toLocaleString(), color: 'var(--accent)' },
              { label: 'Remaining', value: usage.budget.remaining?.toLocaleString(), color: 'var(--green)' },
              { label: 'Exhausted', value: usage.budget.exhausted ? '⚠️ Yes' : '✓ No', color: usage.budget.exhausted ? 'var(--rose)' : 'var(--green)' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{item.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
