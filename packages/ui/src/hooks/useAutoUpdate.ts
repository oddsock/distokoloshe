import { useState, useEffect, useCallback, useRef } from 'react';
import { getBaseUrl } from '../lib/api';

const AUTO_UPDATE_KEY = 'distokoloshe_auto_update';
const isTauri = () => '__TAURI_INTERNALS__' in window;

interface UpdateInfo {
  version: string;
  body: string | null;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'error';

export function getAutoUpdateEnabled(): boolean {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== 'false'; // default on
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_UPDATE_KEY, String(enabled));
}

export function useAutoUpdate() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdateState] = useState(getAutoUpdateEnabled);
  const checkedRef = useRef(false);

  const setAutoUpdate = useCallback((enabled: boolean) => {
    setAutoUpdateState(enabled);
    setAutoUpdateEnabled(enabled);
  }, []);

  const checkNow = useCallback(async () => {
    if (!isTauri()) return;

    const serverUrl = getBaseUrl();
    if (!serverUrl) return;

    setStatus('checking');
    setError(null);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<UpdateInfo | null>('check_for_update', {
        serverUrl,
      });

      if (result) {
        setUpdateInfo(result);
        setStatus('available');
      } else {
        setUpdateInfo(null);
        setStatus('idle');
      }
    } catch (err) {
      setError(String(err));
      setStatus('error');
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauri()) return;

    setStatus('downloading');
    setError(null);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_update');
      // App will restart — this line won't be reached
    } catch (err) {
      setError(String(err));
      setStatus('error');
    }
  }, []);

  // Auto-check on mount if enabled
  useEffect(() => {
    if (!isTauri() || !autoUpdate || checkedRef.current) return;
    checkedRef.current = true;
    // Delay check to let the app finish loading
    const timer = setTimeout(() => checkNow(), 3000);
    return () => clearTimeout(timer);
  }, [autoUpdate, checkNow]);

  return {
    status,
    updateInfo,
    error,
    autoUpdate,
    setAutoUpdate,
    checkNow,
    installUpdate,
    isTauri: isTauri(),
  };
}
