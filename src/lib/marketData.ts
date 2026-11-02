import type { MarketRow, VenueId } from '../types';
import { SidecarVenueAdapter } from '../venues/sidecar';
import type { VenueTicker } from '../venues/types';

const adapters = new Map<VenueId, SidecarVenueAdapter>();

function adapterFor(venue: VenueId): SidecarVenueAdapter {
  let adapter = adapters.get(venue);
  if (!adapter) {
    adapter = new SidecarVenueAdapter(venue);
    adapters.set(venue, adapter);
  }
  return adapter;
}

function toMarketRows(tickers: VenueTicker[]): MarketRow[] {
  return tickers
    .map((ticker) => ({
      instrument: ticker.instrument,
      price: ticker.last,
      change24h: ticker.change24h,
      quoteVolume: ticker.quoteVolume,
      funding: ticker.funding,
      nextFunding: ticker.nextFunding,
    }))
    .sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface MarketRowsResult {
  rows: MarketRow[];
  /** Per-venue failure text; a failed venue does not hide the healthy ones. */
  errors: Record<string, string>;
}

/** Market rows come from the sidecar only — no direct exchange path. */
export async function fetchMarketRows(
  venues: VenueId[],
  signal?: AbortSignal,
): Promise<MarketRowsResult> {
  if (venues.length === 0) return { rows: [], errors: {} };

  const results = await Promise.allSettled(
    venues.map((venue) => adapterFor(venue).fetchTickers(signal)),
  );
  const rows: MarketRow[] = [];
  const errors: Record<string, string> = {};

  results.forEach((result, index) => {
    const venue = venues[index]!;
    if (result.status === 'fulfilled') {
      rows.push(...toMarketRows(result.value));
    } else if (!signal?.aborted) {
      errors[venue] = messageOf(result.reason);
    }
  });

  rows.sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
  return { rows, errors };
}
