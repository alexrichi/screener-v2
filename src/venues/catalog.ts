import type { VenueId } from './types';

export interface VenueCatalogEntry {
  id: VenueId;
  label: string;
}

/**
 * Venues the app exposes. The sidecar must serve the same ids; adding an
 * exchange means adding its adapter there and one entry here.
 */
export const VENUE_CATALOG: VenueCatalogEntry[] = [
  { id: 'binance', label: 'Binance' },
  { id: 'okx', label: 'OKX' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'bitget', label: 'Bitget' },
  { id: 'hyperliquid', label: 'Hyperliquid' },
  { id: 'coinbase', label: 'Coinbase' },
];

export const VENUE_IDS = VENUE_CATALOG.map((venue) => venue.id);

const VENUE_BY_ID = new Map(VENUE_CATALOG.map((venue) => [venue.id, venue]));

export function venueLabel(id: VenueId): string {
  return VENUE_BY_ID.get(id)?.label ?? id;
}

/** Persisted venue selection: known ids only, duplicates allowed but harmless. */
export function isVenueSelection(value: unknown): value is VenueId[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && VENUE_BY_ID.has(id))
  );
}
