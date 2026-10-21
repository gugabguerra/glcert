import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

import { User } from '../types/user';
import { markSignedIn } from '../utils/twoFactorReminder';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface AuthContextType {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isSetupComplete: boolean | null;
  login: (token: string, user?: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setSetupComplete: (complete: boolean) => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isSetupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logoutRef = useRef<() => void>(() => {});

  useEffect(() => {
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => {
        setSetupComplete(data.setupComplete);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const logout = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  }, [token]);

  logoutRef.current = logout;

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      logoutRef.current();
    }, IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    if (!token) return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => document.addEventListener(e, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      events.forEach((e) => document.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [token, resetIdleTimer]);

  const login = useCallback((newToken: string, newUser?: User) => {
    localStorage.setItem('auth_token', newToken);
    // Lets the signed-in shell show the two-factor reminder once for this sign-in.
    markSignedIn();
    setToken(newToken);
    if (newUser) {
      localStorage.setItem('auth_user', JSON.stringify(newUser));
      setUser(newUser);
    }
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  );

  // Keep the stored copy in step, so a renamed user or a two-factor change survives a reload.
  const updateUser = useCallback((next: User) => {
    localStorage.setItem('auth_user', JSON.stringify(next));
    setUser(next);
  }, []);

  const value = {
    token,
    user,
    isAuthenticated: !!token,
    isSetupComplete,
    login,
    logout,
    setUser: updateUser,
    setSetupComplete,
    hasRole,
  };

  if (loading) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
