import { useState, useEffect, useRef } from 'react';
import { getBaseUrl } from '../lib/api';

const isTauri = () => '__TAURI_INTERNALS__' in window;

interface UpdateInfo {
  version: string;
  body: string | null;
}

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'error';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function useAutoUpdate() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const checkingRef = useRef(false);

  // Fetch app version from Tauri on mount
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        setAppVersion(await getVersion());
      } catch { /* ignore */ }
    })();
  }, []);

  // Check and auto-install update
  useEffect(() => {
    if (!isTauri()) return;

    const checkAndInstall = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;

      const serverUrl = getBaseUrl();
      if (!serverUrl) {
        checkingRef.current = false;
        return;
      }

      setStatus('checking');
      setError(null);

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<UpdateInfo | null>('check_for_update', { serverUrl });

        if (result) {
          setUpdateInfo(result);
          setStatus('downloading');
          try {
            await invoke('install_update');
            // App restarts after install — this line won't normally run
          } catch (err) {
            setError(String(err));
            setStatus('error');
          }
        } else {
          setStatus('idle');
        }
      } catch (err) {
        setError(String(err));
        setStatus('error');
      } finally {
        checkingRef.current = false;
      }
    };

    // Initial check after 3s
    const initialTimer = setTimeout(checkAndInstall, 3000);

    // Periodic re-check every 30 minutes
    const interval = setInterval(checkAndInstall, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return {
    status,
    updateInfo,
    error,
    appVersion,
    isTauri: isTauri(),
  };
}
