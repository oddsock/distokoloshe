import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';

interface AuthState {
  user: api.User | null;
  initialized: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    initialized: false,
    isLoading: true,
    error: null,
  });

  // Validate stored token on mount
  useEffect(() => {
    const token = api.getStoredToken();
    if (!token) {
      setState({ user: null, initialized: true, isLoading: false, error: null });
      return;
    }

    api
      .getMe()
      .then(({ user }) => setState({ user, initialized: true, isLoading: false, error: null }))
      .catch(() => {
        api.clearStoredToken();
        setState({ user: null, initialized: true, isLoading: false, error: null });
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setState((s) => ({ ...s, error: null, isLoading: true }));
    try {
      const res = await api.login(username, password);
      api.setStoredToken(res.token);
      setState({ user: res.user, initialized: true, isLoading: false, error: null });
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : 'Login failed';
      setState((s) => ({ ...s, isLoading: false, error: msg }));
    }
  }, []);

  const register = useCallback(
    async (username: string, displayName: string, password: string) => {
      setState((s) => ({ ...s, error: null, isLoading: true }));
      try {
        const res = await api.register(username, displayName, password);
        api.setStoredToken(res.token);
        setState({ user: res.user, initialized: true, isLoading: false, error: null });
      } catch (err) {
        const msg = err instanceof api.ApiError ? err.message : 'Registration failed';
        setState((s) => ({ ...s, isLoading: false, error: msg }));
      }
    },
    [],
  );

  const logout = useCallback(() => {
    api.clearStoredToken();
    setState({ user: null, initialized: true, isLoading: false, error: null });
  }, []);

  return { ...state, login, register, logout };
}
