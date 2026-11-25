import type { VenueId } from './types';

export interface VenueCatalogEntry {
  id: VenueId;
  label: string;
  /**
   * Vela provider name for this venue's symbols, when it differs from the id.
   * Vela's symbol grammar allows `[A-Za-z0-9_.]`, not `-`.
   */
  velaName?: string;
}

/**
 * Venues the app exposes. The sidecar must serve the same ids; adding an
 * exchange means adding its adapter there and one entry here.
 */
export const VENUE_CATALOG: VenueCatalogEntry[] = [
  { id: 'binance', label: 'Binance' },
  { id: 'binance_spot', label: 'Binance Spot', velaName: 'binance.spot' },
  { id: 'okx', label: 'OKX' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'bitget', label: 'Bitget' },
  { id: 'hyperliquid', label: 'Hyperliquid' },
  { id: 'coinbase', label: 'Coinbase' },
];

export const VENUE_IDS = VENUE_CATALOG.map((venue) => venue.id);

/** The provider name Vela routes this venue's symbols to (lower case). */
export function velaNameOf(venue: VenueId): string {
  const entry = VENUE_CATALOG.find((item) => item.id === venue);
  return (entry?.velaName ?? venue).toLowerCase();
}

/** The app venue id behind a Vela provider name, if known. */
export function venueForVelaName(name: string): VenueId | undefined {
  const wanted = name.toLowerCase();
  return VENUE_CATALOG.find((entry) => (entry.velaName ?? entry.id).toLowerCase() === wanted)?.id;
}

/**
 * Each venue's own watch-threshold default. One entry per venue so a spot
 * threshold can differ from a perp one without touching the others.
 */
export const DEFAULT_MIN_VOLUME_BY_VENUE: Record<VenueId, number> = {
  binance: 1_000_000,
  binance_spot: 1_000_000,
  okx: 1_000_000,
  bybit: 1_000_000,
  bitget: 1_000_000,
  hyperliquid: 1_000_000,
  coinbase: 1_000_000,
};

export function defaultMinVolume(venue: VenueId): number {
  return DEFAULT_MIN_VOLUME_BY_VENUE[venue] ?? 1_000_000;
}

/** Spot is opt-in: the table starts with perps and single-market venues. */
export const DEFAULT_SCREENER_VENUES = VENUE_IDS.filter(
  (venue) => venue !== 'binance_spot',
);

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
