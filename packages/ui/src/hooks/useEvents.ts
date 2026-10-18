import { useEffect, useRef } from 'react';
import { getStoredToken, getBaseUrl, getEventsTicket, ApiError } from '../lib/api';

type EventHandler = (data: unknown) => void;

interface UseEventsOptions {
  handlers: Record<string, EventHandler>;
  /** The stream opened for the first time (events sent before that never reached us). */
  onConnect?: () => void;
  onReconnect?: () => void;
  /** The server rejected our login (expired or revoked token). */
  onUnauthorized?: () => void;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;
const HEARTBEAT_MS = 8_000;
// While the API can't be reached (restarting), check again sooner so we're back quickly
const HEARTBEAT_RETRY_MS = 2_000;

export function useEvents({ handlers, onConnect, onReconnect, onUnauthorized }: UseEventsOptions) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;

  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;
    let hasConnectedBefore = false;
    // Each connect() takes a number; an older attempt that's still awaiting its ticket
    // gives up when a newer one has started
    let generation = 0;
    // Id the server gave the current stream (its first "hello" event)
    let streamId: string | null = null;

    // Exponential backoff with jitter, so clients don't stampede a restarting API.
    const scheduleRetry = () => {
      if (disposed) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS) * (0.75 + Math.random() * 0.5);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { void connect(); }, delay);
    };

    const connect = async () => {
      if (disposed) return;
      const gen = ++generation;
      streamId = null;

      let auth = '';
      try {
        const { ticket } = await getEventsTicket();
        auth = `ticket=${encodeURIComponent(ticket)}`;
      } catch (err) {
        if (disposed || gen !== generation) return;
        if (err instanceof ApiError && err.status === 401) {
          onUnauthorizedRef.current?.();
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          // Server predates tickets — fall back to the token in the URL
          auth = `token=${encodeURIComponent(getStoredToken() ?? '')}`;
        } else {
          scheduleRetry(); // API unreachable / restarting
          return;
        }
      }
      if (disposed || gen !== generation) return;

      const es = new EventSource(`${getBaseUrl()}/api/events?${auth}`);
      source = es;

      es.addEventListener('hello', ((e: MessageEvent) => {
        if (source !== es) return;
        try {
          streamId = (JSON.parse(e.data) as { streamId?: string }).streamId ?? null;
        } catch {
          streamId = null;
        }
      }) as EventListener);

      // Register one listener per handler key. Listeners delegate to handlersRef so they
      // always call the latest handler without being removed and re-added.
      const registeredTypes = new Set<string>();
      const syncListeners = () => {
        for (const key of Object.keys(handlersRef.current)) {
          if (!registeredTypes.has(key)) {
            registeredTypes.add(key);
            es.addEventListener(key, ((e: MessageEvent) => {
              handlersRef.current[key]?.(JSON.parse(e.data));
            }) as EventListener);
          }
        }
      };
      syncListeners();
      // Re-sync periodically in case new handlers are added after mount
      clearInterval(syncInterval);
      syncInterval = setInterval(syncListeners, 2000);

      es.onopen = () => {
        if (source !== es) return;
        attempt = 0;
        if (hasConnectedBefore) {
          // Reconnected after a drop — caller re-syncs state it may have missed
          onReconnectRef.current?.();
        } else {
          // The stream opens a ticket round trip after the page loaded its state, so
          // events in between (e.g. our own room join on page load) were missed
          onConnectRef.current?.();
        }
        hasConnectedBefore = true;
      };

      es.onerror = () => {
        // Reconnect ourselves with a fresh ticket: EventSource's built-in retry reuses
        // the same (single-use) URL, and it gives up for good on any non-200 response
        // — e.g. the 502 nginx returns while the API restarts.
        es.close();
        if (source !== es) return;
        source = null;
        streamId = null;
        clearInterval(syncInterval);
        scheduleRetry();
      };
    };

    /** Our stream is gone server-side though the browser still thinks it's open: open a new one now. */
    const reopen = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      clearInterval(syncInterval);
      source?.close();
      source = null;
      streamId = null;
      attempt = 0;
      void connect();
    };

    void connect();

    // Heartbeat: lets the server detect stale connections quickly (if the SSE drops and no
    // heartbeat has arrived recently, it skips the 15 s grace period), and tells us whether
    // the server still knows our stream. After an API restart it doesn't — and Safari can
    // keep a dead stream "open" for a long time — so we reopen it as soon as the API is back.
    const heartbeat = async () => {
      let next = HEARTBEAT_MS;
      const token = getStoredToken();
      if (token) {
        const sent = streamId;
        try {
          const res = await fetch(`${getBaseUrl()}/api/events/ping${sent ? `?stream=${encodeURIComponent(sent)}` : ''}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (res.ok) {
            const body = await res.json().catch(() => null) as { stream?: boolean | null } | null;
            if (sent && sent === streamId && body?.stream === false) reopen();
          } else if (res.status >= 500) {
            next = HEARTBEAT_RETRY_MS;
          }
        } catch {
          next = HEARTBEAT_RETRY_MS; // unreachable
        }
      }
      if (!disposed) heartbeatTimer = setTimeout(() => { void heartbeat(); }, next);
    };
    heartbeatTimer = setTimeout(() => { void heartbeat(); }, HEARTBEAT_MS);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(heartbeatTimer);
      clearInterval(syncInterval);
      source?.close();
    };
  }, []);
}
