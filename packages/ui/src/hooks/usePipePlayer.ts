import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseUrl, getStoredToken } from '../lib/api';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export type PipeState = 'idle' | 'starting' | 'playing' | 'stopped' | 'error';

interface PipeStatePayload {
  state: PipeState;
  title?: string | null;
  error?: string | null;
}

interface PipeLogPayload {
  source: string;
  line: string;
}

export interface PipeController {
  available: boolean;
  state: PipeState;
  title: string | null;
  error: string | null;
  startUrl(roomId: number, url: string, titleHint?: string): Promise<void>;
  startFile(roomId: number): Promise<void>;
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
  const unlistenRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const offState = await listen<PipeStatePayload>('pipe://state', (event) => {
        const p = event.payload;
        setState(p.state);
        if (p.title !== undefined) setTitle(p.title ?? null);
        // Errors are sticky — keep them visible until the user starts a new
        // pipe. Otherwise the uploader's trailing "stopped" event would
        // wipe the message before the user can read it.
        if (p.error !== undefined && p.error !== null) setError(p.error);
        else if (p.state === 'starting') setError(null);
      });
      const offLog = await listen<PipeLogPayload>('pipe://log', (event) => {
        const { source, line } = event.payload;
        // Mirror sidecar stderr to the devtools console so users can paste
        // exact ffmpeg/yt-dlp errors when reporting issues.
        console.log(`[pipe:${source}] ${line.trim()}`);
      });
      if (cancelled) {
        offState();
        offLog();
        return;
      }
      unlistenRef.current = [offState, offLog];
    })().catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current.forEach((off) => off());
      unlistenRef.current = [];
    };
  }, []);

  const startUrl = useCallback(async (roomId: number, url: string, titleHint?: string) => {
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
        roomId,
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

  const startFile = useCallback(async (roomId: number) => {
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
        roomId,
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
