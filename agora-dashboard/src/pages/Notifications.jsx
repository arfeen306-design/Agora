import { useEffect, useState } from 'react';
import { api } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Notifications() {
  const [templates, setTemplates] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [log, setLog] = useState(null);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('analytics');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([api.notificationTemplates(), api.notificationAnalytics(days), api.deliveryLog({ page_size: 20 })])
      .then(([t, a, l]) => {
        if (t.status === 'fulfilled') setTemplates(t.value);
        if (a.status === 'fulfilled') setAnalytics(a.value);
        if (l.status === 'fulfilled') setLog(l.value);
        setLoading(false);
      });
  }, [days]);

  const channelData = (analytics?.channel_stats || []).map(c => ({
    channel: c.channel, sent: c.sent, failed: c.failed, queued: c.queued,
  }));

  const dailyData = (analytics?.daily_volume || []).slice(0,14).reverse().map(d => ({
    day: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    total: d.total, sent: d.sent, failed: d.failed,
  }));

  const statusColor = { sent: 'green', failed: 'rose', queued: 'amber', read: 'blue' };

  if (loading) return <div className="spinner" />;

  const allTemplates = templates ? Object.entries(templates) : [];

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">🔔 Notifications</div>
        <div className="page-desc">Monitor delivery, analytics, and available templates</div>
      </div>

      <div className="stat-grid">
        {[
          { icon: '📨', label: 'Total (All Time)', value: analytics?.summary?.total_all_time ?? 0 },
          { icon: '⚡', label: 'Last 24h', value: analytics?.summary?.last_24h ?? 0, color: 'accent' },
          { icon: '📅', label: 'Last 7 Days', value: analytics?.summary?.last_7d ?? 0, color: 'teal' },
          { icon: '📋', label: 'Template Categories', value: allTemplates.length, color: 'amber' },
        ].map(s => (
          <div key={s.label} className={`stat-card ${s.color || ''}`}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="tab-row">
            {['analytics','log','templates'].map(t => (
              <button key={t} className={`tab${tab===t?' active':''}`} onClick={() => setTab(t)}>
                {t === 'analytics' ? '📊 Analytics' : t === 'log' ? '📋 Delivery Log' : '📝 Templates'}
              </button>
            ))}
          </div>
          {tab === 'analytics' && (
            <select className="select" value={days} onChange={e => setDays(Number(e.target.value))}>
              {[7,14,30,60,90].map(d => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          )}
        </div>

        {tab === 'analytics' && (
          <div>
            <div className="grid-2">
              <div>
                <div style={{ fontWeight: 700, marginBottom: 16 }}>By Channel</div>
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
                ) : <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">No data</div></div>}
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 16 }}>Daily Volume</div>
                {dailyData.length > 0 ? (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#161c2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#e2e8f0' }} />
                        <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} name="Total" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="empty"><div className="empty-icon">📅</div><div className="empty-text">No data</div></div>}
              </div>
            </div>
            {channelData.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 24 }}>
                <table>
                  <thead><tr><th>Channel</th><th>Total</th><th>Sent</th><th>Failed</th><th>Queued</th><th>Failure Rate</th></tr></thead>
                  <tbody>
                    {(analytics?.channel_stats || []).map(c => (
                      <tr key={c.channel}>
                        <td><span className="badge badge-blue">{c.channel}</span></td>
                        <td>{c.total}</td>
                        <td style={{ color: 'var(--green)' }}>{c.sent}</td>
                        <td style={{ color: 'var(--rose)' }}>{c.failed}</td>
                        <td style={{ color: 'var(--amber)' }}>{c.queued}</td>
                        <td>{c.failure_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'log' && (
          log?.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Title</th><th>Channel</th><th>Status</th><th>User</th><th>Source</th><th>Date</th></tr></thead>
                <tbody>
                  {log.map(n => (
                    <tr key={n.id}>
                      <td>{n.title}</td>
                      <td><span className="badge badge-blue">{n.channel}</span></td>
                      <td><span className={`badge badge-${statusColor[n.status] || 'muted'}`}>{n.status}</span></td>
                      <td style={{ color: 'var(--muted)' }}>{n.email || n.user_id?.slice(0,8)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{n.source || '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{new Date(n.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><div className="empty-icon">📋</div><div className="empty-text">No notifications yet</div></div>
        )}

        {tab === 'templates' && (
          allTemplates.length > 0 ? (
            <div>
              {allTemplates.map(([category, tmpl]) => (
                <div key={category} style={{ marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize', marginBottom: 10, color: 'var(--accent)' }}>
                    📂 {category}
                  </div>
                  {Object.entries(tmpl).map(([key, t]) => (
                    <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{t.body}</div>
                        </div>
                        <span className="badge badge-muted" style={{ flexShrink: 0 }}>{t.channel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : <div className="empty"><div className="empty-icon">📝</div><div className="empty-text">No templates</div></div>
        )}
      </div>
    </div>
  );
}
