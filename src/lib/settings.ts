import type { Settings, VenueId } from '../types';
import { VENUE_IDS } from '../venues/catalog';
import { isNumber, isString } from './usePersistedState';

const LAYOUTS = new Set(['1', '2h', '2v', '4', '8']);

export function isVolumeOverrides(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([venue, amount]) => VENUE_IDS.includes(venue as VenueId) && isNumber(amount) && amount >= 0,
  );
}

export function isSettings(value: unknown): value is Settings {
  const settings = value as Partial<Settings>;
  return (
    typeof settings === 'object' &&
    settings !== null &&
    (settings.minVolumeByVenue === undefined ||
      isVolumeOverrides(settings.minVolumeByVenue)) &&
    isNumber(settings.topN) &&
    isNumber(settings.scanBars) &&
    isNumber(settings.refreshSeconds) &&
    isString(settings.scanTimeframe) &&
    isString(settings.defaultLayout) &&
    LAYOUTS.has(settings.defaultLayout)
  );
}
