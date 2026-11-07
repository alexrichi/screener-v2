import { describe, expect, it } from 'vitest';
import {
  isStoredScale,
  scaledRange,
  scalePayload,
  visibleBars,
  type StoredScale,
} from '../src/lib/scaleState';

const cached: StoredScale = {
  symbol: 'BINANCE:BTCUSDT.P',
  timeframe: '60',
  bars: 42,
};

describe('scale state', () => {
  it('accepts a positive whole bar count', () => {
    expect(isStoredScale(cached)).toBe(true);
    expect(isStoredScale({ ...cached, bars: 1 })).toBe(true);
    expect(isStoredScale({ ...cached, bars: 0 })).toBe(false);
    expect(isStoredScale({ ...cached, bars: 1.5 })).toBe(false);
    expect(isStoredScale({ ...cached, bars: Number.NaN })).toBe(false);
    expect(isStoredScale({ ...cached, symbol: 1 })).toBe(false);
    expect(isStoredScale(null)).toBe(false);
  });

  it('counts both visible ends', () => {
    expect(visibleBars({ from: 0, to: 4 * 60_000 }, 60_000)).toBe(5);
    expect(visibleBars({ from: 0, to: 0 }, 60_000)).toBe(1);
    expect(visibleBars({ from: 0, to: 1 }, 0)).toBe(0);
  });

  it('keeps the right margin in bars and anchors the data window at the last bar', () => {
    expect(scaledRange(1_000, 5, 10, 1)).toEqual({ from: 996, to: 1_010 });
    expect(scaledRange(1_000, 5, 0, 1)).toEqual({ from: 996, to: 1_000 });
    expect(scaledRange(1_000, 5, Number.NaN, 1)).toEqual({ from: 996, to: 1_000 });
    expect(visibleBars({ from: 996, to: 1_000 }, 1)).toBe(5);
  });

  it('keeps the cached zoom while the chart cannot report a range', () => {
    const market = { symbol: cached.symbol, timeframe: cached.timeframe };
    expect(scalePayload(cached, market, null, 60_000)).toBe(cached);
    expect(scalePayload(cached, null, null, 0)).toBe(cached);
    expect(scalePayload(undefined, null, null, 0)).toBeUndefined();
  });

  it('never hands the cached zoom to another market', () => {
    expect(
      scalePayload(cached, { symbol: 'BINANCE:ETHUSDT.P', timeframe: '60' }, null, 60_000),
    ).toBeUndefined();
    expect(
      scalePayload(cached, { symbol: cached.symbol, timeframe: '240' }, null, 240_000),
    ).toBeUndefined();
  });

  it('a fresh range wins', () => {
    const market = { symbol: cached.symbol, timeframe: cached.timeframe };
    expect(scalePayload(cached, market, { from: 0, to: 4 * 60_000 }, 60_000)).toEqual({
      ...market,
      bars: 5,
    });
  });
});
