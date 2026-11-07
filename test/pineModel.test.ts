import { describe, expect, it } from 'vitest';
import type {
  PineCandleSeries,
  PineFill,
  PinePriceLine,
  PineProgram,
  PineRunResult,
} from '@screener/pine-engine';
import { modelOf } from '../src/lib/pineVela/engine';

const bars = [{ time: 1_000 }, { time: 2_000 }, { time: 3_000 }];

const priceLines: PinePriceLine[] = [
  { id: 0, price: 70, title: 'Upper', color: '#FF5252', width: 2, style: 'dashed' },
  { id: 1, price: 30, title: 'Lower', color: '#4CAF50', width: 1, style: 'solid' },
];

const fills: PineFill[] = [
  {
    id: 'plot:0>hline:0',
    from: { kind: 'plot', index: 0 },
    to: { kind: 'hline', index: 0, price: 70 },
    color: '#2962FF33',
  },
  {
    id: 'hline:0>hline:1',
    from: { kind: 'hline', index: 0, price: 70 },
    to: { kind: 'hline', index: 1, price: 30 },
    colors: ['#FF5252', null, '#4CAF50'],
  },
];

const candles: PineCandleSeries[] = [
  {
    id: 0,
    title: 'Probe candle',
    kind: 'candle',
    color: '#2962FF',
    bars: bars.map((bar) => ({ time: bar.time, open: 1, high: 2, low: 0, close: 1 })),
    barColors: [{ color: '#4CAF50' }, null, { color: '#FF5252', wickColor: '#2962FF' }],
  },
];

function runResult(): PineRunResult {
  return {
    ok: true,
    name: 'Probe',
    overlay: false,
    plots: [{ id: 'plot_0', title: 'RSI', type: 'line', values: [50, 60, 70] }],
    drawings: { lines: [], boxes: [], labels: [], backgrounds: [], linefills: [], polylines: [] },
    tables: [],
    shapes: [],
    candles,
    priceLines,
    fills,
    barColors: [
      { time: 1_000, color: '#4CAF50' },
      { time: 3_000, color: '#FF5252' },
    ],
    inputs: [],
    alerts: [],
    warnings: [],
    missingStd: [],
  };
}

function programOf(run: PineRunResult): PineProgram {
  return {
    ok: true,
    meta: { name: 'Probe', overlay: false, inputs: [], plots: [], warnings: [] },
    run: () => run,
  };
}

describe('pine model', () => {
  it('maps price lines, fills and bar colors into the Vela model', () => {
    const run = runResult();
    const model = modelOf({ program: programOf(run), instanceId: 'inst' }, run, bars, [], {});

    expect(model.priceLines).toEqual([
      {
        id: 'inst:hline:0',
        paneId: '',
        price: 70,
        color: '#FF5252',
        width: 2,
        lineStyle: 'dashed',
        title: 'Upper',
      },
      {
        id: 'inst:hline:1',
        paneId: '',
        price: 30,
        color: '#4CAF50',
        width: 1,
        lineStyle: 'solid',
        title: 'Lower',
      },
    ]);

    const plotSeries = model.series.find((series) => series.title === 'RSI')!;
    expect(model.series.filter((series) => series.visible === false)).toHaveLength(2);

    expect(model.fills).toHaveLength(2);
    expect(model.fills[0]).toMatchObject({
      id: 'inst:fill:plot:0>hline:0',
      fromSeriesId: plotSeries.id,
      color: '#2962FF33',
    });
    expect(model.fills[1]!.colors).toEqual(['#FF5252', null, '#4CAF50']);

    expect(model.barColors).toEqual(run.barColors);
    const candle = model.series.find((series) => series.kind === 'candle');
    expect(candle?.kind === 'candle' ? candle.barColors : undefined).toEqual([
      { color: '#4CAF50' },
      null,
      { color: '#FF5252', wickColor: '#2962FF' },
    ]);
  });

  it('anchors hline fills on hidden constant series that stay out of the scale', () => {
    const run = runResult();
    const model = modelOf({ program: programOf(run), instanceId: 'inst' }, run, bars, [], {});
    const anchors = model.series.filter((series) => series.visible === false);

    const upper = anchors.find((series) => series.title === 'hline 0')!;
    const lower = anchors.find((series) => series.title === 'hline 1')!;
    expect(upper.display).toEqual({
      pane: false,
      priceScale: false,
      legend: false,
      dataWindow: false,
    });
    expect(upper.kind === 'line' && upper.points.slice(0, 3).map((point) => point.value)).toEqual([70, 70, 70]);
    expect(lower.kind === 'line' && lower.points.slice(0, 3).map((point) => point.value)).toEqual([30, 30, 30]);
    // Anchors extend past the last bar so the band reaches the right whitespace.
    expect(upper.kind === 'line' && upper.points.length).toBeGreaterThan(bars.length);
    expect(upper.kind === 'line' && upper.points[upper.points.length - 1]!.time).toBeGreaterThan(bars[bars.length - 1]!.time);

    expect(model.fills[0]!.toSeriesId).toBe(upper.id);
    expect(model.fills[1]!.fromSeriesId).toBe(upper.id);
    expect(model.fills[1]!.toSeriesId).toBe(lower.id);
  });
});
