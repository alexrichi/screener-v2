import { describe, expect, it } from 'vitest';
import {
  baseFromSymbol,
  binanceInterval,
  chartSymbol,
  spotSymbol,
} from '../src/lib/binance';
import {
  formatCompact,
  formatFunding,
  formatPct,
  formatPrice,
  layoutLabel,
} from '../src/lib/format';
import { extractPlots } from '../src/scan/extractPlots';
import { DEFAULT_VIEW, isScreenerView } from '../src/lib/view';
import { isStringArray } from '../src/lib/usePersistedState';

describe('binance symbols and intervals', () => {
  it('maps Vela futures symbols both ways', () => {
    expect(chartSymbol('BTCUSDT')).toBe('BTCUSDT.P');
    expect(chartSymbol('BTCUSDT.P')).toBe('BTCUSDT.P');
    expect(spotSymbol('BTCUSDT.P')).toBe('BTCUSDT');
    expect(baseFromSymbol('1000PEPEUSDT.P')).toBe('1000PEPE');
  });

  it('maps timeframes to Binance intervals', () => {
    expect(binanceInterval('15')).toBe('15m');
    expect(binanceInterval('60')).toBe('1h');
    expect(binanceInterval('D')).toBe('1d');
    expect(() => binanceInterval('7')).toThrow('Unsupported timeframe');
  });
});

describe('formatters', () => {
  it('keeps price precision without hiding small prices', () => {
    expect(formatPrice(77919.2, 2)).toBe('77,919.20');
    expect(formatPrice(0.0049141, 7)).toBe('0.0049141');
    expect(formatPrice(null)).toBe('—');
  });

  it('formats percentages, volume and funding', () => {
    expect(formatPct(0.58)).toBe('+0.58%');
    expect(formatPct(-3.9)).toBe('-3.90%');
    expect(formatCompact(3_700_000_000)).toBe('3.70B');
    expect(formatFunding(0.0001)).toBe('+0.0100%');
  });

  it('labels Vela layouts', () => {
    expect(layoutLabel('1')).toBe('1');
    expect(layoutLabel('2h')).toBe('2×1');
    expect(layoutLabel('4')).toBe('2×2');
    expect(layoutLabel('g3x2')).toBe('3×2');
  });
});

describe('scan plot extraction', () => {
  it('takes the last finite value and skips internal plots', () => {
    const plots = {
      rsi: {
        title: 'RSI',
        data: [{ value: 50 }, { value: NaN }, { value: 61.5 }],
      },
      __labels__: { title: 'labels', data: [{ value: 1 }] },
    };
    expect(extractPlots(plots)).toEqual([
      { key: 'rsi', title: 'RSI', value: 61.5 },
    ]);
  });

  it('returns null when a plot has no finite value', () => {
    expect(extractPlots({ x: { title: 'X', data: [{ value: null }] } })).toEqual([
      { key: 'x', title: 'X', value: null },
    ]);
  });
});

describe('screener view persistence', () => {
  it('accepts the default view and rejects broken documents', () => {
    expect(isScreenerView(DEFAULT_VIEW)).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, filter: 'favorites' })).toBe(true);
    expect(isScreenerView({ ...DEFAULT_VIEW, filter: 'wat' })).toBe(false);
    expect(isScreenerView({ ...DEFAULT_VIEW, sort: { key: 'price', dir: 2 } })).toBe(false);
    expect(isScreenerView(null)).toBe(false);
  });

  it('validates the persisted favorites list', () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['BTCUSDT', 'ETHUSDT'])).toBe(true);
    expect(isStringArray(['BTCUSDT', 1])).toBe(false);
    expect(isStringArray('BTCUSDT')).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });
});
