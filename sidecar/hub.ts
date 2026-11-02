import type { Instrument, VenueAdapter, VenueBar, VenueTicker } from '../src/venues/types';

const TICKER_TTL_MS = 3_000;
const BARS_TTL_MS = 2_000;
const LIVE_BARS_TTL_MS = 750;

interface BarsEntry {
  at: number;
  promise: Promise<VenueBar[]>;
}

/**
 * One adapter instance per venue, shared by every sidecar consumer. The hub owns
 * the short-lived caches and in-flight de-duplication; callers only see promises.
 */
export class VenueHub {
  private instruments: Promise<Instrument[]> | null = null;
  private tickers: { at: number; promise: Promise<VenueTicker[]> } | null = null;
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
    if (this.tickers && Date.now() - this.tickers.at < TICKER_TTL_MS) {
      return this.tickers.promise;
    }
    const entry = { at: Date.now(), promise: this.adapter.fetchTickers() };
    this.tickers = entry;
    entry.promise.catch(() => {
      if (this.tickers === entry) this.tickers = null;
    });
    return entry.promise;
  }

  getBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    opts: { includeForming?: boolean; to?: number } = {},
  ): Promise<VenueBar[]> {
    const key = `${instrument.key}|${timeframe}|${bars}|${opts.includeForming ? 'live' : 'closed'}|${opts.to ?? ''}`;
    const ttl = opts.includeForming ? LIVE_BARS_TTL_MS : BARS_TTL_MS;
    const cached = this.bars.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.promise;

    const entry: BarsEntry = {
      at: Date.now(),
      promise: this.adapter.fetchBars(instrument, timeframe, bars, undefined, opts),
    };
    this.bars.set(key, entry);
    entry.promise.catch(() => {
      if (this.bars.get(key) === entry) this.bars.delete(key);
    });
    return entry.promise;
  }
}
