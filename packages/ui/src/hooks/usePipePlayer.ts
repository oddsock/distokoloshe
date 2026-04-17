import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl, getStoredToken } from '../lib/api';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export type PipeState = 'idle' | 'starting' | 'playing' | 'stopped' | 'error';

interface PipeStatePayload {
  state: PipeState;
  title?: string | null;
  error?: string | null;
}

export interface PipeController {
  available: boolean;
  state: PipeState;
  title: string | null;
  error: string | null;
  startUrl(url: string, titleHint?: string): Promise<void>;
  startFile(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Drives the desktop client's Rust-side pipe (ffmpeg + WS upload).
 * No-op on web — `available` will be false.
 */
export function usePipePlayer(): PipeController {
  const [state, setState] = useState<PipeState>('idle');
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen<PipeStatePayload>('pipe://state', (event) => {
        const p = event.payload;
        setState(p.state);
        if (p.title !== undefined) setTitle(p.title ?? null);
        if (p.error !== undefined) setError(p.error ?? null);
        else if (p.state !== 'error') setError(null);
      });
      if (cancelled) {
        off();
        return;
      }
      unlistenRef.current = off;
    })().catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const startUrl = useCallback(async (url: string, titleHint?: string) => {
    if (!isTauri()) throw new Error('Not running in desktop client');
    const token = getStoredToken();
    if (!token) throw new Error('Not signed in');
    const serverUrl = getBaseUrl() || window.location.origin;
    setError(null);
    setState('starting');
    setTitle(titleHint ?? null);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const resolved = await invoke<string>('pipe_start', {
        serverUrl,
        token,
        kind: 'url',
        source: url,
        titleHint: titleHint ?? null,
      });
      setTitle(resolved);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const startFile = useCallback(async () => {
    if (!isTauri()) throw new Error('Not running in desktop client');
    const token = getStoredToken();
    if (!token) throw new Error('Not signed in');
    const serverUrl = getBaseUrl() || window.location.origin;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma'] }],
    });
    if (!picked || typeof picked !== 'string') return;
    const fileName = picked.split(/[\\/]/).pop() ?? picked;
    setError(null);
    setState('starting');
    setTitle(fileName);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke<string>('pipe_start', {
        serverUrl,
        token,
        kind: 'file',
        source: picked,
        titleHint: fileName,
      });
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const stop = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('pipe_stop');
    } catch {
      /* best effort */
    }
  }, []);

  return {
    available: isTauri(),
    state,
    title,
    error,
    startUrl,
    startFile,
    stop,
  };
}
