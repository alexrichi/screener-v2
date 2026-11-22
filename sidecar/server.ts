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
import type { ScreenerConfig, VenueId } from '../src/types';
import type { OrderFlowFrame } from '../src/lib/orderflow';
import { handleAi } from './ai';
import { AlertService } from './alerts';
import { VenueHub } from './hub';
import { resolveIcon } from './icons';
import { librarySource } from './luxalgo';
import {
  BinanceOrderFlowFeed,
  BitgetOrderFlowFeed,
  BybitOrderFlowFeed,
  CoinbaseOrderFlowFeed,
  HyperliquidOrderFlowFeed,
  OkxOrderFlowFeed,
  type OrderFlowFeed,
} from './orderflow/feeds';
import { OrderFlowService } from './orderflow/service';
import { BinanceKlineStream, BinanceVenueStream, PollingBarsStream, SPOT_WS_URL } from './stream';
import type { BarsStream } from './stream';
import { VenueKlineStream } from './ws';
import {
  BITGET_STREAM,
  BYBIT_STREAM,
  HYPERLIQUID_STREAM,
  OKX_STREAM,
} from './venueStreams';
import { ScreenerService } from './screener';

const hubs = new Map<string, VenueHub>([
  ['binance', new VenueHub(new BinanceVenueAdapter())],
  ['okx', new VenueHub(new OkxVenueAdapter())],
  ['bybit', new VenueHub(new BybitVenueAdapter())],
  ['bitget', new VenueHub(new BitgetVenueAdapter())],
  ['hyperliquid', new VenueHub(new HyperliquidVenueAdapter())],
  ['coinbase', new VenueHub(new CoinbaseVenueAdapter())],
]);

const binanceBars = (instrument: Instrument, timeframe: string) =>
  hubs.get('binance')!.getBars(instrument, timeframe, 2, { includeForming: true });

const streams = new Map<string, BarsStream>([
  [
    'binance',
    new BinanceVenueStream(
      new BinanceKlineStream(binanceBars),
      new BinanceKlineStream(binanceBars, SPOT_WS_URL),
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

const screener = new ScreenerService({
  hubs,
  streams,
  config: {
    timeframe: process.env.SCREENER_TIMEFRAME ?? '15',
    rvolDays: Number(process.env.SCREENER_RVOL_DAYS ?? 7),
    rsiPeriod: Number(process.env.SCREENER_RSI_PERIOD ?? 14),
    minVolume: Number(process.env.SCREENER_MIN_VOLUME ?? 1_000_000),
  },
});

// Alert rules and their event log are owned by the process, not by a renderer
// connection: jobs keep running between sockets and survive a sidecar restart.
const alerts = new AlertService({ hubs });

// Order flow is live-only: each browser session drives a ref-counted set of
// public venue book and trade sockets.
const orderFeeds = new Map<string, OrderFlowFeed>([
  ['binance', new BinanceOrderFlowFeed()],
  ['okx', new OkxOrderFlowFeed()],
  ['bybit', new BybitOrderFlowFeed()],
  ['bitget', new BitgetOrderFlowFeed()],
  ['hyperliquid', new HyperliquidOrderFlowFeed()],
  ['coinbase', new CoinbaseOrderFlowFeed()],
]);
const orderflow = new OrderFlowService(hubs, orderFeeds);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-opencode-session',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function fail(res: http.ServerResponse, status: number, error: unknown, headers: Record<string, string> = {}): void {
  json(res, status, { error: errorMessage(error) }, headers);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
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

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (await handleAi(req, res, path)) return;

  if (path === '/screener/snapshot' && req.method === 'GET') {
    screener.start();
    json(res, 200, screener.snapshot());
    return;
  }

  if (path === '/screener/config' && req.method === 'POST') {
    try {
      screener.start();
      const body = await readJson(req);
      screener.setConfig(body as Partial<ScreenerConfig>);
      json(res, 200, { ok: true, status: screener.snapshot().status });
    } catch (error) {
      fail(res, 400, error);
    }
    return;
  }

  if (req.method !== 'GET') {
    fail(res, 405, 'Method not allowed');
    return;
  }
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

  if (path.startsWith('/icon/')) {
    const code = decodeURIComponent(path.slice('/icon/'.length));
    if (!/^[A-Za-z0-9]{1,24}$/.test(code)) {
      fail(res, 400, 'Invalid icon code');
      return;
    }
    const image = await resolveIcon(code);
    if (!image) {
      fail(res, 404, 'No icon');
      return;
    }
    res.writeHead(200, {
      'content-type': image.contentType,
      'content-length': String(image.body.length),
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=86400',
    });
    res.end(image.body);
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
      const from = Number(url.searchParams.get('from'));
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
          from: Number.isFinite(from) && from > 0 ? from : undefined,
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
const screenerWss = new WebSocketServer({ noServer: true });
const orderflowWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  if (url.pathname === '/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    return;
  }
  if (url.pathname === '/screener') {
    screenerWss.handleUpgrade(req, socket, head, (ws) => screenerWss.emit('connection', ws, req));
    return;
  }
  if (url.pathname === '/orderflow') {
    orderflowWss.handleUpgrade(req, socket, head, (ws) =>
      orderflowWss.emit('connection', ws, req),
    );
    return;
  }
  socket.destroy();
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

screenerWss.on('connection', (ws) => {
  screener.start();
  const send = (payload: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };
  console.log('[sidecar] screener ws connected');
  send({ op: 'screener.snapshot', ...screener.snapshot() });
  const unsubscribe = screener.onPatch((patch) => {
    send({ op: 'screener.patch', ...patch });
  });
  const offAlerts = alerts.subscribe(send);
  ws.on('close', () => {
    unsubscribe();
    offAlerts();
    console.log('[sidecar] screener ws closed');
  });

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as {
        op?: string;
        keys?: unknown;
        venues?: unknown;
        timeframe?: unknown;
        rvolDays?: unknown;
        rsiPeriod?: unknown;
        minVolume?: unknown;
        rules?: unknown;
      };
      if (message.op === 'alerts.config') {
        alerts.setRules(message.rules);
        return;
      }
      if (message.op === 'screener.viewport' && Array.isArray(message.keys)) {
        screener.setViewport(
          message.keys.filter((key): key is string => typeof key === 'string'),
        );
        return;
      }
      if (message.op === 'screener.config') {
        screener.setConfig({
          ...(Array.isArray(message.venues)
            ? {
                venues: message.venues.filter(
                  (venue): venue is VenueId => typeof venue === 'string',
                ),
              }
            : {}),
          ...(typeof message.timeframe === 'string'
            ? { timeframe: message.timeframe }
            : {}),
          ...(Number.isFinite(message.rvolDays)
            ? { rvolDays: Number(message.rvolDays) }
            : {}),
          ...(Number.isFinite(message.rsiPeriod)
            ? { rsiPeriod: Number(message.rsiPeriod) }
            : {}),
          ...(Number.isFinite(message.minVolume)
            ? { minVolume: Number(message.minVolume) }
            : {}),
        });
        send({ op: 'screener.snapshot', ...screener.snapshot() });
        return;
      }
      if (message.op === 'screener.refresh') {
        send({ op: 'screener.snapshot', ...screener.snapshot() });
      }
    } catch {
      // Ignore malformed control frames; the next snapshot recovers.
    }
  });
});

orderflowWss.on('connection', (ws) => {
  console.log('[sidecar] orderflow ws connected');
  const send = (frame: OrderFlowFrame): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  const session = orderflow.session(send);
  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as {
        type?: unknown;
        symbol?: unknown;
        venues?: unknown;
        grouping?: unknown;
        value?: unknown;
      };
      if (message.type === 'subscribe' && typeof message.symbol === 'string') {
        session.handle({
          type: 'subscribe',
          symbol: message.symbol,
          venues: Array.isArray(message.venues)
            ? message.venues.filter((venue): venue is VenueId => typeof venue === 'string')
            : null,
          grouping:
            typeof message.grouping === 'number' && message.grouping > 0
              ? message.grouping
              : null,
        });
        return;
      }
      if (message.type === 'venues') {
        session.handle({
          type: 'venues',
          venues: Array.isArray(message.venues)
            ? message.venues.filter((venue): venue is VenueId => typeof venue === 'string')
            : null,
        });
        return;
      }
      if (message.type === 'grouping') {
        session.handle({
          type: 'grouping',
          value:
            typeof message.value === 'number' && message.value > 0 ? message.value : null,
        });
        return;
      }
      if (message.type === 'unsubscribe') {
        session.handle({ type: 'unsubscribe' });
      }
    } catch {
      // Ignore malformed control frames; the next subscribe recovers.
    }
  });
  ws.on('close', () => {
    session.close();
    console.log('[sidecar] orderflow ws closed');
  });
});

server.listen(port, host, () => {
  console.log(`[sidecar] listening on http://${host}:${port}`);
});
