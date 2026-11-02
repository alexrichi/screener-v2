import { WebSocket } from 'ws';
import { binanceInterval } from '../src/lib/binance';
import type { Instrument, Unsubscribe, VenueBar } from '../src/venues/types';

/** Binance USDⓈ-M combined stream endpoint. */
const DEFAULT_WS_URL = 'wss://fstream.binance.com/stream';
const RECONNECT_MS = 2_000;
/** If the venue socket stays silent this long, start REST polling for the stream. */
const STALL_MS = 1_500;
const POLL_MS = 1_000;

export interface BinanceKline {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

interface CombinedMessage {
  stream?: string;
  data?: { e?: string; k?: BinanceKline };
}

interface StreamEntry {
  instrument: Instrument;
  timeframe: string;
  listeners: Set<(bar: VenueBar) => void>;
  live: boolean;
  pollFailed: boolean;
  stallTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
}

export function klineToBar(kline: BinanceKline): VenueBar {
  return {
    openTime: kline.t,
    closeTime: kline.T,
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
  };
}

export interface BarsStream {
  readonly streamCount: number;
  readonly barCount: number;
  readonly pollCount: number;
  subscribe(
    instrument: Instrument,
    timeframe: string,
    onBar: (bar: VenueBar) => void,
  ): Unsubscribe;
}

/**
 * One Binance WebSocket per sidecar, ref-counted per `<symbol>@kline_<tf>`.
 * Every browser, chart cell and future consumer shares the same upstream
 * subscription. Venue sockets are silent on some networks (or open without
 * delivering), so a stream that produces no bar within `STALL_MS` falls back to
 * one REST poll per second for that stream — not per chart.
 */
export class BinanceKlineStream implements BarsStream {
  private socket: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private forwarded = 0;
  private polls = 0;
  private readonly streams = new Map<string, StreamEntry>();

  constructor(
    private readonly fetchLatest: (
      instrument: Instrument,
      timeframe: string,
    ) => Promise<VenueBar[]>,
  ) {}

  get streamCount(): number {
    return this.streams.size;
  }

  /** Diagnostic counter: bars fanned out to consumers since boot. */
  get barCount(): number {
    return this.forwarded;
  }

  /** Diagnostic counter: REST fallback requests since boot. */
  get pollCount(): number {
    return this.polls;
  }

  subscribe(
    instrument: Instrument,
    timeframe: string,
    onBar: (bar: VenueBar) => void,
  ): Unsubscribe {
    const interval = binanceInterval(timeframe);
    const name = `${instrument.nativeId.toLowerCase()}@kline_${interval}`;
    let entry = this.streams.get(name);
    const first = !entry;
    if (!entry) {
      entry = {
        instrument,
        timeframe,
        listeners: new Set(),
        live: false,
        pollFailed: false,
        stallTimer: null,
        pollTimer: null,
      };
      this.streams.set(name, entry);
    }
    entry.listeners.add(onBar);
    this.open();
    if (first) {
      console.log(`[stream] ${name}`);
      this.send('SUBSCRIBE', [name]);
      this.watch(entry);
    }

    return () => {
      const current = this.streams.get(name);
      if (!current) return;
      current.listeners.delete(onBar);
      if (current.listeners.size > 0) return;
      this.stopTimers(current);
      this.streams.delete(name);
      this.send('UNSUBSCRIBE', [name]);
      if (this.streams.size === 0) this.close();
    };
  }

  private watch(entry: StreamEntry): void {
    if (entry.live || entry.stallTimer || entry.listeners.size === 0) return;
    entry.stallTimer = setTimeout(() => {
      entry.stallTimer = null;
      this.startPolling(entry);
    }, STALL_MS);
  }

  private startPolling(entry: StreamEntry): void {
    if (entry.live || entry.pollTimer || entry.listeners.size === 0) return;
    entry.pollTimer = setInterval(() => void this.poll(entry), POLL_MS);
    void this.poll(entry);
  }

  private stopTimers(entry: StreamEntry): void {
    if (entry.stallTimer) {
      clearTimeout(entry.stallTimer);
      entry.stallTimer = null;
    }
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }
  }

  private async poll(entry: StreamEntry): Promise<void> {
    if (entry.live || entry.listeners.size === 0) return;
    this.polls += 1;
    try {
      const bars = await this.fetchLatest(entry.instrument, entry.timeframe);
      const bar = bars[bars.length - 1];
      if (!bar) return;
      entry.pollFailed = false;
      for (const listener of entry.listeners) {
        listener(bar);
        this.forwarded += 1;
      }
    } catch (error) {
      if (!entry.pollFailed) {
        entry.pollFailed = true;
        console.warn(
          '[stream] REST fallback failed',
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private open(): void {
    if (this.socket) return;
    const socket = new WebSocket(process.env.BINANCE_WS_URL ?? DEFAULT_WS_URL);
    this.socket = socket;

    socket.on('open', () => {
      console.log('[stream] connected');
      if (this.streams.size > 0) this.send('SUBSCRIBE', [...this.streams.keys()]);
    });

    socket.on('message', (raw) => {
      let message: CombinedMessage;
      try {
        message = JSON.parse(raw.toString()) as CombinedMessage;
      } catch {
        return;
      }
      const kline = message.data?.k;
      const entry = message.stream ? this.streams.get(message.stream) : undefined;
      if (!entry || !kline) return;
      entry.live = true;
      this.stopTimers(entry);
      const bar = klineToBar(kline);
      for (const listener of entry.listeners) {
        listener(bar);
        this.forwarded += 1;
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const entry of this.streams.values()) {
        entry.live = false;
        // Keep charts moving while the venue socket reconnects.
        this.startPolling(entry);
      }
      if (this.streams.size > 0) this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      console.warn('[stream] socket error', error instanceof Error ? error.message : error);
    });
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.streams.size > 0) this.open();
    }, RECONNECT_MS);
  }

  private send(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ method, params, id: Date.now() }));
  }

  private close(): void {
    const socket = this.socket;
    this.socket = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    socket?.close();
  }
}

interface PollEntry {
  instrument: Instrument;
  timeframe: string;
  listeners: Set<(bar: VenueBar) => void>;
  timer: NodeJS.Timeout | null;
}

/**
 * REST-only live feed for venues whose sidecar stream is not implemented yet.
 * One timer per instrument/timeframe, shared by every subscriber; each tick asks
 * the hub for the last two bars (forming included) and fans out the newest.
 */
export class PollingBarsStream implements BarsStream {
  private forwarded = 0;
  private polls = 0;
  private readonly streams = new Map<string, PollEntry>();

  constructor(
    private readonly fetchLatest: (
      instrument: Instrument,
      timeframe: string,
    ) => Promise<VenueBar[]>,
  ) {}

  get streamCount(): number {
    return this.streams.size;
  }

  get barCount(): number {
    return this.forwarded;
  }

  get pollCount(): number {
    return this.polls;
  }

  subscribe(
    instrument: Instrument,
    timeframe: string,
    onBar: (bar: VenueBar) => void,
  ): Unsubscribe {
    const key = `${instrument.key}|${timeframe}`;
    let entry = this.streams.get(key);
    if (!entry) {
      entry = { instrument, timeframe, listeners: new Set(), timer: null };
      this.streams.set(key, entry);
      console.log(`[poll] ${key}`);
      entry.timer = setInterval(() => void this.poll(entry!), 1_000);
      void this.poll(entry);
    }
    entry.listeners.add(onBar);

    return () => {
      const current = this.streams.get(key);
      if (!current) return;
      current.listeners.delete(onBar);
      if (current.listeners.size > 0) return;
      if (current.timer) clearInterval(current.timer);
      this.streams.delete(key);
    };
  }

  private async poll(entry: PollEntry): Promise<void> {
    if (entry.listeners.size === 0) return;
    this.polls += 1;
    try {
      const bars = await this.fetchLatest(entry.instrument, entry.timeframe);
      const bar = bars[bars.length - 1];
      if (!bar) return;
      for (const listener of entry.listeners) {
        listener(bar);
        this.forwarded += 1;
      }
    } catch {
      // Transient venue/rate-limit failure: the next tick retries.
    }
  }
}
