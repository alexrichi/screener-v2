import {
  BinanceHttpError,
  binanceUsedWeight,
  fetchKlines,
  fetchSymbolMeta,
  fetchUniverse,
  type PineBar,
} from '../lib/binance';
import { makeInstrument } from './instrument';
import { RateLimiter, VenueRateLimitError } from './rateLimit';
import type {
  Instrument,
  RateLimitPolicy,
  RequestPriority,
  VenueAdapter,
  VenueBar,
  VenueFetchOptions,
  VenueTicker,
} from './types';

/** Spot klines cost a flat weight 2 per page, whatever the limit. */
const KLINES_WEIGHT = 2;
/** Spot has its own 1000-row page cap. */
const PAGE_SIZE = 1000;

/** Spot: 6000 weight per minute per IP, a budget separate from futures. */
export const BINANCE_SPOT_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [{ id: 'weight', type: 'weight', limit: 6000, windowMs: 60_000 }],
};

/**
 * Binance spot public market data (`api.binance.com`). Kept apart from the
 * USDⓈ-M perpetual adapter: the two are separate services with their own
 * endpoints, page caps, IP weight budgets and used-weight headers.
 */
export class BinanceSpotVenueAdapter implements VenueAdapter {
  readonly id = 'binance_spot';
  readonly label = 'Binance Spot';
  readonly capabilities = {
    markets: ['spot'] as Array<'spot' | 'perp'>,
    stream: false,
    funding: false,
    trading: false,
  };
  readonly rateLimit = BINANCE_SPOT_RATE_LIMIT;

  private readonly limiter = new RateLimiter(BINANCE_SPOT_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(
    cost: number,
    fn: () => Promise<T>,
    signal?: AbortSignal,
    priority?: RequestPriority,
  ): Promise<T> {
    try {
      const value = await this.limiter.run({ bucket: 'weight', cost, signal, priority }, fn);
      this.limiter.observe('weight', binanceUsedWeight('spot'));
      return value;
    } catch (error) {
      if (error instanceof BinanceHttpError && (error.status === 429 || error.status === 418)) {
        const banned = error.status === 418;
        const retryAfterMs = error.retryAfterMs || (banned ? 120_000 : 60_000);
        if (banned) this.limiter.banFor(retryAfterMs);
        else this.limiter.pauseFor(retryAfterMs);
        throw new VenueRateLimitError(error.message, { banned, retryAfterMs });
      }
      throw error;
    }
  }

  async listInstruments(signal?: AbortSignal): Promise<Instrument[]> {
    if (!this.instrumentsPromise) {
      this.instrumentsPromise = this.request(20, () => fetchSymbolMeta('spot', signal), signal)
        .then((rows) =>
          rows.map((row) =>
            makeInstrument({
              venue: 'binance_spot',
              nativeId: row.symbol,
              base: row.base,
              quote: row.quote,
              kind: 'spot',
              velaSymbol: `BINANCE.SPOT:${row.symbol}`,
              pricePrecision: row.pricePrecision,
              tickSize: row.tickSize,
            }),
          ),
        )
        .catch((error) => {
          this.instrumentsPromise = null;
          throw error;
        });
    }
    return this.instrumentsPromise;
  }

  async fetchTickers(signal?: AbortSignal): Promise<VenueTicker[]> {
    const [instruments, rows] = await Promise.all([
      this.listInstruments(signal),
      // Spot tickers for every symbol: weight 80.
      this.request(80, () => fetchUniverse('spot', signal), signal),
    ]);
    const byKey = new Map(instruments.map((item) => [item.nativeId, item]));
    return rows.flatMap((row) => {
      const instrument = byKey.get(row.symbol);
      if (!instrument) return [];
      return [{
        instrument,
        last: row.price,
        change24h: row.change24h,
        quoteVolume: row.quoteVolume,
        funding: null,
        nextFunding: null,
      }];
    });
  }

  async fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    signal?: AbortSignal,
    opts: VenueFetchOptions = {},
  ): Promise<VenueBar[]> {
    const wanted = Math.max(1, Math.min(100_000, Math.floor(bars)));
    if (wanted <= PAGE_SIZE) {
      return this.request(
        KLINES_WEIGHT,
        () =>
          fetchKlines(instrument.nativeId, timeframe, wanted, signal, {
            ...opts,
            kind: 'spot',
          }),
        signal,
        opts.priority,
      );
    }
    // Spot caps a kline page at 1000 rows; walk backward through the shared
    // limiter so a deep chart never bypasses the venue budget.
    const pages: PineBar[][] = [];
    let to = opts.to;
    let remaining = wanted;
    while (remaining > 0) {
      const page = Math.min(PAGE_SIZE, remaining);
      const chunk = await this.request(
        KLINES_WEIGHT,
        () =>
          fetchKlines(instrument.nativeId, timeframe, page, signal, {
            includeForming: opts.includeForming === true && pages.length === 0,
            to,
            kind: 'spot',
          }),
        signal,
        opts.priority,
      );
      if (chunk.length === 0) break;
      pages.push(chunk);
      remaining -= chunk.length;
      to = chunk[0]!.openTime - 1;
      if (chunk.length < page) break;
    }
    return pages.reverse().flat();
  }
}
