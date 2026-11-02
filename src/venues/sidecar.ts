import { BINANCE_RATE_LIMIT } from './binance';
import { VenueRateLimitError } from './rateLimit';
import type {
  Instrument,
  RateLimitPolicy,
  VenueAdapter,
  VenueBar,
  VenueTicker,
} from './types';

const DEFAULT_BASE = 'http://127.0.0.1:8787';

function defaultBaseUrl(): string {
  const configured = import.meta.env.VITE_SIDECAR_URL as string | undefined;
  return (configured || DEFAULT_BASE).replace(/\/+$/, '');
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    if (response.status === 429 || response.status === 418) {
      throw new VenueRateLimitError(`Sidecar ${response.status}`, {
        banned: response.status === 418,
        retryAfterMs,
      });
    }
    throw new Error(`Sidecar ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

/**
 * Browser/worker client for the sidecar. The sidecar owns venue rate limits and
 * SDK credentials; this class only speaks the normalized HTTP protocol.
 */
export class SidecarVenueAdapter implements VenueAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities = {
    markets: ['perp'] as Array<'perp'>,
    stream: false,
    funding: true,
    trading: false,
  };
  readonly rateLimit: RateLimitPolicy;

  private instrumentsPromise: Promise<Instrument[]> | null = null;

  constructor(
    id = 'binance',
    private readonly baseUrl = defaultBaseUrl(),
    rateLimit: RateLimitPolicy = BINANCE_RATE_LIMIT,
  ) {
    this.id = id;
    this.label = id;
    this.rateLimit = rateLimit;
  }

  async listInstruments(signal?: AbortSignal): Promise<Instrument[]> {
    if (!this.instrumentsPromise) {
      this.instrumentsPromise = getJson<Instrument[]>(
        `${this.baseUrl}/venues/${encodeURIComponent(this.id)}/instruments`,
        signal,
      ).catch((error) => {
        this.instrumentsPromise = null;
        throw error;
      });
    }
    return this.instrumentsPromise;
  }

  fetchTickers(signal?: AbortSignal): Promise<VenueTicker[]> {
    return getJson<VenueTicker[]>(
      `${this.baseUrl}/venues/${encodeURIComponent(this.id)}/tickers`,
      signal,
    );
  }

  fetchBars(
    instrument: Instrument,
    timeframe: string,
    bars: number,
    signal?: AbortSignal,
    opts: { includeForming?: boolean; to?: number } = {},
  ): Promise<VenueBar[]> {
    const query = new URLSearchParams({
      instrument: instrument.key,
      timeframe,
      bars: String(bars),
    });
    if (opts.includeForming) query.set('live', '1');
    if (opts.to != null) query.set('to', String(Math.floor(opts.to)));
    return getJson<VenueBar[]>(
      `${this.baseUrl}/venues/${encodeURIComponent(this.id)}/bars?${query.toString()}`,
      signal,
    );
  }
}
