import { useState } from 'react';
import { api, saveAuth } from '../api';

export default function Login({ onLogin }) {
  const [schoolCode, setSchoolCode] = useState('TEST001');
  const [email, setEmail] = useState('admin@test.com');
  const [password, setPassword] = useState('Test@1234');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await api.login(schoolCode, email, password);
      saveAuth(data.access_token, data.user);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">Agora<span>.</span></div>
        <div className="login-sub">School Management Platform — Admin Dashboard</div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>School Code</label>
            <input value={schoolCode} onChange={e => setSchoolCode(e.target.value)} placeholder="e.g. TEST001" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@school.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : '🔐 Sign In'}
          </button>
          {error && <div className="error-msg">{error}</div>}
        </form>
      </div>
    </div>
  );
}
