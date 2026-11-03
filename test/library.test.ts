import { describe, expect, it } from 'vitest';
import { filterLibrary, libraryPageUrl, type LibraryItem } from '../src/lib/luxalgoLibrary';

const items: LibraryItem[] = [
  {
    slug: 'connors-rsi',
    name: 'Connors RSI',
    family: 'momentum',
    date: '2020-04-13',
    codeId: 'a1',
    imageUrl: 'https://example.com/a.png',
    description: 'A mean-reversion oscillator over short-term price changes.',
  },
  {
    slug: 'smart-money-concepts-smc',
    name: 'Smart Money Concepts (SMC)',
    family: 'smc-ict',
    date: '2024-01-05',
    codeId: 'b2',
    imageUrl: 'https://example.com/b.png',
    description: 'Order blocks, liquidity sweeps and market structure.',
  },
];

describe('LuxAlgo Library catalog', () => {
  it('keeps the bundled order for an empty query', () => {
    expect(filterLibrary(items, '')).toEqual(items);
    expect(filterLibrary(items, '   ')).toEqual(items);
  });

  it('matches names, families and descriptions case-insensitively', () => {
    expect(filterLibrary(items, 'connors').map((item) => item.slug)).toEqual(['connors-rsi']);
    expect(filterLibrary(items, 'SMC').map((item) => item.slug)).toEqual([
      'smart-money-concepts-smc',
    ]);
    expect(filterLibrary(items, 'liquidity').map((item) => item.slug)).toEqual([
      'smart-money-concepts-smc',
    ]);
  });

  it('returns no rows when nothing matches', () => {
    expect(filterLibrary(items, 'ichimoku')).toHaveLength(0);
  });

  it('builds the canonical Library page URL', () => {
    expect(libraryPageUrl('smart-money-concepts-smc')).toBe(
      'https://www.luxalgo.com/library/indicator/smart-money-concepts-smc/',
    );
  });
});
