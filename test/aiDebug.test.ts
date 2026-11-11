import { describe, expect, it } from 'vitest';
import type { PineRunResult } from '@screener/pine-engine';
import {
  emptyRunSummary,
  maxBarsBackOf,
  summarizeRun,
} from '../src/lib/ai/debugResult';

const meta = {
  symbol: 'BINANCE:BTCUSDT.P',
  timeframe: '15',
  bars: 3,
  maxBarsBack: 500,
};

function engineRun(overrides: Partial<PineRunResult> = {}): PineRunResult {
  return {
    ok: true,
    name: 'Test',
    overlay: false,
    plots: [
      {
        id: 'rsi',
        title: 'RSI',
        type: 'line',
        values: [50, Number.NaN, 61.5],
      },
      {
        id: '__internal',
        title: 'Internal',
        type: 'line',
        values: [1, 2, 3],
      },
    ],
    drawings: { lines: [], boxes: [], labels: [] },
    tables: [],
    shapes: [],
    candles: [],
    priceLines: [],
    fills: [],
    barColors: [],
    inputs: [],
    alerts: [],
    warnings: ['lookback is short'],
    missingStd: ['request.currency_rate'],
    ...overrides,
  } as PineRunResult;
}

describe('debug result', () => {
  it('maps the last finite plot value, warnings and worker logs', () => {
    const summary = summarizeRun(engineRun(), meta, ['hello', 'WARN lookback']);
    expect(summary.ok).toBe(true);
    expect(summary.plots).toEqual({ rsi: 61.5 });
    expect(summary.warnings).toEqual([
      'lookback is short',
      'Unsupported Pine functions: request.currency_rate',
    ]);
    expect(summary.logs).toEqual(['hello', 'WARN lookback']);
    expect(summary.bars).toBe(3);
    expect(summary.complete).toBe(true);
  });

  it('flags a strategy run and keeps the summary empty on failure', () => {
    const strategy = summarizeRun(
      engineRun({
        strategy: { kind: 'strategy' } as unknown as PineRunResult['strategy'],
      }),
      meta,
    );
    expect(strategy.strategy).toBe(true);

    const failed = emptyRunSummary(meta, 'compile failed');
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe('compile failed');
    expect(failed.plots).toEqual({});
    expect(failed.logs).toEqual([]);
  });

  it('maps a worker debug snapshot to vars and the bar number', () => {
    const summary = summarizeRun(
      engineRun({ debug: { bar: 2, values: { src: '35', count: '3' } } }),
      meta,
    );
    expect(summary.vars).toEqual({ src: '35', count: '3' });
    expect(summary.debugBar).toBe(2);
    expect(summarizeRun(engineRun(), meta).vars).toEqual({});
    expect(summarizeRun(engineRun(), meta).debugBar).toBeUndefined();
  });

  it('reads max_bars_back from the source', () => {
    expect(maxBarsBackOf('//@version=6\nindicator("x", max_bars_back = 500)')).toBe(500);
    expect(maxBarsBackOf('//@version=6\nindicator("x")')).toBeNull();
  });
});
