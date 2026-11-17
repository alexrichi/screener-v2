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
/** How long a merged series may be served without a fresh fetch. */
const SERIES_TTL_MS = 30_000;
/** Hard cap per series and on the number of cached series. */
const SERIES_MAX_BARS = 5_000;
const SERIES_MAX_COUNT = 2_000;

interface BarsEntry {
  at: number;
  promise: Promise<VenueBar[]>;
  settled: boolean;
  controller: AbortController;
  subscribers: number;
}

interface SeriesEntry {
  bars: VenueBar[];
  at: number;
}

interface TickersEntry {
  at: number;
  promise: Promise<VenueTicker[]>;
  settled: boolean;
}

export interface HubBarsOptions extends VenueFetchOptions {
  signal?: AbortSignal;
}

export interface HubSeriesOptions extends VenueFetchOptions {
  signal?: AbortSignal;
  /** Number of newest bars to return. */
  limit: number;
  /** Fetch and merge a new tail instead of serving a fresh cache hit. */
  refresh?: boolean;
  /** Bars fetched for a refresh; defaults to 3. */
  refreshBars?: number;
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
  private readonly series = new Map<string, SeriesEntry>();

  constructor(readonly adapter: VenueAdapter) {}

  /**
   * A per-instrument series shared by screener metrics. Unlike `getBars`, this
   * merges a short tail request into the cached history instead of keeping one
   * array per `(bars, from, to)` key.
   */
  async getSeries(
    instrument: Instrument,
    timeframe: string,
    opts: HubSeriesOptions,
  ): Promise<VenueBar[]> {
    const includeForming = opts.includeForming !== false;
    const key = `${instrument.key}|${timeframe}|${includeForming ? 'live' : 'closed'}`;
    const limit = Math.max(1, Math.floor(opts.limit));
    const now = Date.now();
    const cached = this.series.get(key);
    const covered =
      !opts.from || (cached !== undefined && cached.bars[0]?.openTime <= opts.from);
    if (
      !opts.refresh &&
      cached &&
      cached.bars.length > 0 &&
      covered &&
      now - cached.at < SERIES_TTL_MS
    ) {
      return sliceSeries(cached.bars, opts, limit);
    }

    const fetched = await this.getBars(
      instrument,
      timeframe,
      cached && opts.refresh ? Math.min(limit, opts.refreshBars ?? 3) : limit,
      {
        includeForming,
        from: opts.from,
        to: opts.to,
        priority: opts.priority,
        signal: opts.signal,
      },
    );
    const merged = mergeSeries(cached?.bars ?? [], fetched);
    this.series.set(key, { bars: merged, at: now });
    this.pruneSeries();
    return sliceSeries(merged, opts, limit);
  }

  /** Drop merged series for one instrument, or all of them. */
  dropSeries(instrument?: Instrument): void {
    if (!instrument) {
      this.series.clear();
      return;
    }
    const prefix = `${instrument.key}|`;
    for (const key of this.series.keys()) {
      if (key.startsWith(prefix)) this.series.delete(key);
    }
  }

  private pruneSeries(): void {
    if (this.series.size <= SERIES_MAX_COUNT) return;
    const oldest = [...this.series.entries()].sort(
      ([, left], [, right]) => left.at - right.at,
    );
    const excess = this.series.size - SERIES_MAX_COUNT;
    for (let index = 0; index < excess; index += 1) {
      const entry = oldest[index];
      if (entry) this.series.delete(entry[0]);
    }
  }

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
    const key = `${instrument.key}|${timeframe}|${bars}|${opts.includeForming ? 'live' : 'closed'}|${opts.from ?? ''}|${opts.to ?? ''}`;
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
        from: opts.from,
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

function mergeSeries(cached: readonly VenueBar[], fetched: readonly VenueBar[]): VenueBar[] {
  const byTime = new Map<number, VenueBar>();
  for (const bar of cached) byTime.set(bar.openTime, bar);
  for (const bar of fetched) byTime.set(bar.openTime, bar);
  return [...byTime.values()]
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-SERIES_MAX_BARS);
}

function sliceSeries(
  bars: readonly VenueBar[],
  opts: HubSeriesOptions,
  limit: number,
): VenueBar[] {
  let out = bars;
  if (opts.from != null) out = out.filter((bar) => bar.openTime >= opts.from!);
  if (opts.to != null) out = out.filter((bar) => bar.openTime <= opts.to!);
  return out.length > limit ? out.slice(-limit) : [...out];
}
