import type {
  Instrument,
  VenueAdapter,
  VenueBar,
  VenueFetchOptions,
  VenueTicker,
} from '../src/venues/types';

const TICKER_TTL_MS = 3_000;
const BARS_TTL_MS = 2_000;
const LIVE_BARS_TTL_MS = 750;

interface BarsEntry {
  at: number;
  promise: Promise<VenueBar[]>;
  settled: boolean;
  controller: AbortController;
  subscribers: number;
}

interface TickersEntry {
  at: number;
  promise: Promise<VenueTicker[]>;
  settled: boolean;
}

export interface HubBarsOptions extends VenueFetchOptions {
  signal?: AbortSignal;
}

/**
 * One adapter instance per venue, shared by every sidecar consumer. The hub owns
 * the short-lived caches and in-flight de-duplication; callers only see promises.
 *
 * An in-flight fetch is always shared regardless of its age - TTL applies only
 * after it settles. Bars also track their subscribers: the upstream request is
 * aborted only when every consumer has gone away.
 */
export class VenueHub {
  private instruments: Promise<Instrument[]> | null = null;
  private tickers: TickersEntry | null = null;
  private readonly bars = new Map<string, BarsEntry>();

  constructor(readonly adapter: VenueAdapter) {}

  getInstruments(): Promise<Instrument[]> {
    if (!this.instruments) {
      this.instruments = this.adapter.listInstruments().catch((error) => {
        this.instruments = null;
        throw error;
      });
    }
    return this.instruments;
  }

  getTickers(): Promise<VenueTicker[]> {
    const now = Date.now();
    if (this.tickers && (!this.tickers.settled || now - this.tickers.at < TICKER_TTL_MS)) {
      return this.tickers.promise;
    }
    const entry: TickersEntry = {
      at: now,
      promise: this.adapter.fetchTickers(),
      settled: false,
    };
    this.tickers = entry;
    entry.promise.then(
      () => {
        entry.settled = true;
        entry.at = Date.now();
      },
      () => {
        if (this.tickers === entry) this.tickers = null;
      },
    );
    return entry.promise;
  }

  getBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    opts: HubBarsOptions = {},
  ): Promise<VenueBar[]> {
    const key = `${instrument.key}|${timeframe}|${bars}|${opts.includeForming ? 'live' : 'closed'}|${opts.to ?? ''}`;
    const ttl = opts.includeForming ? LIVE_BARS_TTL_MS : BARS_TTL_MS;
    const now = Date.now();
    const cached = this.bars.get(key);
    if (cached && (!cached.settled || now - cached.at < ttl)) {
      return this.subscribe(cached, opts.signal);
    }

    const controller = new AbortController();
    const promise = this.adapter.fetchBars(
      instrument,
      timeframe,
      bars,
      controller.signal,
      {
        includeForming: opts.includeForming,
        to: opts.to,
        priority: opts.priority,
      },
    );
    const entry: BarsEntry = {
      at: now,
      promise,
      settled: false,
      controller,
      subscribers: 0,
    };
    this.bars.set(key, entry);
    entry.promise.then(
      () => {
        entry.settled = true;
        entry.at = Date.now();
      },
      () => {
        if (this.bars.get(key) === entry) this.bars.delete(key);
      },
    );
    return this.subscribe(entry, opts.signal);
  }

  private subscribe(entry: BarsEntry, signal?: AbortSignal): Promise<VenueBar[]> {
    entry.subscribers += 1;
    if (!signal) return entry.promise;

    const onAbort = () => {
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      if (entry.subscribers === 0 && !entry.settled) entry.controller.abort();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    void entry.promise.then(
      () => signal.removeEventListener('abort', onAbort),
      () => signal.removeEventListener('abort', onAbort),
    );
    return entry.promise;
  }
}
