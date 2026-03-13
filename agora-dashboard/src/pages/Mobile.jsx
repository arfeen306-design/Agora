import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Mobile() {
  const [appCheck, setAppCheck] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.appCheck()
      .then(setAppCheck)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="spinner" />;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">📱 Mobile App</div>
        <div className="page-desc">App configuration, version control and device management</div>
      </div>

      <div className="card">
        <div className="card-header">
          <div><div className="card-title">📦 App Configuration</div><div className="card-sub">Current mobile app settings for this school</div></div>
        </div>
        {appCheck ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { label: 'Min Version', value: appCheck.min_version, icon: '📌' },
              { label: 'Latest Version', value: appCheck.latest_version, icon: '🆕' },
              { label: 'Force Update', value: appCheck.force_update ? '⚠️ Yes' : '✓ No', icon: '🔄', color: appCheck.force_update ? 'var(--rose)' : 'var(--green)' },
              { label: 'Maintenance Mode', value: appCheck.maintenance_mode ? '🔴 On' : '🟢 Off', icon: '🛠️', color: appCheck.maintenance_mode ? 'var(--rose)' : 'var(--green)' },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>{item.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: item.color || 'var(--text)' }}>{item.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">📱</div>
            <div className="empty-text">No app config found</div>
            <div className="empty-sub">Default settings are being used</div>
          </div>
        )}
        {(appCheck?.app_store_url || appCheck?.play_store_url) && (
          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            {appCheck.app_store_url && <a href={appCheck.app_store_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">🍎 App Store</a>}
            {appCheck.play_store_url && <a href={appCheck.play_store_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">🤖 Play Store</a>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">🔌 Available Mobile Endpoints</div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Method</th><th>Endpoint</th><th>Role</th><th>Description</th></tr></thead>
            <tbody>
              {[
                ['POST', '/mobile/devices', 'any', 'Register push notification device'],
                ['DELETE', '/mobile/devices', 'any', 'Unregister device'],
                ['GET', '/mobile/sync/parent', 'parent', 'Parent badge counts & alerts'],
                ['GET', '/mobile/sync/student', 'student', 'Student daily snapshot + tutor status'],
                ['GET', '/mobile/feed', 'parent/student', 'Unified notification + event feed'],
                ['GET', '/mobile/child/:id/discipline', 'parent', 'Child discipline incidents'],
                ['GET', '/mobile/child/:id/transport', 'parent', 'Child transport assignment'],
                ['GET', '/mobile/child/:id/report-cards', 'parent', 'Child report cards'],
                ['GET', '/mobile/child/:id/tutor-quick', 'parent', 'Child AI tutor summary'],
                ['GET', '/mobile/student/discipline', 'student', 'Own discipline records'],
                ['GET', '/mobile/student/transport', 'student', 'Own transport info'],
                ['GET', '/mobile/student/report-cards', 'student', 'Own report cards'],
                ['GET', '/mobile/student/tutor-quick', 'student', 'Own AI tutor status'],
                ['GET', '/mobile/app-check', 'any', 'App version & maintenance check'],
              ].map(([method, path, role, desc]) => (
                <tr key={path+method}>
                  <td><span className={`badge badge-${method==='GET'?'blue':'green'}`}>{method}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{path}</td>
                  <td><span className="badge badge-muted">{role}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
