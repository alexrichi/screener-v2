import http from 'node:http';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { BinanceVenueAdapter } from '../src/venues/binance';
import { BitgetVenueAdapter } from '../src/venues/bitget';
import { BybitVenueAdapter } from '../src/venues/bybit';
import { CoinbaseVenueAdapter } from '../src/venues/coinbase';
import { HyperliquidVenueAdapter } from '../src/venues/hyperliquid';
import { OkxVenueAdapter } from '../src/venues/okx';
import { VenueRateLimitError } from '../src/venues/rateLimit';
import type { Instrument, Unsubscribe } from '../src/venues/types';
import { VenueHub } from './hub';
import { librarySource } from './luxalgo';
import { BinanceKlineStream, PollingBarsStream } from './stream';
import type { BarsStream } from './stream';
import { VenueKlineStream } from './ws';
import {
  BITGET_STREAM,
  BYBIT_STREAM,
  HYPERLIQUID_STREAM,
  OKX_STREAM,
} from './venueStreams';

const hubs = new Map<string, VenueHub>([
  ['binance', new VenueHub(new BinanceVenueAdapter())],
  ['okx', new VenueHub(new OkxVenueAdapter())],
  ['bybit', new VenueHub(new BybitVenueAdapter())],
  ['bitget', new VenueHub(new BitgetVenueAdapter())],
  ['hyperliquid', new VenueHub(new HyperliquidVenueAdapter())],
  ['coinbase', new VenueHub(new CoinbaseVenueAdapter())],
]);

const streams = new Map<string, BarsStream>([
  [
    'binance',
    new BinanceKlineStream((instrument, timeframe) =>
      hubs.get('binance')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
  [
    'okx',
    new VenueKlineStream(OKX_STREAM, (instrument, timeframe) =>
      hubs.get('okx')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
  [
    'bybit',
    new VenueKlineStream(BYBIT_STREAM, (instrument, timeframe) =>
      hubs.get('bybit')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
  [
    'bitget',
    new VenueKlineStream(BITGET_STREAM, (instrument, timeframe) =>
      hubs.get('bitget')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
  [
    'hyperliquid',
    new VenueKlineStream(HYPERLIQUID_STREAM, (instrument, timeframe) =>
      hubs.get('hyperliquid')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
  [
    'coinbase',
    new PollingBarsStream((instrument, timeframe) =>
      hubs.get('coinbase')!.getBars(instrument, timeframe, 2, { includeForming: true }),
    ),
  ],
]);

const host = process.env.SIDECAR_HOST ?? '127.0.0.1';
const port = Number(process.env.SIDECAR_PORT ?? 8787);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,OPTIONS',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function fail(res: http.ServerResponse, status: number, error: unknown, headers: Record<string, string> = {}): void {
  json(res, status, { error: errorMessage(error) }, headers);
}

async function findInstrument(
  hub: VenueHub,
  wanted: string,
): Promise<Instrument | undefined> {
  const instruments = await hub.getInstruments();
  return instruments.find(
    (item) => item.key === wanted || item.nativeId === wanted || item.display === wanted,
  );
}

function streamTotals(): { streams: number; bars: number; polls: number } {
  let count = 0;
  let bars = 0;
  let polls = 0;
  for (const stream of streams.values()) {
    count += stream.streamCount;
    bars += stream.barCount;
    polls += stream.pollCount;
  }
  return { streams: count, bars, polls };
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    json(res, 204, null);
    return;
  }
  if (req.method !== 'GET') {
    fail(res, 405, 'Method not allowed');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  console.log(`[sidecar] ${req.method} ${path}`);

  if (path === '/health') {
    json(res, 200, {
      ok: true,
      venues: [...hubs.keys()],
      ...streamTotals(),
    });
    return;
  }

  if (path === '/venues') {
    json(res, 200, [...hubs.values()].map((hub) => ({
      id: hub.adapter.id,
      label: hub.adapter.label,
    })));
    return;
  }

  if (path === '/library/source') {
    const codeId = (url.searchParams.get('codeId') ?? '').trim();
    if (!/^[a-z0-9]{8,40}$/i.test(codeId)) {
      fail(res, 400, 'Invalid codeId');
      return;
    }
    json(res, 200, { code: await librarySource(codeId) });
    return;
  }

  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'venues' && segments.length >= 3) {
    const hub = hubs.get(segments[1]!);
    if (!hub) {
      fail(res, 404, `Unknown venue "${segments[1]}"`);
      return;
    }
    const resource = segments[2];

    if (resource === 'instruments') {
      json(res, 200, await hub.getInstruments());
      return;
    }

    if (resource === 'tickers') {
      json(res, 200, await hub.getTickers());
      return;
    }

    if (resource === 'bars') {
      const wanted = url.searchParams.get('instrument') ?? '';
      const instrument = await findInstrument(hub, wanted);
      if (!instrument) {
        fail(res, 404, `Unknown instrument "${wanted}"`);
        return;
      }
      const timeframe = url.searchParams.get('timeframe') ?? '15';
      const bars = Math.max(1, Math.min(100_000, Number(url.searchParams.get('bars') ?? 300) || 300));
      const live = url.searchParams.get('live') === '1';
      const to = Number(url.searchParams.get('to'));
      const priority = url.searchParams.get('priority') === 'background' ? 'background' : 'interactive';
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once('close', onClose);
      try {
        const rows = await hub.getBars(instrument, timeframe, bars, {
          includeForming: live,
          to: Number.isFinite(to) && to > 0 ? to : undefined,
          priority,
          signal: controller.signal,
        });
        json(res, 200, rows);
      } finally {
        res.off('close', onClose);
      }
      return;
    }
  }

  fail(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  void route(req, res).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') return;
    if (error instanceof VenueRateLimitError) {
      fail(res, error.options.banned ? 418 : 429, error, {
        ...(error.options.retryAfterMs > 0
          ? { 'retry-after': String(Math.ceil(error.options.retryAfterMs / 1000)) }
          : {}),
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith('Unsupported timeframe')) {
      fail(res, 400, error);
      return;
    }
    fail(res, 500, error);
  });
});

interface StreamMessage {
  type?: 'subscribe' | 'unsubscribe';
  id?: string;
  instrument?: string;
  timeframe?: string;
}

type Subscriptions = Map<string, Unsubscribe>;

function sendStream(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function onStreamMessage(ws: WebSocket, subscriptions: Subscriptions, raw: string): Promise<void> {
  let message: StreamMessage;
  try {
    message = JSON.parse(raw) as StreamMessage;
  } catch {
    return;
  }
  const id = message.id;
  if (!id) return;

  if (message.type === 'unsubscribe') {
    subscriptions.get(id)?.();
    subscriptions.delete(id);
    return;
  }
  if (message.type !== 'subscribe') return;

  subscriptions.get(id)?.();
  subscriptions.delete(id);
  try {
    const key = message.instrument ?? '';
    const venue = key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
    const hub = hubs.get(venue);
    const stream = streams.get(venue);
    if (!hub || !stream) throw new Error(`Unknown venue "${venue}"`);
    const instrument = await findInstrument(hub, key);
    if (!instrument) throw new Error(`Unknown instrument "${key}"`);
    if (ws.readyState !== WebSocket.OPEN) return;
    const unsubscribe = stream.subscribe(instrument, message.timeframe ?? '15', (bar) => {
      sendStream(ws, { type: 'bar', id, bar });
    });
    subscriptions.set(id, unsubscribe);
  } catch (error) {
    sendStream(ws, { type: 'error', id, error: errorMessage(error) });
  }
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  if (url.pathname !== '/stream') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const subscriptions: Subscriptions = new Map();
  console.log('[sidecar] ws connected');
  ws.on('message', (raw) => {
    void onStreamMessage(ws, subscriptions, raw.toString());
  });
  ws.on('close', () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    console.log('[sidecar] ws closed');
  });
});

server.listen(port, host, () => {
  console.log(`[sidecar] listening on http://${host}:${port}`);
});
