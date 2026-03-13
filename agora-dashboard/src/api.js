const BASE = 'http://localhost:8080/api/v1';

function getToken() {
  return localStorage.getItem('agora_token');
}

export function saveAuth(token, user) {
  localStorage.setItem('agora_token', token);
  localStorage.setItem('agora_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('agora_token');
  localStorage.removeItem('agora_user');
}

export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('agora_user')); } catch { return null; }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'API error');
  return json.data;
}

export const api = {
  // Auth
  login: (schoolCode, email, password) =>
    request('POST', '/auth/login', { school_code: schoolCode, email, password }),
  me: () => request('GET', '/auth/me'),

  // Health
  health: () => request('GET', '/health'),

  // Tutor
  tutorConfig: () => request('GET', '/tutor/config'),
  updateTutorConfig: (body) => request('PATCH', '/tutor/config', body),
  tutorUsage: () => request('GET', '/tutor/usage'),
  tutorTrends: (period = 'daily', days = 30) =>
    request('GET', `/tutor/analytics/trends?period=${period}&days=${days}`),
  tutorLeaderboard: (days = 30) =>
    request('GET', `/tutor/analytics/leaderboard?days=${days}`),
  tutorAdminSessions: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/tutor/admin/sessions${q ? '?' + q : ''}`);
  },
  terminateSession: (id) => request('POST', `/tutor/admin/sessions/${id}/terminate`),
  tutorInsights: (studentId) => request('GET', `/tutor/insights/${studentId}`),

  // Notifications
  notificationTemplates: () => request('GET', '/notifications/templates'),
  notificationAnalytics: (days = 30) =>
    request('GET', `/notifications/analytics?days=${days}`),
  deliveryLog: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/notifications/delivery-log${q ? '?' + q : ''}`);
  },

  // Mobile
  appCheck: () => request('GET', '/mobile/app-check'),
};
