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

const BASE = 'https://api.exchange.coinbase.com';

/** Coinbase Exchange public market data: 10 requests / second per IP. */
export const COINBASE_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    { id: 'market', type: 'requests', limit: 8, windowMs: 1_000 },
    { id: 'candles', type: 'requests', limit: 8, windowMs: 1_000 },
  ],
};

const COINBASE_GRANULARITY: Record<string, number> = {
  '1': 60,
  '5': 300,
  '15': 900,
  '60': 3_600,
  '360': 21_600,
  D: 86_400,
};

function coinbaseGranularity(timeframe: string): number {
  const granularity = COINBASE_GRANULARITY[canonicalTimeframe(timeframe)];
  if (!granularity) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return granularity;
}

function decimals(value: string | number | undefined): number {
  const text = String(value ?? '');
  const dot = text.indexOf('.');
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function number(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface CoinbaseProduct {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: string;
  trading_disabled?: boolean;
  quote_increment?: string;
}

interface CoinbaseStats {
  stats_24hour?: {
    open?: string;
    last?: string;
    volume?: string;
  };
}

type CoinbaseCandle = [number, number, number, number, number, number];

/** Coinbase spot products quoted in USD, USDC or USDT. */
export class CoinbaseVenueAdapter implements VenueAdapter {
  readonly id = 'coinbase';
  readonly label = 'Coinbase';
  readonly capabilities = {
    markets: ['spot'] as Array<'spot'>,
    stream: false,
    funding: false,
    trading: false,
  };
  readonly rateLimit = COINBASE_RATE_LIMIT;

  private readonly limiter = new RateLimiter(COINBASE_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(
    bucket: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.limiter.run({ bucket, cost: 1 }, async () => {
        const response = await fetch(`${BASE}${path}`, {
          headers: { accept: 'application/json' },
          signal,
        });
        if (!response.ok) {
          if (response.status === 429) {
            throw new VenueRateLimitError('Coinbase 429', {
              banned: false,
              retryAfterMs: 1_000,
            });
          }
          throw new Error(`Coinbase ${response.status} for ${path}`);
        }
        return (await response.json()) as T;
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
      this.instrumentsPromise = this.request<CoinbaseProduct[]>(
        'market',
        '/products',
        signal,
      )
        .then((rows) =>
          rows
            .filter(
              (row) =>
                row.status === 'online' &&
                !row.trading_disabled &&
                ['USD', 'USDC', 'USDT'].includes(row.quote_currency),
            )
            .map((row) =>
              makeInstrument({
                venue: 'coinbase',
                nativeId: row.id,
                base: row.base_currency,
                quote: row.quote_currency,
                kind: 'spot',
                display: row.id,
                velaSymbol: `COINBASE:${row.id}`,
                pricePrecision: decimals(row.quote_increment),
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
    const [instruments, stats] = await Promise.all([
      this.listInstruments(signal),
      this.request<Record<string, CoinbaseStats>>(
        'market',
        '/products/stats',
        signal,
      ),
    ]);
    return instruments.map((instrument) => {
      const day = stats[instrument.nativeId]?.stats_24hour;
      const last = number(day?.last);
      const open = number(day?.open);
      const baseVolume = number(day?.volume);
      return {
        instrument,
        last,
        change24h: last != null && open ? ((last - open) / open) * 100 : null,
        quoteVolume:
          last != null && baseVolume != null ? last * baseVolume : null,
        funding: null,
        nextFunding: null,
      };
    });
  }

  async fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    signal?: AbortSignal,
    opts: { includeForming?: boolean; to?: number } = {},
  ): Promise<VenueBar[]> {
    const granularity = coinbaseGranularity(timeframe);
    const tfMs = timeframeMs(timeframe);
    const wanted = Math.max(1, Math.min(100_000, Math.floor(bars)));
    const confirmedOnly = opts.includeForming !== true;
    const now = Date.now();
    const pages: VenueBar[][] = [];
    let remaining = wanted;
    let end = opts.to ?? now;

    while (remaining > 0) {
      const limit = Math.min(300, remaining);
      const start = end - limit * tfMs;
      const query = new URLSearchParams({
        granularity: String(granularity),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
      const rows = await this.request<CoinbaseCandle[]>(
        'candles',
        `/products/${encodeURIComponent(instrument.nativeId)}/candles?${query.toString()}`,
        signal,
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      const mapped = rows
        .map((row) => {
          const openTime = Number(row[0]) * 1_000;
          return {
            openTime,
            closeTime: openTime + tfMs - 1,
            open: Number(row[3]),
            high: Number(row[2]),
            low: Number(row[1]),
            close: Number(row[4]),
            volume: Number(row[5]),
          };
        })
        .filter(
          (bar) =>
            (!confirmedOnly || bar.closeTime <= now) &&
            (opts.to == null || bar.openTime <= opts.to),
        )
        .sort((a, b) => a.openTime - b.openTime);
      if (mapped.length === 0) break;
      pages.push(mapped);
      remaining -= mapped.length;
      const oldest = mapped[0]!.openTime;
      if (oldest >= end) break;
      end = oldest - 1;
      if (rows.length < limit) break;
    }
    return pages.reverse().flat().slice(-wanted);
  }
}
