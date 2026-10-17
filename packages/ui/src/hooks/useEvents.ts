import { useEffect, useRef } from 'react';
import { getStoredToken, getBaseUrl, getEventsTicket, ApiError } from '../lib/api';

type EventHandler = (data: unknown) => void;

interface UseEventsOptions {
  handlers: Record<string, EventHandler>;
  onReconnect?: () => void;
  /** The server rejected our login (expired or revoked token). */
  onUnauthorized?: () => void;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

export function useEvents({ handlers, onReconnect, onUnauthorized }: UseEventsOptions) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncInterval: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;
    let hasConnectedBefore = false;

    // Exponential backoff with jitter, so clients don't stampede a restarting API.
    const scheduleRetry = () => {
      if (disposed) return;
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS) * (0.75 + Math.random() * 0.5);
      attempt++;
      retryTimer = setTimeout(() => { void connect(); }, delay);
    };

    const connect = async () => {
      if (disposed) return;

      let auth = '';
      try {
        const { ticket } = await getEventsTicket();
        auth = `ticket=${encodeURIComponent(ticket)}`;
      } catch (err) {
        if (disposed) return;
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
      if (disposed) return;

      const es = new EventSource(`${getBaseUrl()}/api/events?${auth}`);
      source = es;

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
        attempt = 0;
        if (hasConnectedBefore) {
          // Reconnected after a drop — caller re-syncs state it may have missed
          onReconnectRef.current?.();
        }
        hasConnectedBefore = true;
      };

      es.onerror = () => {
        // Reconnect ourselves with a fresh ticket: EventSource's built-in retry reuses
        // the same (single-use) URL, and it gives up for good on any non-200 response
        // — e.g. the 502 nginx returns while the API restarts.
        es.close();
        if (source === es) source = null;
        clearInterval(syncInterval);
        scheduleRetry();
      };
    };

    void connect();

    // Heartbeat: lets the server detect stale connections quickly.
    // If the SSE drops and no heartbeat has arrived recently, the server skips
    // the full 15s grace period and fires the disconnect in ~2s instead.
    const heartbeatInterval = setInterval(() => {
      const token = getStoredToken();
      if (!token) return;
      fetch(`${getBaseUrl()}/api/events/ping`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }, 8000);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(syncInterval);
      clearInterval(heartbeatInterval);
      source?.close();
    };
  }, []);
}
