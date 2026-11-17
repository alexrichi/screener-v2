import type { Instrument, MarketRow, ScanTarget, VenueId } from '../types';
import { instrumentKey } from '../venues/instrument';

/** Favorites migrated from the Binance-only table. */
export function favoriteKey(symbol: string): string {
  return symbol.includes(':') ? symbol : instrumentKey('binance', 'perp', symbol);
}

/** Group the watched universe into the scanner's sequential venue passes. */
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
