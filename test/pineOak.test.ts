import { describe, expect, it } from 'vitest';
import { executeScript, indicator, input, plot, ta, close } from 'oakscriptjs/script';
import { DEFAULT_SCRIPT, PRESETS } from '../src/scripts/presets';
import { runPineScript, type PineBar } from '../src/lib/pineOak/runtime';

function bars(count = 120): PineBar[] {
  return Array.from({ length: count }, (_, index) => {
    const closeValue = 100 + Math.sin(index / 7) * 6 + index * 0.05;
    return {
      time: 1_700_000_000_000 + index * 3_600_000,
      open: closeValue - 0.4,
      high: closeValue + 1.2,
      low: closeValue - 1.1,
      close: closeValue,
      volume: 1000 + index * 7,
    };
  });
}

describe('pineOak runtime', () => {
  it('runs the RSI preset and matches OakScriptJS', () => {
    const inputBars = bars();
    const result = runPineScript({ source: DEFAULT_SCRIPT, bars: inputBars, timeframe: '60' });
    expect(result.ok).toBe(true);
    expect(result.plots).toHaveLength(3);
    expect(result.missingStd).toEqual([]);

    const oak = executeScript(
      () => {
        indicator('RSI', { overlay: false });
        const length = input.int(14, 'Length');
        const rsi = ta.rsi(close, length);
        plot(rsi, 'RSI');
      },
      inputBars.map((bar) => ({ ...bar, time: bar.time / 1000 })),
    );
    const oakPlot = Object.values(oak.result.plots ?? {})[0] ?? [];
    const oakLast = oakPlot[oakPlot.length - 1]?.value;
    const runtimeValues = result.plots[0]?.values ?? [];
    const runtimeLast = runtimeValues[runtimeValues.length - 1];
    expect(runtimeLast).toBeCloseTo(oakLast ?? Number.NaN, 10);
  });

  it('runs the EMA cross preset with all plots', () => {
    const result = runPineScript({
      source: PRESETS.find((preset) => preset.id === 'ema-cross')!.source,
      bars: bars(),
      timeframe: '60',
    });
    expect(result.ok).toBe(true);
    expect(result.plots).toHaveLength(4);
    expect(result.missingStd).toEqual([]);
    for (const plot of result.plots) {
      expect(plot.values.some((value) => Number.isFinite(value))).toBe(true);
    }
  });

  it('emits drawing events for line.new', () => {
    const result = runPineScript({
      source: `//@version=6
indicator("Line", overlay=true)
if barstate.islast
    line.new(bar_index - 1, close, bar_index, close)`,
      bars: bars(30),
      timeframe: '60',
    });
    expect(result.ok).toBe(true);
    expect(result.visuals.some((event) => event.call === 'line.new')).toBe(true);
  });
});
