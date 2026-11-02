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

const INFO_URL = 'https://api.hyperliquid.xyz/info';

/** Hyperliquid info endpoint: 1200 weighted requests / minute per IP. */
export const HYPERLIQUID_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    { id: 'market', type: 'requests', limit: 60, windowMs: 60_000 },
    { id: 'candles', type: 'requests', limit: 120, windowMs: 60_000 },
  ],
};

const HL_INTERVALS: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '480': '8h',
  '720': '12h',
  D: '1d',
  W: '1w',
  M: '1M',
};

function hlInterval(timeframe: string): string {
  const interval = HL_INTERVALS[canonicalTimeframe(timeframe)];
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return interval;
}

interface HlUniverseEntry {
  name: string;
  szDecimals?: number;
  isDelisted?: boolean;
}

interface HlAssetCtx {
  markPx?: string;
  oraclePx?: string;
  funding?: string;
  dayNtlVlm?: string;
  prevDayPx?: string;
}

interface HlCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

function number(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateLimit(status: number, body: string): boolean {
  return status === 429 || body.includes('rate limit');
}

/**
 * Hyperliquid USDC-margined perpetual adapter. Public info endpoint only; the
 * venue serves roughly the latest 5000 candles per interval, so it is a
 * recent-history source rather than a deep-backfill one.
 */
export class HyperliquidVenueAdapter implements VenueAdapter {
  readonly id = 'hyperliquid';
  readonly label = 'Hyperliquid';
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit = HYPERLIQUID_RATE_LIMIT;

  private readonly limiter = new RateLimiter(HYPERLIQUID_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(
    bucket: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.limiter.run({ bucket, cost: 1 }, async () => {
        const response = await fetch(INFO_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
        const text = await response.text();
        if (!response.ok) {
          if (isRateLimit(response.status, text)) {
            throw new VenueRateLimitError(`Hyperliquid ${response.status}`, {
              banned: false,
              retryAfterMs: 60_000,
            });
          }
          throw new Error(`Hyperliquid ${response.status}: ${text.slice(0, 200)}`);
        }
        return JSON.parse(text) as T;
      });
    } catch (error) {
      if (error instanceof VenueRateLimitError) {
        this.limiter.pauseFor(error.options.retryAfterMs);
      }
      throw error;
    }
  }

  async listInstruments(signal?: AbortSignal): Promise<Instrument[]> {
    if (!this.instrumentsPromise) {
      this.instrumentsPromise = this.request<{ universe: HlUniverseEntry[] }>(
        'market',
        { type: 'meta' },
        signal,
      )
        .then((meta) =>
          (meta.universe ?? [])
            .filter((row) => row.name && !row.isDelisted)
            .map((row) =>
              makeInstrument({
                venue: 'hyperliquid',
                nativeId: row.name,
                base: row.name,
                quote: 'USD',
                kind: 'perp',
                velaSymbol: `HYPERLIQUID:${row.name}`,
                pricePrecision: 6,
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
    const [instruments, data] = await Promise.all([
      this.listInstruments(signal),
      this.request<[{ universe?: HlUniverseEntry[] }, HlAssetCtx[]]>(
        'market',
        { type: 'metaAndAssetCtxs' },
        signal,
      ),
    ]);
    const contexts = data[1] ?? [];
    const byName = new Map(
      (data[0]?.universe ?? []).map((row, index) => [row.name, contexts[index]]),
    );
    return instruments.flatMap((instrument) => {
      const ctx = byName.get(instrument.nativeId);
      if (!ctx) return [];
      const last = number(ctx.markPx) ?? number(ctx.oraclePx);
      const prev = number(ctx.prevDayPx);
      return [
        {
          instrument,
          last,
          change24h: last != null && prev ? ((last - prev) / prev) * 100 : null,
          quoteVolume: number(ctx.dayNtlVlm),
          funding: number(ctx.funding),
          nextFunding: null,
        },
      ];
    });
  }

  async fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    signal?: AbortSignal,
    opts: { includeForming?: boolean; to?: number } = {},
  ): Promise<VenueBar[]> {
    const interval = hlInterval(timeframe);
    const wanted = Math.max(1, Math.min(5000, Math.floor(bars)));
    const end = opts.to ?? Date.now();
    const start = end - (wanted + 2) * timeframeMs(timeframe);
    const candles = await this.request<HlCandle[]>(
      'candles',
      {
        type: 'candleSnapshot',
        req: {
          coin: instrument.nativeId,
          interval,
          startTime: Math.floor(start),
          endTime: Math.floor(end),
        },
      },
      signal,
    );
    const now = Date.now();
    const confirmedOnly = opts.includeForming !== true;
    return candles
      .map((row) => ({
        openTime: Number(row.t),
        closeTime: Number(row.T),
        open: Number(row.o),
        high: Number(row.h),
        low: Number(row.l),
        close: Number(row.c),
        volume: Number(row.v),
      }))
      .filter(
        (bar) =>
          (!confirmedOnly || bar.closeTime <= now) &&
          (opts.to == null || bar.openTime <= opts.to),
      )
      .sort((a, b) => a.openTime - b.openTime)
      .slice(-wanted);
  }
}
