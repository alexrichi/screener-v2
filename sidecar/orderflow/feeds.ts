import { WebSocket } from 'ws';
import type { OrderFlowLevel, OrderFlowSide, OrderFlowTrade } from '../../src/lib/orderflow';
import type { Instrument, Unsubscribe } from '../../src/venues/types';
import { BookAccumulator, type BookUpdate } from './books';

export type FeedTrade = Omit<OrderFlowTrade, 'venue'>;

export interface FeedHandlers {
  book(levels: { bids: OrderFlowLevel[]; asks: OrderFlowLevel[] }): void;
  trade(trade: FeedTrade): void;
  warning(message: string): void;
}

export interface OrderFlowFeed {
  subscribe(instrument: Instrument, handlers: FeedHandlers): Unsubscribe;
}

export interface FeedMessage {
  book?: BookUpdate;
  trades?: FeedTrade[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pairs(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: Array<[number, number]> = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const price = num(item[0]);
    const size = num(item[1]);
    if (price === null || size === null || price <= 0) continue;
    rows.push([price, size]);
  }
  return rows;
}

function trade(
  id: unknown,
  price: unknown,
  size: unknown,
  side: OrderFlowSide,
  time: unknown,
  group?: unknown,
): FeedTrade | null {
  const parsedPrice = num(price);
  const parsedSize = num(size);
  const parsedTime = num(time);
  if (parsedPrice === null || parsedSize === null || parsedTime === null) return null;
  return {
    id: String(id ?? `${parsedTime}:${parsedPrice}:${parsedSize}`),
    price: parsedPrice,
    size: parsedSize,
    side,
    time: parsedTime,
    ...(group == null || group === '' ? {} : { group: String(group) }),
  };
}

export function parseBinanceOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  const data = object(message?.data);
  if (!data) return undefined;
  if (data.e === 'depthUpdate') {
    return {
      book: {
        bids: pairs(data.b),
        asks: pairs(data.a),
        snapshot: true,
      },
    };
  }
  if (data.e === 'trade') {
    const parsed = trade(
      data.t,
      data.p,
      data.q,
      data.m === true ? 'sell' : 'buy',
      data.T,
      data.T,
    );
    return parsed ? { trades: [parsed] } : undefined;
  }
  if (data.e === 'aggTrade') {
    const parsed = trade(
      data.a,
      data.p,
      data.q,
      data.m === true ? 'sell' : 'buy',
      data.T,
      data.a,
    );
    return parsed ? { trades: [parsed] } : undefined;
  }
  return undefined;
}

export function parseOkxOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  const arg = object(message?.arg);
  if (!arg || !Array.isArray(message?.data)) return undefined;
  if (arg.channel === 'books') {
    const row = object(message.data[message.data.length - 1]);
    if (!row) return undefined;
    return {
      book: {
        bids: pairs(row.bids),
        asks: pairs(row.asks),
        snapshot: message.action === 'snapshot',
        seq: num(row.seqId),
        prevSeq: num(row.prevSeqId),
      },
    };
  }
  if (arg.channel === 'trades') {
    const trades: FeedTrade[] = [];
    for (const item of message.data) {
      const row = object(item);
      if (!row) continue;
      const parsed = trade(
        row.tradeId,
        row.px,
        row.sz,
        row.side === 'sell' ? 'sell' : 'buy',
        row.ts,
      );
      if (parsed) trades.push(parsed);
    }
    return trades.length > 0 ? { trades } : undefined;
  }
  return undefined;
}

export function parseBybitOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  if (!message || typeof message.topic !== 'string') return undefined;
  if (message.topic.startsWith('orderbook.')) {
    const row = object(message.data);
    if (!row) return undefined;
    return {
      book: {
        bids: pairs(row.b),
        asks: pairs(row.a),
        snapshot: message.type === 'snapshot',
      },
    };
  }
  if (message.topic.startsWith('publicTrade.') && Array.isArray(message.data)) {
    const trades: FeedTrade[] = [];
    for (const item of message.data) {
      const row = object(item);
      if (!row) continue;
      const parsed = trade(
        row.i,
        row.p,
        row.v,
        row.S === 'Buy' ? 'buy' : 'sell',
        row.T,
      );
      if (parsed) trades.push(parsed);
    }
    return trades.length > 0 ? { trades } : undefined;
  }
  return undefined;
}

export function parseBitgetOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  const arg = object(message?.arg);
  if (!arg || !Array.isArray(message?.data)) return undefined;
  if (arg.channel === 'books') {
    const row = object(message.data[0]);
    if (!row) return undefined;
    return {
      book: {
        bids: pairs(row.bids),
        asks: pairs(row.asks),
        snapshot: message.action === 'snapshot',
      },
    };
  }
  if (arg.channel === 'trade') {
    const trades: FeedTrade[] = [];
    for (const item of message.data) {
      const row = object(item);
      if (!row) continue;
      const parsed = trade(
        row.tradeId,
        row.price,
        row.size,
        row.side === 'sell' ? 'sell' : 'buy',
        row.ts,
      );
      if (parsed) trades.push(parsed);
    }
    return trades.length > 0 ? { trades } : undefined;
  }
  return undefined;
}

function hyperliquidLevels(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: Array<[number, number]> = [];
  for (const item of value) {
    const row = object(item);
    if (!row) continue;
    const price = num(row.px);
    const size = num(row.sz);
    if (price === null || size === null || price <= 0) continue;
    rows.push([price, size]);
  }
  return rows;
}

export function parseHyperliquidOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  if (!message) return undefined;
  if (message.channel === 'l2Book') {
    const data = object(message.data);
    const levels = data?.levels;
    if (!Array.isArray(levels) || levels.length < 2) return undefined;
    return {
      book: {
        bids: hyperliquidLevels(levels[0]),
        asks: hyperliquidLevels(levels[1]),
        snapshot: true,
      },
    };
  }
  if (message.channel === 'trades' && Array.isArray(message.data)) {
    const trades: FeedTrade[] = [];
    for (const item of message.data) {
      const row = object(item);
      if (!row) continue;
      const parsed = trade(
        row.tid,
        row.px,
        row.sz,
        row.side === 'B' ? 'buy' : 'sell',
        row.time,
      );
      if (parsed) trades.push(parsed);
    }
    return trades.length > 0 ? { trades } : undefined;
  }
  return undefined;
}

export function parseCoinbaseOrderFlow(raw: string): FeedMessage | undefined {
  const message = object(json(raw));
  if (!message) return undefined;
  if (message.type === 'snapshot') {
    return {
      book: {
        bids: pairs(message.bids),
        asks: pairs(message.asks),
        snapshot: true,
      },
    };
  }
  if (message.type === 'l2update' && Array.isArray(message.changes)) {
    const bids: Array<[number, number]> = [];
    const asks: Array<[number, number]> = [];
    for (const item of message.changes) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const price = num(item[1]);
      const size = num(item[2]);
      if (price === null || size === null || price <= 0) continue;
      if (item[0] === 'buy') bids.push([price, size]);
      else if (item[0] === 'sell') asks.push([price, size]);
    }
    return { book: { bids, asks, snapshot: false } };
  }
  if (message.type === 'match') {
    // Coinbase reports the resting order's side; the taker took the other side.
    const parsed = trade(
      message.trade_id,
      message.price,
      message.size,
      message.side === 'buy' ? 'sell' : 'buy',
      Date.parse(String(message.time)),
      message.taker_order_id,
    );
    return parsed ? { trades: [parsed] } : undefined;
  }
  return undefined;
}

export function scaleMessage(message: FeedMessage, scale: number): FeedMessage {
  if (!(scale > 0) || scale === 1) return message;
  const scaledLevels = (
    levels: Array<[number, number]> | undefined,
  ): Array<[number, number]> | undefined =>
    levels?.map(([price, size]) => [price, size * scale]);
  return {
    book: message.book
      ? {
          ...message.book,
          bids: scaledLevels(message.book.bids),
          asks: scaledLevels(message.book.asks),
        }
      : undefined,
    trades: message.trades?.map((trade) => ({ ...trade, size: trade.size * scale })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Entry {
  instrument: Instrument;
  handlers: Set<FeedHandlers>;
  socket: WebSocket | null;
  retry: NodeJS.Timeout | null;
  ping: NodeJS.Timeout | null;
  book: BookAccumulator;
  seq: number | null;
  closed: boolean;
  warnedAt: number;
  updates: number;
}

/**
 * One venue order-flow socket per instrument, shared by every browser session.
 * The book is normalized before leaving the sidecar; sequence gaps resubscribe
 * instead of serving a drifted ladder.
 */
export abstract class BaseOrderFlowFeed implements OrderFlowFeed {
  protected abstract readonly label: string;
  private readonly entries = new Map<string, Entry>();

  subscribe(instrument: Instrument, handlers: FeedHandlers): Unsubscribe {
    let entry = this.entries.get(instrument.key);
    const first = !entry;
    if (!entry) {
      entry = {
        instrument,
        handlers: new Set(),
        socket: null,
        retry: null,
        ping: null,
        book: new BookAccumulator(),
        seq: null,
        closed: false,
        warnedAt: 0,
        updates: 0,
      };
      this.entries.set(instrument.key, entry);
    }
    entry.handlers.add(handlers);
    if (first) this.open(entry);
    return () => {
      const current = this.entries.get(instrument.key);
      if (!current) return;
      current.handlers.delete(handlers);
      if (current.handlers.size > 0) return;
      this.dispose(current);
      this.entries.delete(instrument.key);
    };
  }

  protected abstract url(instrument: Instrument): string;
  protected abstract openMessages(instrument: Instrument): unknown[];
  protected abstract parse(raw: string): FeedMessage | undefined;
  protected pingMessage(): unknown | null {
    return null;
  }
  protected get pingIntervalMs(): number {
    return 0;
  }

  private open(entry: Entry): void {
    if (entry.closed || entry.handlers.size === 0) return;
    entry.seq = null;
    const url = this.url(entry.instrument);
    const socket = new WebSocket(url);
    entry.socket = socket;
    socket.on('open', () => {
      if (entry.socket !== socket) return;
      for (const message of this.openMessages(entry.instrument)) this.send(socket, message);
      const ping = this.pingMessage();
      if (ping !== null && this.pingIntervalMs > 0) {
        entry.ping = setInterval(() => this.send(socket, ping), this.pingIntervalMs);
      }
      console.log(`[orderflow:${this.label}] ${entry.instrument.key}`);
    });
    socket.on('message', (raw) => {
      if (entry.socket === socket) this.handle(entry, raw.toString());
    });
    socket.on('error', (error) => {
      this.warn(entry, errorMessage(error));
    });
    socket.on('close', () => {
      if (entry.socket !== socket) return;
      entry.socket = null;
      this.stopPing(entry);
      this.schedule(entry);
    });
  }

  private schedule(entry: Entry): void {
    if (entry.closed || entry.handlers.size === 0 || entry.retry) return;
    entry.retry = setTimeout(() => {
      entry.retry = null;
      this.open(entry);
    }, 1_500);
  }

  private handle(entry: Entry, raw: string): void {
    let message: FeedMessage | undefined;
    try {
      message = this.parse(raw);
    } catch {
      return;
    }
    if (!message) return;
    const scale =
      entry.instrument.contractSize && entry.instrument.contractSize > 0
        ? entry.instrument.contractSize
        : 1;
    if (scale !== 1) message = scaleMessage(message, scale);
    if (message.book) {
      const { snapshot, seq, prevSeq } = message.book;
      if (!snapshot && entry.seq !== null && seq !== null && seq !== undefined) {
        const expected = prevSeq ?? entry.seq + 1;
        if (expected !== entry.seq) {
          this.warn(entry, 'book sequence gap; resubscribing');
          this.restart(entry);
          return;
        }
      }
      entry.book.apply(message.book);
      if (seq !== null && seq !== undefined) entry.seq = seq;
      if (snapshot) entry.seq = seq ?? null;
      entry.updates += 1;
      if (entry.updates % 200 === 0) entry.book.trim(5000);
      const levels = entry.book.levels();
      for (const handler of entry.handlers) handler.book(levels);
    }
    if (message.trades) {
      for (const item of message.trades) {
        for (const handler of entry.handlers) handler.trade(item);
      }
    }
  }

  private restart(entry: Entry): void {
    const socket = entry.socket;
    entry.socket = null;
    this.stopPing(entry);
    socket?.close();
    this.schedule(entry);
  }

  private dispose(entry: Entry): void {
    entry.closed = true;
    if (entry.retry) {
      clearTimeout(entry.retry);
      entry.retry = null;
    }
    this.stopPing(entry);
    const socket = entry.socket;
    entry.socket = null;
    socket?.close();
  }

  private stopPing(entry: Entry): void {
    if (!entry.ping) return;
    clearInterval(entry.ping);
    entry.ping = null;
  }

  private warn(entry: Entry, message: string): void {
    const now = Date.now();
    if (now - entry.warnedAt < 30_000) return;
    entry.warnedAt = now;
    console.warn(`[orderflow:${this.label}] ${message}`);
    for (const handler of entry.handlers) handler.warning(message);
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }
}

interface BinanceDepthEvent {
  U: number;
  u: number;
  pu: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

type BinanceFullMessage =
  | { kind: 'depth'; event: BinanceDepthEvent }
  | { kind: 'trade'; trade: FeedTrade };

function parseBinanceFull(raw: string): BinanceFullMessage | null {
  const message = object(json(raw));
  const data = object(message?.data);
  if (!data) return null;
  if (data.e === 'depthUpdate') {
    const U = num(data.U);
    const u = num(data.u);
    const pu = num(data.pu);
    if (U === null || u === null || pu === null) return null;
    return {
      kind: 'depth',
      event: { U, u, pu, bids: pairs(data.b) ?? [], asks: pairs(data.a) ?? [] },
    };
  }
  if (data.e === 'trade') {
    const parsed = trade(
      data.t,
      data.p,
      data.q,
      data.m === true ? 'sell' : 'buy',
      data.T,
      data.T,
    );
    return parsed ? { kind: 'trade', trade: parsed } : null;
  }
  return null;
}

async function fetchBinanceDepth(instrument: Instrument): Promise<{
  lastUpdateId: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}> {
  const base = (process.env.BINANCE_REST_URL ?? 'https://fapi.binance.com/fapi/v1').replace(
    /\/+$/,
    '',
  );
  const response = await fetch(
    `${base}/depth?symbol=${encodeURIComponent(instrument.nativeId)}&limit=1000`,
    { headers: { 'user-agent': 'screener-v2' } },
  );
  if (!response.ok) throw new Error(`Binance depth HTTP ${response.status}`);
  const payload = object(await response.json());
  const lastUpdateId = num(payload?.lastUpdateId);
  const bids = pairs(payload?.bids);
  const asks = pairs(payload?.asks);
  if (lastUpdateId === null || !bids || !asks) {
    throw new Error('Binance depth snapshot is malformed');
  }
  return { lastUpdateId, bids, asks };
}

interface BinanceEntry {
  instrument: Instrument;
  handlers: Set<FeedHandlers>;
  socket: WebSocket | null;
  retry: NodeJS.Timeout | null;
  book: BookAccumulator;
  buffer: BinanceDepthEvent[];
  ready: boolean;
  lastU: number;
  fetching: boolean;
  updates: number;
  closed: boolean;
  warnedAt: number;
}

/**
 * Binance's partial-depth stream stops at 20 levels. The full ladder needs the
 * REST snapshot followed by the diff stream: buffer diffs while the snapshot
 * loads, apply the sequence, and resnapshot on a gap.
 */
export class BinanceOrderFlowFeed implements OrderFlowFeed {
  private readonly entries = new Map<string, BinanceEntry>();

  subscribe(instrument: Instrument, handlers: FeedHandlers): Unsubscribe {
    let entry = this.entries.get(instrument.key);
    const first = !entry;
    if (!entry) {
      entry = {
        instrument,
        handlers: new Set(),
        socket: null,
        retry: null,
        book: new BookAccumulator(),
        buffer: [],
        ready: false,
        lastU: 0,
        fetching: false,
        updates: 0,
        closed: false,
        warnedAt: 0,
      };
      this.entries.set(instrument.key, entry);
    }
    entry.handlers.add(handlers);
    if (first) this.open(entry);
    return () => {
      const current = this.entries.get(instrument.key);
      if (!current) return;
      current.handlers.delete(handlers);
      if (current.handlers.size > 0) return;
      this.dispose(current);
      this.entries.delete(instrument.key);
    };
  }

  private open(entry: BinanceEntry): void {
    if (entry.closed || entry.handlers.size === 0) return;
    const base = process.env.BINANCE_WS_URL ?? 'wss://fstream.binance.com/stream';
    const symbol = entry.instrument.nativeId.toLowerCase();
    const socket = new WebSocket(`${base}?streams=${symbol}@depth@100ms/${symbol}@trade`);
    entry.socket = socket;
    entry.book.clear();
    entry.buffer = [];
    entry.ready = false;
    entry.lastU = 0;
    entry.updates = 0;
    socket.on('open', () => {
      if (entry.socket !== socket) return;
      void this.seed(entry);
      console.log(`[orderflow:binance] ${entry.instrument.key}`);
    });
    socket.on('message', (raw) => {
      if (entry.socket === socket) this.handle(entry, raw.toString());
    });
    socket.on('error', (error) => {
      this.warn(entry, errorMessage(error));
    });
    socket.on('close', () => {
      if (entry.socket !== socket) return;
      entry.socket = null;
      entry.ready = false;
      this.schedule(entry);
    });
  }

  private async seed(entry: BinanceEntry): Promise<void> {
    if (entry.fetching || entry.closed) return;
    entry.fetching = true;
    try {
      const snapshot = await fetchBinanceDepth(entry.instrument);
      if (entry.closed || entry.socket?.readyState !== WebSocket.OPEN) return;
      entry.book.apply({ bids: snapshot.bids, asks: snapshot.asks, snapshot: true });
      entry.lastU = snapshot.lastUpdateId;
      entry.ready = true;
      const buffered = entry.buffer.splice(0);
      for (const event of buffered) this.applyDepth(entry, event);
      this.publish(entry);
    } catch (error) {
      this.warn(entry, errorMessage(error));
      this.restart(entry);
    } finally {
      entry.fetching = false;
    }
  }

  private handle(entry: BinanceEntry, raw: string): void {
    const message = parseBinanceFull(raw);
    if (!message) return;
    if (message.kind === 'trade') {
      for (const handler of entry.handlers) handler.trade(message.trade);
      return;
    }
    if (!entry.ready) {
      entry.buffer.push(message.event);
      return;
    }
    this.applyDepth(entry, message.event);
  }

  private applyDepth(entry: BinanceEntry, event: BinanceDepthEvent): void {
    if (event.u <= entry.lastU) return;
    if (event.pu !== entry.lastU) {
      const first = event.U <= entry.lastU + 1 && event.u >= entry.lastU + 1;
      if (!first) {
        this.resync(entry);
        return;
      }
    }
    entry.book.apply({ bids: event.bids, asks: event.asks });
    entry.lastU = event.u;
    entry.updates += 1;
    if (entry.updates % 200 === 0) entry.book.trim(5000);
    this.publish(entry);
  }

  private resync(entry: BinanceEntry): void {
    entry.ready = false;
    entry.buffer = [];
    entry.book.clear();
    void this.seed(entry);
  }

  private publish(entry: BinanceEntry): void {
    const levels = entry.book.levels();
    for (const handler of entry.handlers) handler.book(levels);
  }

  private restart(entry: BinanceEntry): void {
    const socket = entry.socket;
    entry.socket = null;
    entry.ready = false;
    socket?.close();
    this.schedule(entry);
  }

  private schedule(entry: BinanceEntry): void {
    if (entry.closed || entry.handlers.size === 0 || entry.retry) return;
    entry.retry = setTimeout(() => {
      entry.retry = null;
      this.open(entry);
    }, 1_500);
  }

  private dispose(entry: BinanceEntry): void {
    entry.closed = true;
    if (entry.retry) {
      clearTimeout(entry.retry);
      entry.retry = null;
    }
    const socket = entry.socket;
    entry.socket = null;
    socket?.close();
  }

  private warn(entry: BinanceEntry, message: string): void {
    const now = Date.now();
    if (now - entry.warnedAt < 30_000) return;
    entry.warnedAt = now;
    console.warn(`[orderflow:binance] ${message}`);
    for (const handler of entry.handlers) handler.warning(message);
  }
}

export class OkxOrderFlowFeed extends BaseOrderFlowFeed {
  protected readonly label = 'okx';

  protected url(): string {
    return 'wss://ws.okx.com/ws/v5/public';
  }

  protected openMessages(instrument: Instrument): unknown[] {
    return [
      {
        op: 'subscribe',
        args: [
          { channel: 'books', instId: instrument.nativeId },
          { channel: 'trades', instId: instrument.nativeId },
        ],
      },
    ];
  }

  protected parse(raw: string): FeedMessage | undefined {
    return parseOkxOrderFlow(raw);
  }

  protected pingMessage(): unknown {
    return 'ping';
  }

  protected get pingIntervalMs(): number {
    return 25_000;
  }
}

export class BybitOrderFlowFeed extends BaseOrderFlowFeed {
  protected readonly label = 'bybit';

  protected url(instrument: Instrument): string {
    return instrument.kind === 'spot'
      ? 'wss://stream.bybit.com/v5/public/spot'
      : 'wss://stream.bybit.com/v5/public/linear';
  }

  protected openMessages(instrument: Instrument): unknown[] {
    return [
      {
        op: 'subscribe',
        args: [`orderbook.200.${instrument.nativeId}`, `publicTrade.${instrument.nativeId}`],
      },
    ];
  }

  protected parse(raw: string): FeedMessage | undefined {
    return parseBybitOrderFlow(raw);
  }

  protected pingMessage(): unknown {
    return { op: 'ping' };
  }

  protected get pingIntervalMs(): number {
    return 20_000;
  }
}

export class BitgetOrderFlowFeed extends BaseOrderFlowFeed {
  protected readonly label = 'bitget';

  protected url(): string {
    return 'wss://ws.bitget.com/v2/ws/public';
  }

  protected openMessages(instrument: Instrument): unknown[] {
    const instType = instrument.kind === 'spot' ? 'SPOT' : 'USDT-FUTURES';
    return [
      {
        op: 'subscribe',
        args: [
          { instType, channel: 'books', instId: instrument.nativeId },
          { instType, channel: 'trade', instId: instrument.nativeId },
        ],
      },
    ];
  }

  protected parse(raw: string): FeedMessage | undefined {
    return parseBitgetOrderFlow(raw);
  }

  protected pingMessage(): unknown {
    return 'ping';
  }

  protected get pingIntervalMs(): number {
    return 25_000;
  }
}

export class HyperliquidOrderFlowFeed extends BaseOrderFlowFeed {
  protected readonly label = 'hyperliquid';

  protected url(): string {
    return 'wss://api.hyperliquid.xyz/ws';
  }

  protected openMessages(instrument: Instrument): unknown[] {
    return [
      { method: 'subscribe', subscription: { type: 'l2Book', coin: instrument.nativeId } },
      { method: 'subscribe', subscription: { type: 'trades', coin: instrument.nativeId } },
    ];
  }

  protected parse(raw: string): FeedMessage | undefined {
    return parseHyperliquidOrderFlow(raw);
  }

  protected pingMessage(): unknown {
    return { method: 'ping' };
  }

  protected get pingIntervalMs(): number {
    return 30_000;
  }
}

export class CoinbaseOrderFlowFeed extends BaseOrderFlowFeed {
  protected readonly label = 'coinbase';

  protected url(): string {
    return 'wss://ws-feed.exchange.coinbase.com';
  }

  protected openMessages(instrument: Instrument): unknown[] {
    return [
      {
        type: 'subscribe',
        product_ids: [instrument.nativeId],
        channels: ['level2_batch', 'matches', 'heartbeat'],
      },
    ];
  }

  protected parse(raw: string): FeedMessage | undefined {
    return parseCoinbaseOrderFlow(raw);
  }
}
