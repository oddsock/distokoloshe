import { useEffect, useRef, useCallback } from 'react';
import { getStoredToken } from '../lib/api';

type EventHandler = (data: unknown) => void;

export function useEvents(handlers: Record<string, EventHandler>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const token = getStoredToken();
    if (!token) return;

    // Close existing connection
    eventSourceRef.current?.close();

    // EventSource doesn't support custom headers, so pass token as query param
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.addEventListener('room:created', (e) => {
      handlersRef.current['room:created']?.(JSON.parse(e.data));
    });

    es.addEventListener('room:deleted', (e) => {
      handlersRef.current['room:deleted']?.(JSON.parse(e.data));
    });

    es.addEventListener('user:online', (e) => {
      handlersRef.current['user:online']?.(JSON.parse(e.data));
    });

    es.addEventListener('user:offline', (e) => {
      handlersRef.current['user:offline']?.(JSON.parse(e.data));
    });

    es.addEventListener('user:room_join', (e) => {
      handlersRef.current['user:room_join']?.(JSON.parse(e.data));
    });

    es.addEventListener('user:room_leave', (e) => {
      handlersRef.current['user:room_leave']?.(JSON.parse(e.data));
    });

    es.onerror = () => {
      // EventSource auto-reconnects, no action needed
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);
}
