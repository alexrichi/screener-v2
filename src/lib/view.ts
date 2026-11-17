import type { MarketFilter, QuickFilter, ScreenerView, SortState } from '../types';

export const BASE_COLUMN_KEYS = [
  'venue',
  'symbol',
  'price',
  'change24h',
  'range',
  'quoteVolume',
  'volumeChange',
  'rvol',
  'funding',
  'vwap',
  'rsi',
];

export const QUICK_FILTER_KEYS: QuickFilter[] = [
  'gainers',
  'losers',
  'rsiLow',
  'rsiHigh',
  'rvol',
  'aboveVwap',
  'belowVwap',
];

const LEGACY_FILTER_KEYS: MarketFilter[] = ['all', 'favorites', ...QUICK_FILTER_KEYS];

export const DEFAULT_VIEW: ScreenerView = {
  sort: { key: 'quoteVolume', dir: -1 },
  columns: { order: BASE_COLUMN_KEYS, hidden: [], widths: {} },
  query: '',
  filters: [],
  favoritesOnly: false,
};

/**
 * Merge new column keys into a persisted order. Base columns land next to their
 * canonical neighbour (Venue after Symbol); plot columns append.
 */
export function mergeColumnOrder(persisted: string[], allKeys: string[]): string[] {
  const order = [...persisted];
  for (const key of allKeys) {
    if (order.includes(key)) continue;
    const baseIndex = BASE_COLUMN_KEYS.indexOf(key);
    if (baseIndex < 0) {
      order.push(key);
      continue;
    }
    let insertAt = 0;
    for (let i = baseIndex - 1; i >= 0; i -= 1) {
      const previous = order.indexOf(BASE_COLUMN_KEYS[i]!);
      if (previous >= 0) {
        insertAt = previous + 1;
        break;
      }
    }
    order.splice(insertAt, 0, key);
  }
  return order;
}

/**
 * Click cycle: a new column sorts descending, then ascending, then unsorted.
 */
export function nextSort(sort: SortState | null, key: string): SortState | null {
  if (!sort || sort.key !== key) return { key, dir: -1 };
  return sort.dir === -1 ? { key, dir: 1 } : null;
}

function isSortState(value: unknown): value is SortState {
  const sort = value as Partial<SortState>;
  return (
    typeof sort === 'object' &&
    sort !== null &&
    typeof sort.key === 'string' &&
    (sort.dir === 1 || sort.dir === -1)
  );
}

export function isScreenerView(value: unknown): value is ScreenerView {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Partial<ScreenerView>;
  const columns = view.columns as Partial<ScreenerView['columns']> | undefined;
  return (
    (view.sort === null || isSortState(view.sort)) &&
    typeof view.query === 'string' &&
    (view.filter === undefined || LEGACY_FILTER_KEYS.includes(view.filter)) &&
    (view.filters === undefined ||
      (Array.isArray(view.filters) &&
        view.filters.every((filter) => QUICK_FILTER_KEYS.includes(filter)))) &&
    typeof columns === 'object' &&
    columns !== null &&
    Array.isArray(columns.order) &&
    Array.isArray(columns.hidden) &&
    typeof columns.widths === 'object' &&
    columns.widths !== null &&
    (view.favoritesOnly === undefined || typeof view.favoritesOnly === 'boolean')
  );
}
