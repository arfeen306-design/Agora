import { useState, useEffect } from 'react';
import './index.css';
import { getStoredUser, clearAuth } from './api';
import Login from './pages/Login';
import Home from './pages/Home';
import Tutor from './pages/Tutor';
import Notifications from './pages/Notifications';
import Mobile from './pages/Mobile';

const PAGES = [
  { id: 'home',          icon: '🏠', label: 'Dashboard',      section: 'Overview' },
  { id: 'tutor',         icon: '🤖', label: 'AI Tutor',        section: 'Modules' },
  { id: 'notifications', icon: '🔔', label: 'Notifications',   section: 'Modules' },
  { id: 'mobile',        icon: '📱', label: 'Mobile App',      section: 'Modules' },
];

function PageTitles(page) {
  const map = {
    home: ['Dashboard', 'Overview of your Agora LMS'],
    tutor: ['AI Tutor', 'Configure and monitor the AI tutoring system'],
    notifications: ['Notifications', 'Analytics, delivery log and templates'],
    mobile: ['Mobile App', 'App configuration and endpoints'],
  };
  return map[page] || ['', ''];
}

function Sidebar({ page, setPage, user, onLogout }) {
  const sections = [...new Set(PAGES.map(p => p.section))];
  return (
    <div className="sidebar">
      <div className="sidebar-logo">Agora<span>.</span></div>
      {sections.map(section => (
        <div key={section} className="sidebar-section">
          <div className="sidebar-label">{section}</div>
          {PAGES.filter(p => p.section === section).map(p => (
            <button
              key={p.id}
              className={`nav-item${page === p.id ? ' active' : ''}`}
              onClick={() => setPage(p.id)}
            >
              <span className="icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      ))}
      <div className="sidebar-footer">
        <div className="user-pill">
          <div className="user-avatar">{user?.first_name?.[0]}{user?.last_name?.[0]}</div>
          <div>
            <div className="user-name">{user?.first_name} {user?.last_name}</div>
            <div className="user-role">{user?.roles?.[0] || 'admin'}</div>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Logout">⏻</button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ page }) {
  const [title, sub] = PageTitles(page);
  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-sub">{sub}</div>
      </div>
      <div className="status-pill">
        <span className="status-dot" />
        API Live
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [page, setPage] = useState('home');

  function handleLogin(u) { setUser(u); }
  function handleLogout() { clearAuth(); setUser(null); setPage('home'); }

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="layout">
      <Sidebar page={page} setPage={setPage} user={user} onLogout={handleLogout} />
      <div className="main">
        <TopBar page={page} />
        {page === 'home'          && <Home user={user} />}
        {page === 'tutor'         && <Tutor />}
        {page === 'notifications' && <Notifications />}
        {page === 'mobile'        && <Mobile />}
      </div>
    </div>
  );
}
