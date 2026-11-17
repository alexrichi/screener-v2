import type { MarketFilter, ScreenerRow, ScreenerView } from '../types';
import { venueLabel } from '../venues/catalog';

export type ScreenerFilterInput = Pick<
  ScreenerView,
  'filter' | 'favoritesOnly' | 'query'
>;

export function searchText(row: ScreenerRow): string {
  return `${row.instrument.nativeId} ${row.instrument.base} ${venueLabel(
    row.instrument.venue,
  )}`.toUpperCase();
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
 * The favorite scope, one quick filter and the search combine with AND.
 * `filter: 'favorites'` is the legacy stored form of `favoritesOnly`.
 */
export function filterScreenerRows(
  rows: readonly ScreenerRow[],
  view: ScreenerFilterInput,
  favorites: ReadonlySet<string>,
): ScreenerRow[] {
  const favoriteScope = view.favoritesOnly === true || view.filter === 'favorites';
  const condition: MarketFilter = view.filter === 'favorites' ? 'all' : view.filter;
  const needle = view.query.trim().toUpperCase();
  return rows.filter((row) => {
    if (favoriteScope && !favorites.has(row.instrument.key)) return false;
    if (!matchesCondition(row, condition)) return false;
    return !needle || searchText(row).includes(needle);
  });
}
