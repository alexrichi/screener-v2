import type { Unsubscribe, VenueBar } from './types';

const DEFAULT_BASE = 'http://127.0.0.1:8787';
const RECONNECT_MS = 2_000;

function streamUrl(): string {
  const configured = (import.meta.env.VITE_SIDECAR_URL as string | undefined) || DEFAULT_BASE;
  return `${configured.replace(/^http/, 'ws').replace(/\/+$/, '')}/stream`;
}

interface Subscription {
  instrument: string;
  timeframe: string;
  onBar: (bar: VenueBar) => void;
  onError: (message: string) => void;
  onStatus: (status: 'open' | 'closed') => void;
}

let socket: WebSocket | null = null;
let retry: number | null = null;
let nextId = 1;
const subscriptions = new Map<string, Subscription>();

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function openSocket(): void {
  if (socket) return;
  const ws = new WebSocket(streamUrl());
  socket = ws;

  ws.onopen = () => {
    for (const [id, sub] of subscriptions) {
      send(ws, { type: 'subscribe', id, instrument: sub.instrument, timeframe: sub.timeframe });
    }
    for (const sub of subscriptions.values()) sub.onStatus('open');
  };

  ws.onmessage = (event) => {
    let message: { type?: string; id?: string; bar?: VenueBar; error?: string };
    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }
    if (!message.id) return;
    const sub = subscriptions.get(message.id);
    if (!sub) return;
    if (message.type === 'bar' && message.bar) sub.onBar(message.bar);
    else if (message.type === 'error') sub.onError(message.error ?? 'Stream error');
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    for (const sub of subscriptions.values()) sub.onStatus('closed');
    if (subscriptions.size > 0) scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (retry !== null) return;
  retry = window.setTimeout(() => {
    retry = null;
    if (subscriptions.size > 0) openSocket();
  }, RECONNECT_MS);
}

/**
 * Live bars from the sidecar. One WebSocket per page carries every chart cell;
 * the sidecar fans it out to one upstream venue stream per symbol/timeframe.
 */
export function subscribeSidecarBar(
  instrument: string,
  timeframe: string,
  handlers: Pick<Subscription, 'onBar' | 'onError' | 'onStatus'>,
): Unsubscribe {
  const id = `bar-${nextId++}`;
  subscriptions.set(id, { instrument, timeframe, ...handlers });
  openSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    send(socket, { type: 'subscribe', id, instrument, timeframe });
    // A socket opened by another cell never fires `open` again.
    handlers.onStatus('open');
  }

  return () => {
    subscriptions.delete(id);
    if (socket?.readyState === WebSocket.OPEN) {
      send(socket, { type: 'unsubscribe', id });
    }
    if (subscriptions.size > 0) return;
    if (retry !== null) {
      window.clearTimeout(retry);
      retry = null;
    }
    const ws = socket;
    socket = null;
    ws?.close();
  };
}
