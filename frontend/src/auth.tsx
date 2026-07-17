import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  isSetupComplete: boolean | null;
  login: (token: string) => void;
  logout: () => void;
  setSetupComplete: (complete: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [isSetupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setSetupComplete(data.setupComplete);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const login = useCallback((newToken: string) => {
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    setToken(null);
  }, [token]);

  const value = {
    token,
    isAuthenticated: !!token,
    isSetupComplete,
    login,
    logout,
    setSetupComplete,
  };

  if (loading) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
