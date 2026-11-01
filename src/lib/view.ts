import type { ScreenerView, SortState } from '../types';

export const BASE_COLUMN_KEYS = ['symbol', 'price', 'change24h', 'quoteVolume', 'funding'];

export const DEFAULT_VIEW: ScreenerView = {
  sort: { key: 'quoteVolume', dir: -1 },
  columns: { order: BASE_COLUMN_KEYS, hidden: [], widths: {} },
  query: '',
  filter: 'all',
};

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
    isSortState(view.sort) &&
    typeof view.query === 'string' &&
    (view.filter === 'all' ||
      view.filter === 'gainers' ||
      view.filter === 'losers' ||
      view.filter === 'favorites') &&
    typeof columns === 'object' &&
    columns !== null &&
    Array.isArray(columns.order) &&
    Array.isArray(columns.hidden) &&
    typeof columns.widths === 'object' &&
    columns.widths !== null
  );
}
