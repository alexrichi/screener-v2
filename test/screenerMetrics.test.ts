import { describe, expect, it } from 'vitest';
import {
  barsPerDay,
  computeMetrics,
  seriesTailStale,
  sessionRangePct,
  splitBars,
  volumeChange24h,
  vwapZ,
  wilderRsi,
  type MetricBar,
} from '../src/lib/screenerMetrics';

const MINUTE = 60_000;
const START = Date.UTC(2026, 0, 2, 0, 0);

function bar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1,
  quoteVolume?: number,
): MetricBar {
  return { time, open, high, low, close, volume, ...(quoteVolume !== undefined ? { quoteVolume } : {}) };
}

describe('screener metrics', () => {
  it('counts bars per day for the supported technical timeframes', () => {
    expect(barsPerDay('15')).toBe(96);
    expect(barsPerDay('30')).toBe(48);
    expect(barsPerDay('60')).toBe(24);
    expect(() => barsPerDay('7')).toThrow();
  });

  it('flags a series whose tail is two bars behind', () => {
    const bars = [bar(START, 100, 101, 99, 100), bar(START + 15 * MINUTE, 100, 101, 99, 100)];
    expect(seriesTailStale(bars, '15', START + 60 * MINUTE)).toBe(true);
    expect(seriesTailStale(bars, '15', START + 30 * MINUTE)).toBe(false);
    expect(seriesTailStale([], '15', START)).toBe(true);
  });

  it('splits the newest bar into forming until its close time passes', () => {
    const bars = [
      bar(START, 100, 101, 99, 100),
      bar(START + 15 * MINUTE, 100, 101, 99, 100),
      bar(START + 30 * MINUTE, 100, 101, 99, 100),
    ];
    expect(splitBars(bars, START + 40 * MINUTE, '15')).toEqual({
      closed: bars.slice(0, 2),
      forming: bars[2],
    });
    expect(splitBars(bars, START + 45 * MINUTE, '15')).toEqual({
      closed: bars,
      forming: null,
    });
    expect(splitBars([], START, '15')).toEqual({ closed: [], forming: null });
  });

  it('measures the price position inside the UTC session range', () => {
    const bars = [
      bar(START, 100, 110, 90, 105),
      bar(START + 15 * MINUTE, 105, 115, 100, 110),
    ];
    const forming = bar(START + 30 * MINUTE, 110, 112, 108, 111);
    expect(sessionRangePct(bars, forming, 112, START + 35 * MINUTE)).toBeCloseTo(
      ((112 - 100) / (115 - 90)) * 100,
      10,
    );
    expect(sessionRangePct([], null, 100, START)).toBeNull();
    expect(
      sessionRangePct([bar(START, 100, 100, 100, 100)], null, 100, START),
    ).toBeNull();
  });

  it('returns a zero VWAP z-score for a flat session and a real z for a spread', () => {
    expect(
      vwapZ([bar(START, 10, 10, 10, 10)], null, 10, START + MINUTE),
    ).toBe(0);

    const bars = [bar(START, 10, 10, 10, 10), bar(START + 15 * MINUTE, 20, 20, 20, 20)];
    expect(vwapZ(bars, null, 20, START + 30 * MINUTE)).toBeCloseTo(1, 10);
    expect(vwapZ([], null, 10, START)).toBeNull();
  });

  it('computes Wilder RSI and handles one-sided and flat series', () => {
    const up = Array.from({ length: 15 }, (_, index) => index + 1);
    const down = Array.from({ length: 15 }, (_, index) => 15 - index);
    expect(wilderRsi(up, 14)).toBe(100);
    expect(wilderRsi(down, 14)).toBe(0);
    expect(wilderRsi(new Array(15).fill(10), 14)).toBe(50);
    expect(wilderRsi([1, 2, 3], 14)).toBeNull();
  });

  it('computes 24h volume change and RVOL against previous windows', () => {
    const day = barsPerDay('15');
    const closed: MetricBar[] = [];
    for (let window = 0; window < 3; window += 1) {
      const qv = window === 0 ? 1 : window === 1 ? 2 : 4;
      for (let index = 0; index < day; index += 1) {
        closed.push(
          bar(START + (window * day + index) * 15 * MINUTE, 10, 10, 10, 10, 1, qv),
        );
      }
    }
    const forming = bar(
      START + day * 3 * 15 * MINUTE,
      10,
      10,
      10,
      10,
      1,
      4,
    );
    const result = volumeChange24h(closed, forming, day, 2);
    expect(result.change).toBeCloseTo((388 / 192 - 1) * 100, 10);
    expect(result.rvol).toBeCloseTo(388 / 144, 10);

    const short = volumeChange24h(closed.slice(0, day), null, day, 2);
    expect(short).toEqual({ change: null, rvol: null });
  });

  it('maps the five metrics from one series', () => {
    const day = barsPerDay('15');
    const bars: MetricBar[] = [];
    for (let index = 0; index < day; index += 1) {
      bars.push(
        bar(
          START + index * 15 * MINUTE,
          100 + index * 0.1,
          101 + index * 0.1,
          99 + index * 0.1,
          100 + index * 0.1,
          10,
          1_000,
        ),
      );
    }
    const now = START + (day - 1) * 15 * MINUTE + 5 * MINUTE;
    const metrics = computeMetrics(bars, 110, now, {
      timeframe: '15',
      rsiPeriod: 14,
      rvolDays: 7,
    });
    expect(metrics.sessionRangePct).not.toBeNull();
    expect(metrics.vwapZ).not.toBeNull();
    expect(metrics.rsi).toBe(100);
    expect(metrics.volumeChange24hPct).toBeNull();
    expect(metrics.rvol).toBeNull();
  });
});
