import { useEffect, useRef, useState, useCallback } from 'react';

export interface WSEvent {
  event: string;
  data: any;
  timestamp: string;
}

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<WSEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
      };

      ws.onmessage = (e) => {
        try {
          const parsed: WSEvent = JSON.parse(e.data);
          setEvents(prev => [parsed, ...prev].slice(0, 200));
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3s
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch { /* ignore */ }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
