import { RestClient } from 'okx-api';
import { WebSocket } from 'ws';
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

/** OKX public market-data windows: 20 requests / 2 s per endpoint. */
export const OKX_RATE_LIMIT: RateLimitPolicy = {
  maxConcurrent: 4,
  buckets: [
    { id: 'market', type: 'requests', limit: 20, windowMs: 2_000 },
    { id: 'candles', type: 'requests', limit: 20, windowMs: 2_000 },
  ],
};

const OKX_BARS: Record<string, string> = {
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

function okxBar(timeframe: string): string {
  const bar = OKX_BARS[canonicalTimeframe(timeframe)];
  if (!bar) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return bar;
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

export interface OkxFundingUpdate {
  instId: string;
  funding: number | null;
  nextFunding: number | null;
}

/** Parse one OKX `funding-rate` WebSocket frame; ignore acks and pongs. */
export function parseOkxFunding(raw: string): OkxFundingUpdate[] {
  const message = JSON.parse(raw) as {
    arg?: { channel?: string; instId?: string };
    data?: Array<Record<string, string>>;
  };
  if (message.arg?.channel !== 'funding-rate' || !Array.isArray(message.data)) {
    return [];
  }
  return message.data.flatMap((row) => {
    const instId = row.instId ?? message.arg?.instId;
    if (!instId) return [];
    return [
      {
        instId,
        funding: number(row.fundingRate),
        nextFunding:
          number(row.nextFundingTime) ?? number(row.fundingTime),
      },
    ];
  });
}

const OKX_FUNDING_WS = 'wss://ws.okx.com:8443/ws/v5/public';
const RECONNECT_MS = 2_000;
const PING_MS = 25_000;

function isRateLimit(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('50011') || text.includes('429') || /rate limit/i.test(text);
}

type OkxCandle = [string, string, string, string, string, string, string, string, string];

function toBar(candle: OkxCandle, timeframe: string): VenueBar {
  const openTime = Number(candle[0]);
  return {
    openTime,
    closeTime: openTime + timeframeMs(timeframe) - 1,
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[6]),
  };
}

function isConfirmed(candle: OkxCandle): boolean {
  return candle[8] !== '0';
}

/**
 * OKX USDT-margined perpetual adapter. The siebly SDK is the transport; every
 * call goes through this adapter's own rate policy.
 */
export class OkxVenueAdapter implements VenueAdapter {
  readonly id = 'okx';
  readonly label = 'OKX';
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit = OKX_RATE_LIMIT;

  private readonly client = new RestClient();
  private readonly limiter = new RateLimiter(OKX_RATE_LIMIT);
  private instrumentsPromise: Promise<Instrument[]> | null = null;
  private readonly funding = new Map<string, OkxFundingUpdate>();
  private fundingSocket: WebSocket | null = null;
  private fundingPing: NodeJS.Timeout | null = null;
  private fundingRetry: NodeJS.Timeout | null = null;
  private fundingStarted = false;

  private async request<T>(bucket: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.limiter.run({ bucket, cost: 1 }, fn);
    } catch (error) {
      if (isRateLimit(error)) {
        const retryAfterMs = 2_000;
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
        this.client.getInstruments({ instType: 'SWAP' }),
      )
        .then((rows) =>
          rows
            .filter(
              (row) =>
                row.state === 'live' &&
                row.settleCcy === 'USDT' &&
                row.instId.endsWith('-USDT-SWAP'),
            )
            .map((row) => {
              const [base, quote] = row.instId.split('-');
              return makeInstrument({
                venue: 'okx',
                nativeId: row.instId,
                base: base ?? row.instId,
                quote: quote ?? 'USDT',
                kind: 'perp',
                velaSymbol: `OKX:${row.instId}`,
                pricePrecision: decimals(row.tickSz),
              });
            }),
        )
        .catch((error) => {
          this.instrumentsPromise = null;
          throw error;
        });
    }
    return this.instrumentsPromise;
  }

  private clearFundingPing(): void {
    if (this.fundingPing) {
      clearInterval(this.fundingPing);
      this.fundingPing = null;
    }
  }

  private startFunding(instruments: Instrument[]): void {
    if (this.fundingStarted) return;
    this.fundingStarted = true;
    this.connectFunding(instruments);
  }

  private connectFunding(instruments: Instrument[]): void {
    if (this.fundingSocket || !this.fundingStarted) return;
    const socket = new WebSocket(OKX_FUNDING_WS);
    this.fundingSocket = socket;

    socket.on('open', () => {
      if (this.fundingSocket !== socket) return;
      this.fundingPing = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, PING_MS);
      socket.send(
        JSON.stringify({
          op: 'subscribe',
          args: instruments.map((instrument) => ({
            channel: 'funding-rate',
            instId: instrument.nativeId,
          })),
        }),
      );
    });

    socket.on('message', (raw) => {
      try {
        for (const update of parseOkxFunding(raw.toString())) {
          this.funding.set(update.instId, update);
        }
      } catch {
        /* ignore malformed frames and keep the last snapshot */
      }
    });

    socket.on('close', () => {
      if (this.fundingSocket !== socket) return;
      this.fundingSocket = null;
      this.clearFundingPing();
      if (!this.fundingStarted || this.fundingRetry) return;
      this.fundingRetry = setTimeout(() => {
        this.fundingRetry = null;
        this.connectFunding(instruments);
      }, RECONNECT_MS);
    });

    socket.on('error', (error) => {
      console.warn(
        '[okx] funding socket error',
        error instanceof Error ? error.message : error,
      );
    });
  }

  async fetchTickers(): Promise<VenueTicker[]> {
    const [instruments, rows] = await Promise.all([
      this.listInstruments(),
      this.request('market', () => this.client.getTickers({ instType: 'SWAP' })),
    ]);
    this.startFunding(instruments);
    const byId = new Map(instruments.map((item) => [item.nativeId, item]));
    return rows.flatMap((row) => {
      const instrument = byId.get(row.instId);
      if (!instrument) return [];
      const last = number(row.last);
      const open = number(row.open24h);
      const baseVolume = number(row.volCcy24h);
      const funding = this.funding.get(instrument.nativeId);
      return [
        {
          instrument,
          last,
          change24h: last != null && open ? ((last - open) / open) * 100 : null,
          quoteVolume:
            last != null && baseVolume != null ? last * baseVolume : null,
          funding: funding?.funding ?? null,
          nextFunding: funding?.nextFunding ?? null,
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
    const bar = okxBar(timeframe);
    const wanted = Math.max(1, Math.min(100_000, Math.floor(bars)));
    const confirmedOnly = opts.includeForming !== true;

    // Newest window: the capped `/candles` endpoint is enough and returns the
    // forming candle.
    if (opts.to == null && wanted <= 300) {
      const rows = (await this.request('candles', () =>
        this.client.getCandles({
          instId: instrument.nativeId,
          bar,
          limit: String(wanted),
        }),
      )) as OkxCandle[];
      return rows
        .filter((row) => !confirmedOnly || isConfirmed(row))
        .map((row) => toBar(row, timeframe))
        .sort((a, b) => a.openTime - b.openTime);
    }

    // Older windows and deep history: walk backward in 100-row pages.
    const pages: VenueBar[][] = [];
    let remaining = wanted;
    let after: string | undefined =
      opts.to != null ? String(Math.floor(opts.to) + 1) : undefined;
    while (remaining > 0) {
      const limit = Math.min(remaining, 100);
      const rows = (await this.request('candles', () =>
        this.client.getHistoricCandles({
          instId: instrument.nativeId,
          bar,
          limit: String(limit),
          after,
        }),
      )) as OkxCandle[];
      if (rows.length === 0) break;
      const mapped = rows
        .filter((row) => !confirmedOnly || isConfirmed(row))
        .map((row) => toBar(row, timeframe))
        .filter((row) => opts.to == null || row.openTime <= opts.to)
        .sort((a, b) => a.openTime - b.openTime);
      if (mapped.length === 0) break;
      pages.push(mapped);
      remaining -= mapped.length;
      const oldest = mapped[0]!.openTime;
      if (after != null && Number(after) <= oldest) break;
      after = String(oldest);
      if (rows.length < limit) break;
    }
    return pages.reverse().flat();
  }
}
