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
  filterRowsForVenues,
  mergeScreenerRows,
  postScreenerConfig,
  screenerWsUrl,
} from '../lib/screenerClient';
import {
  alertRules,
  pushReplayEvents,
  pushRuleEvents,
  subscribeAlertRules,
} from '../lib/alerts';
import { runnerRules } from '../lib/alertRules';
import { toast } from 'sonner';

const reportedRuleErrors = new Set<string>();
const reportedRuleWarnings = new Set<string>();

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
      filterRowsForVenues(snapshot.rows, configRef.current.venues).sort(
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
        socket?.send(JSON.stringify({ op: 'alerts.config', rules: runnerRules(alertRules()) }));
      };
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(String(event.data)) as
            | ({ op: 'screener.snapshot' } & ScreenerSnapshot)
            | ({ op: 'screener.patch' } & ScreenerPatch)
            | { op: 'alerts.event'; events?: unknown }
            | { op: 'alerts.replay'; events?: unknown }
            | { op: 'alerts.warning'; ruleId?: string; message?: string }
            | { op: 'alerts.error'; ruleId?: string; error?: string };
          if (message.op === 'screener.snapshot') {
            applySnapshot(message);
          } else if (message.op === 'screener.patch') {
            // The sidecar's venue config is shared; another window can widen it.
            setRows((current) =>
              mergeScreenerRows(current, {
                ...message,
                rows: filterRowsForVenues(message.rows, configRef.current.venues),
              }),
            );
            setStatus(message.status);
            setLoading(false);
          } else if (message.op === 'alerts.event') {
            pushRuleEvents(message.events);
          } else if (message.op === 'alerts.replay') {
            const added = pushReplayEvents(message.events);
            if (added > 0) {
              toast.info(`${added} alert${added === 1 ? '' : 's'} while you were away`);
            }
          } else if (message.op === 'alerts.warning') {
            const ruleId = message.ruleId ?? 'unknown';
            const rule = alertRules().find((item) => item.id === ruleId);
            // A stale on-disk rule must not surface a warning the UI cannot arm.
            if (!rule) return;
            const text = message.message ?? 'A request series returned no bars';
            const key = `${ruleId}:${text}`;
            if (!reportedRuleWarnings.has(key)) {
              reportedRuleWarnings.add(key);
              toast.warning(`Alert data missing: ${rule.name}`, { description: text });
            }
          } else if (message.op === 'alerts.error') {
            // Keyed by the rule's own updatedAt: a reconnect never repeats an
            // error, an edited rule reports its new failure once.
            const rule = alertRules().find((item) => item.id === (message.ruleId ?? ''));
            // A stale on-disk rule must not surface an error the UI cannot arm.
            if (!rule) return;
            const key = `${message.ruleId ?? 'unknown'}:${rule.updatedAt}`;
            if (!reportedRuleErrors.has(key)) {
              reportedRuleErrors.add(key);
              toast.warning('An alert rule stopped', {
                description: message.error ?? 'The alert could not be evaluated',
              });
            }
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
    return subscribeAlertRules(() => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ op: 'alerts.config', rules: runnerRules(alertRules()) }));
    });
  }, []);

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
