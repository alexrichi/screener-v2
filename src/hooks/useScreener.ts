import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScreenerConfig,
  ScreenerPatch,
  ScreenerRow,
  ScreenerSnapshot,
  ScreenerStatus,
} from '../types';
import {
  fetchScreenerSnapshot,
  mergeScreenerRows,
  postScreenerConfig,
  screenerWsUrl,
} from '../lib/screenerClient';

interface Options {
  config: ScreenerConfig;
}

/**
 * One client for the server-owned screener: snapshot first, then batched
 * patches over a single WebSocket. Configuration is replayed on reconnect.
 */
export function useScreener({ config }: Options) {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [status, setStatus] = useState<ScreenerStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef('');
  const configRef = useRef(config);
  configRef.current = config;
  const configKey = JSON.stringify(config);

  const applySnapshot = useCallback((snapshot: ScreenerSnapshot) => {
    setRows(
      [...snapshot.rows].sort(
        (left, right) => (right.quoteVolume ?? -1) - (left.quoteVolume ?? -1),
      ),
    );
    setStatus(snapshot.status);
    setLoading(!snapshot.status.ready);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySnapshot(await fetchScreenerSnapshot());
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 'screener.refresh' }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    void fetchScreenerSnapshot()
      .then((snapshot) => {
        if (!stopped) applySnapshot(snapshot);
      })
      .catch((cause: unknown) => {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });

    const connect = (): void => {
      socket = new WebSocket(screenerWsUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        setConnected(true);
        setError(null);
        viewportRef.current = '';
        socket?.send(JSON.stringify({ op: 'screener.config', ...configRef.current }));
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(String(event.data)) as
            | ({ op: 'screener.snapshot' } & ScreenerSnapshot)
            | ({ op: 'screener.patch' } & ScreenerPatch);
          if (message.op === 'screener.snapshot') {
            applySnapshot(message);
          } else if (message.op === 'screener.patch') {
            setRows((current) => mergeScreenerRows(current, message));
            setStatus(message.status);
            setLoading(false);
          }
        } catch {
          // Ignore malformed frames; the next snapshot recovers.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnected(false);
        socketRef.current = null;
        retry = setTimeout(connect, 2_000);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, [applySnapshot]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN || rows.length === 0) return;
    // The sidecar warms and refreshes the rows the user can see first.
    const keys = rows
      .slice(0, 100)
      .map((row) => row.instrument.key)
      .sort();
    const signature = keys.join(',');
    if (signature === viewportRef.current) return;
    viewportRef.current = signature;
    socket.send(JSON.stringify({ op: 'screener.viewport', keys }));
  }, [rows, connected]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ op: 'screener.config', ...configRef.current }));
    // A new config rebuilds the server-side series; a REST fallback is also
    // useful when the sidecar drops the socket while the user edits settings.
    void postScreenerConfig(configRef.current).catch(() => {});
  }, [configKey]);

  return { rows, status, connected, error, loading, refresh };
}
