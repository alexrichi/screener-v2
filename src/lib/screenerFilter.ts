import type { MarketFilter, QuickFilter, ScreenerRow, ScreenerView } from '../types';
import { venueLabel } from '../venues/catalog';
import { QUICK_FILTER_KEYS } from './view';

export type ScreenerFilterInput = Pick<
  ScreenerView,
  'filters' | 'filter' | 'favoritesOnly' | 'query'
>;

export function searchText(row: ScreenerRow): string {
  return `${row.instrument.nativeId} ${row.instrument.base} ${venueLabel(
    row.instrument.venue,
  )}`.toUpperCase();
}

/** Active quick filters; an old single `filter` document still works. */
export function activeQuickFilters(view: ScreenerFilterInput): QuickFilter[] {
  if (view.filters) return view.filters;
  const legacy = view.filter;
  return legacy && QUICK_FILTER_KEYS.includes(legacy as QuickFilter)
    ? [legacy as QuickFilter]
    : [];
}

function matchesCondition(row: ScreenerRow, filter: MarketFilter): boolean {
  switch (filter) {
    case 'gainers':
      return (row.change24h ?? 0) > 0;
    case 'losers':
      return (row.change24h ?? 0) < 0;
    case 'rsiLow':
      return (row.metrics.rsi ?? 100) < 30;
    case 'rsiHigh':
      return (row.metrics.rsi ?? 0) > 70;
    case 'rvol':
      return (row.metrics.rvol ?? 0) >= 1.5;
    case 'aboveVwap':
      return (row.metrics.vwapZ ?? 0) > 0;
    case 'belowVwap':
      return (row.metrics.vwapZ ?? 0) < 0;
    default:
      return true;
  }
}

/**
 * The favorite scope, every active quick filter and the search combine with
 * AND. `filter: 'favorites'` is the legacy stored form of `favoritesOnly`.
 */
export function filterScreenerRows(
  rows: readonly ScreenerRow[],
  view: ScreenerFilterInput,
  favorites: ReadonlySet<string>,
): ScreenerRow[] {
  const favoriteScope = view.favoritesOnly === true || view.filter === 'favorites';
  const filters = activeQuickFilters(view);
  const needle = view.query.trim().toUpperCase();
  return rows.filter((row) => {
    if (favoriteScope && !favorites.has(row.instrument.key)) return false;
    if (!filters.every((filter) => matchesCondition(row, filter))) return false;
    return !needle || searchText(row).includes(needle);
  });
}
