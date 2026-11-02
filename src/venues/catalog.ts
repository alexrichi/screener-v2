export interface VenueCatalogEntry {
  id: string;
  label: string;
}

/**
 * Venues the app exposes. The sidecar must serve the same ids; adding an
 * exchange means adding its adapter there and one entry here.
 */
export const VENUE_CATALOG: VenueCatalogEntry[] = [
  { id: 'binance', label: 'Binance' },
  { id: 'okx', label: 'OKX' },
];
