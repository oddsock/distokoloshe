import { useEffect, useRef, useCallback } from 'react';
import { getStoredToken, getBaseUrl } from '../lib/api';

type EventHandler = (data: unknown) => void;

interface UseEventsOptions {
  handlers: Record<string, EventHandler>;
  onReconnect?: () => void;
}

export function useEvents({ handlers, onReconnect }: UseEventsOptions) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const token = getStoredToken();
    if (!token) return;

    // Close existing connection
    eventSourceRef.current?.close();

    // EventSource doesn't support custom headers, so pass token as query param
    const es = new EventSource(`${getBaseUrl()}/api/events?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    // Track whether this is the initial connection or a reconnect
    let hasConnectedBefore = false;

    // Use a generic message handler that routes by event type.
    // SSE `event:` field becomes MessageEvent.type when using addEventListener,
    // but we need to know which events to listen for. Instead, use onmessage
    // which fires for unnamed events. Since our server uses named events,
    // we listen to all known handler keys dynamically.
    const registeredTypes = new Set<string>();

    const syncListeners = () => {
      const currentKeys = Object.keys(handlersRef.current);
      for (const key of currentKeys) {
        if (!registeredTypes.has(key)) {
          registeredTypes.add(key);
          es.addEventListener(key, ((e: MessageEvent) => {
            handlersRef.current[key]?.(JSON.parse(e.data));
          }) as EventListener);
        }
      }
    };

    // Register initial handlers
    syncListeners();

    // Re-sync periodically in case new handlers are added after mount
    const syncInterval = setInterval(syncListeners, 2000);

    es.onopen = () => {
      if (hasConnectedBefore) {
        // SSE reconnected after a drop — notify caller so it can re-sync state
        onReconnectRef.current?.();
      }
      hasConnectedBefore = true;
    };

    es.onerror = () => {
      // EventSource auto-reconnects, no action needed
    };

    // Store the interval so we can clean it up
    (es as unknown as { _syncInterval: ReturnType<typeof setInterval> })._syncInterval = syncInterval;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      const es = eventSourceRef.current;
      if (es) {
        clearInterval((es as unknown as { _syncInterval: ReturnType<typeof setInterval> })._syncInterval);
        es.close();
      }
    };
  }, [connect]);
}
