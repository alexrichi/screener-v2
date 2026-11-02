import { RestClientV2 } from 'bitget-api';
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

/** Bitget V2 public market data: 20 requests / 1 s per IP. */
export const BITGET_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    { id: 'market', type: 'requests', limit: 20, windowMs: 1_000 },
    { id: 'candles', type: 'requests', limit: 20, windowMs: 1_000 },
  ],
};

const BITGET_BARS: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1H',
  '120': '2H',
  '240': '4H',
  '360': '6H',
  '480': '8H',
  '720': '12H',
  D: '1D',
  W: '1W',
  M: '1M',
};

function bitgetBar(timeframe: string): string {
  const bar = BITGET_BARS[canonicalTimeframe(timeframe)];
  if (!bar) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return bar;
}

function number(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('429') || text.includes('40006') || /rate limit/i.test(text);
}

type BitgetCandle = [string, string, string, string, string, string, string, string];

function toBar(row: BitgetCandle, timeframe: string): VenueBar {
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

/** Bitget USDT-margined perpetual adapter on the siebly V2 SDK. */
export class BitgetVenueAdapter implements VenueAdapter {
  readonly id = 'bitget';
  readonly label = 'Bitget';
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit = BITGET_RATE_LIMIT;

  private readonly client = new RestClientV2();
  private readonly limiter = new RateLimiter(BITGET_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;

  private async request<T>(bucket: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.limiter.run({ bucket, cost: 1 }, fn);
    } catch (error) {
      if (isRateLimit(error)) {
        const retryAfterMs = 1_000;
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
        this.client.getFuturesContractConfig({ productType: 'USDT-FUTURES' }),
      )
        .then((response) =>
          response.data
            .filter(
              (row) =>
                row.symbolStatus === 'normal' &&
                row.symbolType === 'perpetual' &&
                row.quoteCoin === 'USDT',
            )
            .map((row) =>
              makeInstrument({
                venue: 'bitget',
                nativeId: row.symbol,
                base: row.baseCoin,
                quote: row.quoteCoin,
                kind: 'perp',
                velaSymbol: `BITGET:${row.symbol}`,
                pricePrecision: Number(row.pricePlace) || 2,
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
      this.request('market', () =>
        this.client.getFuturesAllTickers({ productType: 'USDT-FUTURES' }),
      ),
    ]);
    const bySymbol = new Map(instruments.map((item) => [item.nativeId, item]));
    return response.data.flatMap((row) => {
      const instrument = bySymbol.get(row.symbol);
      if (!instrument) return [];
      const last = number(row.lastPr);
      const open = number(row.open24h);
      return [
        {
          instrument,
          last,
          change24h: last != null && open ? ((last - open) / open) * 100 : null,
          quoteVolume: number(row.quoteVolume) ?? number(row.usdtVolume),
          funding: number(row.fundingRate),
          nextFunding: null,
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
    const granularity = bitgetBar(timeframe);
    const wanted = Math.max(1, Math.min(100_000, Math.floor(bars)));
    const confirmedOnly = opts.includeForming !== true;
    const pages: VenueBar[][] = [];
    let remaining = wanted;
    let end = opts.to;

    // Newest window: `/candles` serves up to 1000 rows.
    if (end == null) {
      const limit = Math.min(1000, remaining);
      const chunk = await this.page(
        instrument,
        granularity,
        timeframe,
        limit,
        undefined,
        confirmedOnly,
      );
      if (chunk.length > 0) {
        pages.push(chunk);
        remaining -= chunk.length;
        end = chunk[0]!.openTime - 1;
      }
    }

    // Older history: `/history-candles` caps a page at 200 rows.
    while (remaining > 0) {
      const limit = Math.min(200, remaining);
      const chunk = await this.historyPage(
        instrument,
        granularity,
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
    granularity: string,
    timeframe: string,
    limit: number,
    end: number | undefined,
    confirmedOnly: boolean,
  ): Promise<VenueBar[]> {
    const response = await this.request('candles', () =>
      this.client.getFuturesCandles({
        symbol: instrument.nativeId,
        productType: 'USDT-FUTURES',
        granularity: granularity as never,
        limit: String(limit),
        ...(end != null ? { endTime: String(end) } : {}),
      }),
    );
    return this.map(response.data as BitgetCandle[], timeframe, confirmedOnly);
  }

  private async historyPage(
    instrument: Instrument,
    granularity: string,
    timeframe: string,
    limit: number,
    end: number | undefined,
    confirmedOnly: boolean,
  ): Promise<VenueBar[]> {
    const response = await this.request('candles', () =>
      this.client.getFuturesHistoricCandles({
        symbol: instrument.nativeId,
        productType: 'USDT-FUTURES',
        granularity: granularity as never,
        limit: String(limit),
        ...(end != null ? { endTime: String(end) } : {}),
      }),
    );
    return this.map(response.data as BitgetCandle[], timeframe, confirmedOnly);
  }

  private map(rows: BitgetCandle[], timeframe: string, confirmedOnly: boolean): VenueBar[] {
    const now = Date.now();
    return rows
      .map((row) => toBar(row, timeframe))
      .filter((bar) => !confirmedOnly || bar.closeTime <= now)
      .sort((a, b) => a.openTime - b.openTime);
  }
}
