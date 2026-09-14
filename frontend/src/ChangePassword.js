import React, { useState } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import API_BASE from './config';
import { useAuth } from './AuthContext';
import FloorlyLogo from './FloorlyLogo';
import './Auth.css';

export default function ChangePassword() {
  const [form, setForm] = useState({ current_password: '', new_password: '', new_password2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refreshUser, logout } = useAuth();
  const submit = async event => {
    event.preventDefault();
    setError('');
    if (form.new_password !== form.new_password2) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/change-password/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Object.values(data).flat().join(' ') || 'Password change failed.');
      await refreshUser();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <div className="auth-container"><div className="auth-card">
    <div className="auth-logo-wrap"><FloorlyLogo size="sm" color="var(--color-primary)" /></div>
    <div className="auth-card-title-row"><KeyRound className="auth-card-icon" /><h2>Change Password</h2></div>
    <p className="auth-subtitle">Temporary password must be replaced before continuing.</p>
    {error && <div className="error-message" role="alert"><AlertCircle /><span>{error}</span></div>}
    <form onSubmit={submit}>
      {[['current_password', 'Temporary Password'], ['new_password', 'New Password'], ['new_password2', 'Confirm New Password']].map(([name, label]) =>
        <div className="form-group" key={name}><label htmlFor={name}>{label}</label><input id={name} name={name} type="password" required disabled={busy} autoComplete={name === 'current_password' ? 'current-password' : 'new-password'} value={form[name]} onChange={e => setForm({...form, [name]: e.target.value})} /></div>
      )}
      <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Change Password'}</button>
    </form>
    <p className="toggle-text"><button type="button" className="toggle-link" onClick={logout}>Sign out</button></p>
  </div></div>;
}
