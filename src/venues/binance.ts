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

/** The request limit `fetchKlines` uses, and therefore its Binance weight tier. */
function klinesWeight(bars: number): number {
  const limit = Math.min(1500, Math.max(2, bars + 1));
  if (limit <= 100) return 1;
  if (limit <= 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

export const BINANCE_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    // Binance USDⓈ-M default: 2400 request weight per minute per IP.
    { id: 'weight', type: 'weight', limit: 2400, windowMs: 60_000 },
  ],
};

/**
 * Binance USDT-M adapter. Public market data only; the sidecar can add the
 * trading port later without changing this shape.
 */
export class BinanceVenueAdapter implements VenueAdapter {
  readonly id = 'binance';
  readonly label = 'Binance';
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit = BINANCE_RATE_LIMIT;

  private readonly limiter = new RateLimiter(BINANCE_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(
    cost: number,
    fn: () => Promise<T>,
    signal?: AbortSignal,
    priority?: RequestPriority,
  ): Promise<T> {
    try {
      const value = await this.limiter.run({ bucket: 'weight', cost, signal, priority }, fn);
      this.limiter.observe('weight', binanceUsedWeight());
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
      this.instrumentsPromise = this.request(1, () => fetchSymbolMeta(signal), signal)
        .then((rows) =>
          rows.map((row) =>
            makeInstrument({
              venue: 'binance',
              nativeId: row.symbol,
              base: row.base,
              quote: row.quote,
              kind: 'perp',
              velaSymbol: `BINANCE:${row.symbol}.P`,
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
      this.request(50, () => fetchUniverse(signal), signal),
    ]);
    const bySymbol = new Map(instruments.map((item) => [item.nativeId, item]));
    return rows.flatMap((row) => {
      const instrument = bySymbol.get(row.symbol);
      if (!instrument) return [];
      return [{
        instrument,
        last: row.price,
        change24h: row.change24h,
        quoteVolume: row.quoteVolume,
        funding: row.funding,
        nextFunding: row.nextFunding,
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
    if (wanted <= 1500) {
      return this.request(
        klinesWeight(wanted),
        () => fetchKlines(instrument.nativeId, timeframe, wanted, signal, opts),
        signal,
        opts.priority,
      );
    }
    // Binance caps a kline page at 1500 rows; walk backward through the shared
    // limiter so a deep chart never bypasses the venue budget.
    const pages: PineBar[][] = [];
    let to = opts.to;
    let remaining = wanted;
    while (remaining > 0) {
      const page = Math.min(1500, remaining);
      const chunk = await this.request(
        klinesWeight(page),
        () =>
          fetchKlines(instrument.nativeId, timeframe, page, signal, {
            includeForming: opts.includeForming === true && pages.length === 0,
            to,
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
