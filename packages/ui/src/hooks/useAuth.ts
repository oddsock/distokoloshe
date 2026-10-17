import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';

const SESSION_EXPIRED = 'Your session expired — please sign in again';

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

  // Validate stored token on mount. Only a rejection (401/404) logs out — if the
  // server is down or restarting, keep the session and retry until it's back.
  useEffect(() => {
    const token = api.getStoredToken();
    if (!token) {
      setState({ user: null, initialized: true, isLoading: false, error: null });
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const validate = (attempt: number) => {
      api
        .getMe()
        .then(({ user }) => {
          if (!cancelled) setState({ user, initialized: true, isLoading: false, error: null });
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof api.ApiError && (err.status === 401 || err.status === 404)) {
            api.clearStoredToken();
            setState({ user: null, initialized: true, isLoading: false, error: SESSION_EXPIRED });
            return;
          }
          setState((s) => ({ ...s, error: "Can't reach the server — retrying…" }));
          retryTimer = setTimeout(() => validate(attempt + 1), Math.min(2000 * 2 ** attempt, 15_000));
        });
    };
    validate(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
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
    api.sendLeaveBeacon(); // instant leave before token is cleared
    api.clearStoredToken();
    setState({ user: null, initialized: true, isLoading: false, error: null });
  }, []);

  /** The server rejected our token mid-session — back to login with an explanation. */
  const expireSession = useCallback(() => {
    api.clearStoredToken();
    setState({ user: null, initialized: true, isLoading: false, error: SESSION_EXPIRED });
  }, []);

  return { ...state, login, register, logout, expireSession };
}
