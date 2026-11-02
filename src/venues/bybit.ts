import { RestClientV5 } from 'bybit-api';
import { canonicalTimeframe, timeframeMs } from '../lib/timeframe';
import { makeInstrument } from './instrument';
import { RateLimiter, VenueRateLimitError } from './rateLimit';
import type {
  Instrument,
  RateLimitPolicy,
  VenueAdapter,
  VenueBar,
  VenueTicker,
} from './types';

/** Bybit V5 public market data: 600 requests / 5 s per IP; stay well below. */
export const BYBIT_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    { id: 'market', type: 'requests', limit: 100, windowMs: 5_000 },
    { id: 'candles', type: 'requests', limit: 120, windowMs: 5_000 },
  ],
};

function bybitInterval(timeframe: string): string {
  const canonical = canonicalTimeframe(timeframe);
  if (!['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'].includes(canonical)) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }
  return canonical;
}

function number(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('10006') || text.includes('429') || /rate limit/i.test(text);
}

type BybitKline = [string, string, string, string, string, string, string];

function toBar(row: BybitKline, timeframe: string): VenueBar {
  const openTime = Number(row[0]);
  return {
    openTime,
    closeTime: openTime + timeframeMs(timeframe) - 1,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

/** Bybit USDT-margined perpetual adapter on the siebly V5 SDK. */
export class BybitVenueAdapter implements VenueAdapter {
  readonly id = 'bybit';
  readonly label = 'Bybit';
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit = BYBIT_RATE_LIMIT;

  private readonly client = new RestClientV5();
  private readonly limiter = new RateLimiter(BYBIT_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(bucket: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.limiter.run({ bucket, cost: 1 }, fn);
    } catch (error) {
      if (isRateLimit(error)) {
        const retryAfterMs = 5_000;
        this.limiter.pauseFor(retryAfterMs);
        throw new VenueRateLimitError(
          error instanceof Error ? error.message : String(error),
          { banned: false, retryAfterMs },
        );
      }
      throw error;
    }
  }

  async listInstruments(): Promise<Instrument[]> {
    if (!this.instrumentsPromise) {
      this.instrumentsPromise = this.request('market', () =>
        this.client.getInstrumentsInfo({ category: 'linear' }),
      )
        .then((response) =>
          response.result.list
            .filter(
              (row) =>
                row.status === 'Trading' &&
                row.contractType === 'LinearPerpetual' &&
                row.quoteCoin === 'USDT' &&
                row.settleCoin === 'USDT',
            )
            .map((row) =>
              makeInstrument({
                venue: 'bybit',
                nativeId: row.symbol,
                base: row.baseCoin,
                quote: row.quoteCoin,
                kind: 'perp',
                velaSymbol: `BYBIT:${row.symbol}`,
                pricePrecision: Number(row.priceScale) || 2,
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

  async fetchTickers(): Promise<VenueTicker[]> {
    const [instruments, response] = await Promise.all([
      this.listInstruments(),
      this.request('market', () => this.client.getTickers({ category: 'linear' })),
    ]);
    const bySymbol = new Map(instruments.map((item) => [item.nativeId, item]));
    return response.result.list.flatMap((row) => {
      const instrument = bySymbol.get(row.symbol);
      if (!instrument) return [];
      return [
        {
          instrument,
          last: number(row.lastPrice),
          change24h:
            row.price24hPcnt != null ? Number(row.price24hPcnt) * 100 : null,
          quoteVolume: number(row.turnover24h),
          funding: number(row.fundingRate),
          nextFunding: number(row.nextFundingTime) || null,
        },
      ];
    });
  }

  async fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    _signal?: AbortSignal,
    opts: { includeForming?: boolean; to?: number } = {},
  ): Promise<VenueBar[]> {
    const interval = bybitInterval(timeframe);
    const wanted = Math.max(1, Math.min(100_000, Math.floor(bars)));
    const confirmedOnly = opts.includeForming !== true;

    if (opts.to == null && wanted <= 1000) {
      return this.page(instrument, interval, timeframe, wanted, undefined, confirmedOnly);
    }

    const pages: VenueBar[][] = [];
    let remaining = wanted;
    let end = opts.to;
    while (remaining > 0) {
      const limit = Math.min(1000, remaining);
      const chunk = await this.page(
        instrument,
        interval,
        timeframe,
        limit,
        end,
        confirmedOnly,
      );
      if (chunk.length === 0) break;
      const filtered = chunk.filter((bar) => opts.to == null || bar.openTime <= opts.to);
      if (filtered.length === 0) break;
      pages.push(filtered);
      remaining -= filtered.length;
      const oldest = filtered[0]!.openTime;
      if (end != null && oldest >= end) break;
      end = oldest - 1;
      if (chunk.length < limit) break;
    }
    return pages.reverse().flat();
  }

  private async page(
    instrument: Instrument,
    interval: string,
    timeframe: string,
    limit: number,
    end: number | undefined,
    confirmedOnly: boolean,
  ): Promise<VenueBar[]> {
    const response = await this.request('candles', () =>
      this.client.getKline({
        category: 'linear',
        symbol: instrument.nativeId,
        interval: interval as never,
        limit,
        ...(end != null ? { end } : {}),
      }),
    );
    const now = Date.now();
    return (response.result.list as BybitKline[])
      .map((row) => toBar(row, timeframe))
      .filter((bar) => !confirmedOnly || bar.closeTime <= now)
      .sort((a, b) => a.openTime - b.openTime);
  }
}
