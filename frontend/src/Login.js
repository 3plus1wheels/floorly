import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import FloorlyLogo from './FloorlyLogo';
import './Auth.css';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username, password);
    
    if (!result.success) {
      setError(result.error || 'Login failed. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-logo-wrap">
          <FloorlyLogo size="sm" color="var(--color-primary)" />
        </div>
        <div className="auth-card-title-row">
          <ShieldCheck className="auth-card-icon" />
          <h2>Sign In</h2>
        </div>
        <p className="auth-subtitle">Access your daily zone strategy and team performance dashboard.</p>
        {error && (
          <div className="error-message">
            <AlertCircle />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
            />
            <div className="auth-helper">Use the username assigned to your Floorly account.</div>
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
            <div className="auth-helper">Passwords are case-sensitive.</div>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="toggle-text">Need access? Contact your Floorly administrator.</p>
      </div>
    </div>
  );
}

export default Login;
