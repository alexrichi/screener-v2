import { describe, expect, it } from 'vitest';
import {
  emptyRunSummary,
  maxBarsBackOf,
  scalarVars,
  summarizeContext,
  summarizeError,
} from '../src/lib/ai/debugResult';

const meta = {
  symbol: 'BINANCE:BTCUSDT.P',
  timeframe: '15',
  bars: 500,
  maxBarsBack: 500,
};

describe('debug result', () => {
  it('keeps the newest plot value, warnings and scalar vars from the run context', () => {
    const summary = summarizeContext(
      {
        plots: {
          p_close: { title: 'Close', data: [{ value: 1 }, { value: 2 }] },
          __internal: { title: 'Internal', data: [{ value: 9 }] },
        },
        warnings: [{ message: 'index out of bounds', method: 'array.get' }],
        const: { glb12_limit: 20 },
        var: {
          glb1_count: { data: [1, 3] },
          glb2_state: { nested: true },
        },
        let: { latest: 'buy' },
        strategy: {},
      },
      meta,
    );

    expect(summary.ok).toBe(true);
    expect(summary.error).toBeNull();
    expect(summary.plots).toEqual({ p_close: 2 });
    expect(summary.warnings).toEqual(['array.get: index out of bounds']);
    expect(summary.vars).toEqual({ count: '3', latest: 'buy', limit: '20' });
    expect(summary.strategy).toBe(true);
    expect(summary.bars).toBe(500);
    expect(summary.maxBarsBack).toBe(500);
    expect(summary.symbol).toBe('BINANCE:BTCUSDT.P');
    expect(summary.timeframe).toBe('15');
    expect(summary.logs).toEqual([]);
  });

  it('reads scalar vars through fullContext', () => {
    const vars = scalarVars({
      var: { glb1_outer: 1 },
      fullContext: { var: { glb1_inner: 2 } },
    });
    expect(vars).toEqual({ inner: '2' });
  });

  it('keeps the JS error name, method and stack', () => {
    const error = Object.assign(
      new TypeError("Cannot read properties of undefined (reading '2883')"),
      { method: 'array.get' },
    );
    const summary = summarizeError(error, meta);

    expect(summary.ok).toBe(false);
    expect(summary.error).toContain("reading '2883'");
    expect(summary.errorName).toBe('TypeError');
    expect(summary.method).toBe('array.get');
    expect(summary.stack).toContain('TypeError');
    expect(summary.bars).toBe(500);
    expect(summary.symbol).toBe('BINANCE:BTCUSDT.P');
  });

  it('reads max_bars_back and ignores scripts without it', () => {
    expect(maxBarsBackOf('//@version=6\nindicator("x", max_bars_back = 1500)')).toBe(1500);
    expect(maxBarsBackOf('indicator("x")')).toBeNull();
  });

  it('builds a complete failure summary for a missing run', () => {
    expect(emptyRunSummary(meta, 'No active chart')).toMatchObject({
      ok: false,
      error: 'No active chart',
      symbol: 'BINANCE:BTCUSDT.P',
      timeframe: '15',
      bars: 500,
      maxBarsBack: 500,
      logs: [],
    });
  });
});
