import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import API_BASE from './config';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(() => localStorage.getItem('organization_id') || '');

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('organization_id');
    setUser(null);
    setSelectedOrganizationId('');
  }, []);

  const fetchUser = useCallback(async (token) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/user/`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data);
        const saved = localStorage.getItem('organization_id');
        const selected = data.organizations?.some(org => String(org.id) === saved)
          ? saved : String(data.organizations?.[0]?.id || '');
        setSelectedOrganizationId(selected);
        if (selected) localStorage.setItem('organization_id', selected);
        else localStorage.removeItem('organization_id');
      } else {
        logout();
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    // Check if user is logged in on mount
    const token = localStorage.getItem('access_token');
    if (token) {
      fetchUser(token);
    } else {
      setLoading(false);
    }
  }, [fetchUser]);

  const login = async (username, password) => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Login failed');
      }

      const data = await response.json();
      localStorage.setItem('access_token', data.access);
      localStorage.setItem('refresh_token', data.refresh);
      await fetchUser(data.access);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const selectOrganization = (id) => {
    const value = String(id || '');
    setSelectedOrganizationId(value);
    if (value) localStorage.setItem('organization_id', value);
    else localStorage.removeItem('organization_id');
  };

  const value = {
    user,
    login,
    refreshUser: () => fetchUser(localStorage.getItem('access_token')),
    selectedOrganizationId,
    selectOrganization,
    logout,
    loading,
    isAuthenticated: !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
