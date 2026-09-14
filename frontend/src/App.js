import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import LandingPage from './LandingPage';
import Login from './Login';
import Dashboard from './Dashboard';
import ChangePassword from './ChangePassword';
import './App.css';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="state-card inline">
            <LoaderCircle className="state-icon" />
            <div>
              <p className="state-title">Loading workspace</p>
              <p className="state-copy">Checking your authentication session.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return user ? (
    user.must_change_password ? <ChangePassword /> : <Dashboard />
  ) : (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
