import type { IndicatorRow } from '../types';
import { FAMILY_ORDER, familyLabel, type LibraryItem } from './luxalgoLibrary';

export type PickerKind = 'native' | 'saved' | 'library';

/** One row or card in the indicator picker. */
export interface PickerEntry {
  /** Stable identity across reloads: `native:<type>`, `saved:<id>`, `library:<codeId>`. */
  key: string;
  kind: PickerKind;
  name: string;
  family: string;
  present: boolean;
  /** Native index in `ChartCell.libraryRows()`. */
  index?: number;
  nativeType?: string | null;
  beta?: boolean;
  savedId?: string;
  item?: LibraryItem;
  /** Lower-cased haystack: name, family, description and slug. */
  search: string;
}

export interface PickerFamily {
  id: string;
  label: string;
  count: number;
}

export interface PickerPrefs {
  version: 1;
  favorites: string[];
  recent: string[];
}

export const PICKER_PREFS_KEY = 'screener.indicators.picker.v1';
export const PICKER_RECENT_LIMIT = 12;

export const EMPTY_PICKER_PREFS: PickerPrefs = { version: 1, favorites: [], recent: [] };

export function isPickerPrefs(value: unknown): value is PickerPrefs {
  if (!value || typeof value !== 'object') return false;
  const prefs = value as Record<string, unknown>;
  if (prefs.version !== 1) return false;
  for (const key of ['favorites', 'recent'] as const) {
    const list = prefs[key];
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) return false;
  }
  return true;
}

/** Row entries first, then the bundled Library catalog. */
export function buildPickerEntries(
  rows: readonly IndicatorRow[],
  items: readonly LibraryItem[],
): PickerEntry[] {
  const presentNames = new Set(rows.filter((row) => row.present && !row.native).map((row) => row.name));
  const entries: PickerEntry[] = [];
  for (const row of rows) {
    if (row.savedId) {
      entries.push({
        key: `saved:${row.savedId}`,
        kind: 'saved',
        name: row.name,
        family: 'My scripts',
        present: row.present,
        savedId: row.savedId,
        search: `${row.name} my scripts`.toLowerCase(),
      });
      continue;
    }
    if (!row.native) continue;
    entries.push({
      key: `native:${row.nativeType ?? row.name}`,
      kind: 'native',
      name: row.name,
      family: row.category ?? 'Built-in',
      present: row.present,
      index: row.index,
      nativeType: row.nativeType,
      beta: row.beta,
      search: `${row.name} ${row.category ?? 'built-in'} ${row.nativeType ?? ''}`.toLowerCase(),
    });
  }
  for (const item of items) {
    entries.push({
      key: `library:${item.codeId}`,
      kind: 'library',
      name: item.name,
      family: familyLabel(item.family),
      present: presentNames.has(item.name),
      item,
      search: `${item.name} ${familyLabel(item.family)} ${item.family} ${item.description} ${item.slug}`.toLowerCase(),
    });
  }
  return entries;
}

function relevance(entry: PickerEntry, needle: string): number {
  const name = entry.name.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if ((entry.nativeType ?? '').toLowerCase().includes(needle)) return 2;
  if (entry.family.toLowerCase().includes(needle)) return 3;
  return 4;
}

export function filterEntries(
  entries: readonly PickerEntry[],
  query: string,
): PickerEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries
    .filter((entry) => entry.search.includes(needle))
    .sort(
      (a, b) => relevance(a, needle) - relevance(b, needle) || a.name.localeCompare(b.name),
    );
}

export function builtinFamilies(rows: readonly IndicatorRow[]): PickerFamily[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.native) continue;
    const family = row.category ?? 'Other';
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function libraryFamilies(items: readonly LibraryItem[]): PickerFamily[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
  }
  const rank = new Map(FAMILY_ORDER.map((id, index) => [id, index]));
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: familyLabel(id), count }))
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? FAMILY_ORDER.length) - (rank.get(b.id) ?? FAMILY_ORDER.length) ||
        a.label.localeCompare(b.label),
    );
}

export function toggleFavorite(prefs: PickerPrefs, key: string): PickerPrefs {
  const favorites = prefs.favorites.includes(key)
    ? prefs.favorites.filter((entry) => entry !== key)
    : [key, ...prefs.favorites];
  return { ...prefs, favorites };
}

export function markRecent(prefs: PickerPrefs, key: string): PickerPrefs {
  const recent = [key, ...prefs.recent.filter((entry) => entry !== key)].slice(
    0,
    PICKER_RECENT_LIMIT,
  );
  return { ...prefs, recent };
}
