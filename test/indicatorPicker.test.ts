import { describe, expect, it } from 'vitest';
import {
  EMPTY_PICKER_PREFS,
  buildPickerEntries,
  builtinFamilies,
  filterEntries,
  isPickerPrefs,
  libraryFamilies,
  markRecent,
  toggleFavorite,
} from '../src/lib/indicatorPicker';
import type { IndicatorRow } from '../src/types';
import type { LibraryItem } from '../src/lib/luxalgoLibrary';

function row(over: Partial<IndicatorRow>): IndicatorRow {
  return {
    index: -1,
    savedId: null,
    name: 'Indicator',
    native: false,
    category: null,
    language: null,
    nativeType: null,
    beta: false,
    present: false,
    ...over,
  };
}

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    slug: 'indicator',
    name: 'Indicator',
    family: 'momentum',
    date: 'Nov 3, 2026',
    codeId: 'code-1',
    imageUrl: '',
    description: '',
    ...over,
  };
}

const rows: IndicatorRow[] = [
  row({ savedId: 's1', name: 'My RSI', present: true }),
  row({ savedId: 's2', name: 'SMC Sweeps', present: true }),
  row({
    index: 4,
    name: 'Relative Strength Index',
    native: true,
    category: 'Basic',
    nativeType: 'rsi',
  }),
  row({
    index: 9,
    name: 'Cumulative Delta',
    native: true,
    category: 'Order flow',
    nativeType: 'cumulative-delta',
    beta: true,
    present: true,
  }),
];

const items: LibraryItem[] = [
  item({
    codeId: 'lib-smc',
    slug: 'smc-sweeps',
    name: 'SMC Sweeps',
    family: 'smc-ict',
    description: 'Structure sweeps and reclaims.',
  }),
  item({
    codeId: 'lib-rsi',
    slug: 'rsi-divergence',
    name: 'RSI Divergence',
    family: 'momentum',
    description: 'Momentum divergence detector.',
  }),
];

describe('indicator picker entries', () => {
  it('keeps native indexes and the library present flag', () => {
    const entries = buildPickerEntries(rows, items);
    const keys = entries.map((entry) => entry.key);
    expect(keys).toEqual([
      'saved:s1',
      'saved:s2',
      'native:rsi',
      'native:cumulative-delta',
      'library:lib-smc',
      'library:lib-rsi',
    ]);
    expect(entries.find((entry) => entry.key === 'native:rsi')?.index).toBe(4);
    expect(entries.find((entry) => entry.key === 'saved:s1')?.present).toBe(true);
    expect(entries.find((entry) => entry.key === 'library:lib-smc')?.present).toBe(true);
    expect(entries.find((entry) => entry.key === 'library:lib-rsi')?.present).toBe(false);
  });

  it('filters by name, family and description', () => {
    const entries = buildPickerEntries(rows, items);
    expect(filterEntries(entries, 'rsi').map((entry) => entry.name)).toEqual([
      'RSI Divergence',
      'My RSI',
      'Relative Strength Index',
    ]);
    expect(filterEntries(entries, 'smart').map((entry) => entry.name)).toEqual([]);
    expect(filterEntries(entries, 'structure').map((entry) => entry.name)).toEqual(['SMC Sweeps']);
    expect(filterEntries(entries, 'momentum').map((entry) => entry.name)).toEqual([
      'RSI Divergence',
    ]);
  });

  it('counts built-in and library families', () => {
    expect(builtinFamilies(rows)).toEqual([
      { id: 'Basic', label: 'Basic', count: 1 },
      { id: 'Order flow', label: 'Order flow', count: 1 },
    ]);
    expect(libraryFamilies(items)).toEqual([
      { id: 'momentum', label: 'Momentum', count: 1 },
      { id: 'smc-ict', label: 'SMC / ICT', count: 1 },
    ]);
  });
});

describe('indicator picker preferences', () => {
  it('toggles favorites without duplicates', () => {
    const once = toggleFavorite(EMPTY_PICKER_PREFS, 'native:rsi');
    expect(once.favorites).toEqual(['native:rsi']);
    const twice = toggleFavorite(once, 'native:rsi');
    expect(twice.favorites).toEqual([]);
  });

  it('keeps recent keys unique and capped', () => {
    let prefs = EMPTY_PICKER_PREFS;
    for (let index = 0; index < 15; index += 1) {
      prefs = markRecent(prefs, `library:${index}`);
    }
    prefs = markRecent(prefs, 'library:5');
    expect(prefs.recent).toHaveLength(12);
    expect(prefs.recent[0]).toBe('library:5');
    expect(new Set(prefs.recent).size).toBe(12);
  });

  it('validates the persisted shape', () => {
    expect(isPickerPrefs(EMPTY_PICKER_PREFS)).toBe(true);
    expect(isPickerPrefs({ version: 2, favorites: [], recent: [] })).toBe(false);
    expect(isPickerPrefs({ version: 1, favorites: [1], recent: [] })).toBe(false);
    expect(isPickerPrefs(null)).toBe(false);
  });
});
