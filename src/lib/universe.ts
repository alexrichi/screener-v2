import type { Instrument, MarketRow, ScanTarget, VenueId } from '../types';
import { instrumentKey } from '../venues/instrument';

/** Favorites migrated from the Binance-only table. */
export function favoriteKey(symbol: string): string {
  return symbol.includes(':') ? symbol : instrumentKey('binance', 'perp', symbol);
}

/** Apply `minVolume` and `topN` per venue, then merge by 24h quote volume. */
export function trimRowsPerVenue(
  rows: MarketRow[],
  minVolume: number,
  topN: number,
): MarketRow[] {
  const byVenue = new Map<VenueId, MarketRow[]>();
  for (const row of rows) {
    if ((row.quoteVolume ?? 0) < minVolume) continue;
    const list = byVenue.get(row.instrument.venue) ?? [];
    list.push(row);
    byVenue.set(row.instrument.venue, list);
  }

  const limit = Math.max(1, topN);
  const kept: MarketRow[] = [];
  for (const list of byVenue.values()) {
    list.sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
    kept.push(...list.slice(0, limit));
  }
  return kept.sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
}

/** Group the trimmed universe into the scanner's sequential venue passes. */
export function scanTargetsFor(rows: MarketRow[], venues: VenueId[]): ScanTarget[] {
  const byVenue = new Map<VenueId, Instrument[]>();
  for (const row of rows) {
    const list = byVenue.get(row.instrument.venue) ?? [];
    list.push(row.instrument);
    byVenue.set(row.instrument.venue, list);
  }
  return venues.flatMap((venue) => {
    const instruments = byVenue.get(venue);
    return instruments?.length ? [{ venue, instruments }] : [];
  });
}
