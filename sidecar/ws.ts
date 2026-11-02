import { WebSocket } from 'ws';
import { timeframeMs } from '../src/lib/timeframe';
import type { BarsStream } from './stream';
import type { Instrument, Unsubscribe, VenueBar } from '../src/venues/types';

const RECONNECT_MS = 2_000;
const STALL_MS = 1_500;
const POLL_MS = 1_000;

export interface ParsedBar {
  token: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WsSpec {
  /** Human label for logs. */
  label: string;
  url: string;
  /** Subscription token for one instrument/timeframe. */
  token(instrument: Instrument, timeframe: string): string;
  subscribe(tokens: string[]): unknown | unknown[];
  unsubscribe(tokens: string[]): unknown | unknown[];
  /** Ignore non-candle messages (pong, acks) by returning an empty list. */
  parse(raw: string): ParsedBar[];
  ping?: { everyMs: number; message: unknown };
}

interface Entry {
  instrument: Instrument;
  timeframe: string;
  listeners: Set<(bar: VenueBar) => void>;
  live: boolean;
  stallTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
}

/**
 * One venue WebSocket per sidecar, ref-counted per subscription token. A silent
 * or unreachable socket falls back to one REST poll per second for that stream,
 * fanned out to every chart; the first streamed bar stops the polling.
 */
export class VenueKlineStream implements BarsStream {
  private socket: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private forwarded = 0;
  private polls = 0;
  private readonly streams = new Map<string, Entry>();

  constructor(
    private readonly spec: WsSpec,
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
    const token = this.spec.token(instrument, timeframe);
    let entry = this.streams.get(token);
    const first = !entry;
    if (!entry) {
      entry = {
        instrument,
        timeframe,
        listeners: new Set(),
        live: false,
        stallTimer: null,
        pollTimer: null,
      };
      this.streams.set(token, entry);
    }
    entry.listeners.add(onBar);
    this.open();
    if (first) {
      console.log(`[stream:${this.spec.label}] ${token}`);
      this.sendAll(this.spec.subscribe([token]));
      this.watch(entry);
    }

    return () => {
      const current = this.streams.get(token);
      if (!current) return;
      current.listeners.delete(onBar);
      if (current.listeners.size > 0) return;
      this.stopTimers(current);
      this.streams.delete(token);
      this.sendAll(this.spec.unsubscribe([token]));
      if (this.streams.size === 0) this.close();
    };
  }

  private watch(entry: Entry): void {
    if (entry.live || entry.stallTimer || entry.listeners.size === 0) return;
    entry.stallTimer = setTimeout(() => {
      entry.stallTimer = null;
      this.startPolling(entry);
    }, STALL_MS);
  }

  private startPolling(entry: Entry): void {
    if (entry.live || entry.pollTimer || entry.listeners.size === 0) return;
    console.log(`[poll:${this.spec.label}] ${entry.instrument.key}|${entry.timeframe}`);
    entry.pollTimer = setInterval(() => void this.poll(entry), POLL_MS);
    void this.poll(entry);
  }

  private stopTimers(entry: Entry): void {
    if (entry.stallTimer) {
      clearTimeout(entry.stallTimer);
      entry.stallTimer = null;
    }
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }
  }

  private async poll(entry: Entry): Promise<void> {
    if (entry.live || entry.listeners.size === 0) return;
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

  private open(): void {
    if (this.socket) return;
    const socket = new WebSocket(this.spec.url);
    this.socket = socket;

    socket.on('open', () => {
      console.log(`[stream:${this.spec.label}] connected`);
      if (this.streams.size > 0) this.sendAll(this.spec.subscribe([...this.streams.keys()]));
      if (this.spec.ping) {
        this.pingTimer = setInterval(
          () => this.sendOne(this.spec.ping!.message),
          this.spec.ping.everyMs,
        );
      }
    });

    socket.on('message', (raw) => {
      let parsed: ParsedBar[];
      try {
        parsed = this.spec.parse(raw.toString());
      } catch {
        return;
      }
      for (const item of parsed) {
        const entry = this.streams.get(item.token);
        if (!entry) continue;
        if (!entry.live) console.log(`[stream:${this.spec.label}] live ${item.token}`);
        entry.live = true;
        this.stopTimers(entry);
        const bar: VenueBar = {
          openTime: item.openTime,
          closeTime: item.openTime + timeframeMs(entry.timeframe) - 1,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
        };
        for (const listener of entry.listeners) {
          listener(bar);
          this.forwarded += 1;
        }
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      for (const entry of this.streams.values()) {
        entry.live = false;
        this.startPolling(entry);
      }
      if (this.streams.size > 0) this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      console.warn(
        `[stream:${this.spec.label}] socket error`,
        error instanceof Error ? error.message : error,
      );
    });
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.streams.size > 0) this.open();
    }, RECONNECT_MS);
  }

  private sendAll(message: unknown | unknown[]): void {
    if (Array.isArray(message)) {
      for (const item of message) this.sendOne(item);
      return;
    }
    this.sendOne(message);
  }

  private sendOne(message: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  private close(): void {
    const socket = this.socket;
    this.socket = null;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    socket?.close();
  }
}
