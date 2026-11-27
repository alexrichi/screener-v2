/** One candle with the neutral shape both the app and the sidecar can provide. */
export interface MetricBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Quote volume when the venue reports it; otherwise `volume * close`. */
  quoteVolume?: number;
}

export interface MetricOptions {
  /** Technical timeframe: `15`, `30` or `60`. */
  timeframe: string;
  rsiPeriod: number;
  rvolDays: number;
}

export interface ScreenerMetrics {
  sessionRangePct: number | null;
  volumeChange24hPct: number | null;
  rvol: number | null;
  vwapZ: number | null;
  rsi: number | null;
}

export interface CandleSplit {
  closed: MetricBar[];
  forming: MetricBar | null;
}

export const SCREENER_TIMEFRAMES = ['15', '30', '60'] as const;
export type ScreenerTimeframe = (typeof SCREENER_TIMEFRAMES)[number];

const DAY_MS = 86_400_000;

/** Bars in one UTC day at a technical timeframe; throws for a TF that does not divide a day. */
export function barsPerDay(timeframe: string): number {
  const minutes = Number(timeframe);
  if (!Number.isFinite(minutes) || minutes <= 0 || 1440 % minutes !== 0) {
    throw new Error(`Screener timeframe must divide a day: ${timeframe}`);
  }
  return 1440 / minutes;
}

export function timeframeMsOf(timeframe: string): number {
  const minutes = Number(timeframe);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`Unsupported screener timeframe: ${timeframe}`);
  }
  return minutes * 60_000;
}

/**
 * True when the series has no bar for the current window: the tail is at least
 * two bars behind `now`. A stopped service or a suspended machine leaves this
 * state, and a tail-only refresh would leave a hole in the series.
 */
export function seriesTailStale(
  bars: readonly { time: number }[],
  timeframe: string,
  now: number,
): boolean {
  const last = bars.at(-1);
  return !last || now - last.time > timeframeMsOf(timeframe) * 2;
}

/** A bar is forming while its open time plus the timeframe is still ahead of `now`. */
export function splitBars(
  bars: readonly MetricBar[],
  now: number,
  timeframe: string,
): CandleSplit {
  const last = bars.at(-1);
  if (!last) return { closed: [], forming: null };
  if (last.time + timeframeMsOf(timeframe) > now) {
    return { closed: bars.slice(0, -1), forming: last };
  }
  return { closed: [...bars], forming: null };
}

function quoteVolume(bar: MetricBar): number {
  return bar.quoteVolume ?? bar.volume * bar.close;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function wilderRsi(values: readonly number[], period: number): number | null {
  if (!Number.isFinite(period) || period < 1 || values.length < period + 1) return null;

  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index]! - values[index - 1]!;
    if (change > 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function utcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function withLastPrice(bar: MetricBar, last: number): MetricBar {
  return {
    ...bar,
    close: last,
    high: Math.max(bar.high, last),
    low: Math.min(bar.low, last),
  };
}

function sessionBars(
  closed: readonly MetricBar[],
  forming: MetricBar | null,
  last: number,
  now: number,
): MetricBar[] {
  const start = utcMidnight(now);
  return [...closed, ...(forming ? [withLastPrice(forming, last)] : [])].filter(
    (bar) => bar.time >= start,
  );
}

/** Position of the last price inside the current UTC session's high-low range, in %. */
export function sessionRangePct(
  closed: readonly MetricBar[],
  forming: MetricBar | null,
  last: number,
  now: number,
): number | null {
  const bars = sessionBars(closed, forming, last, now);
  if (bars.length === 0) return null;

  const open = bars[0]!.open;
  const high = Math.max(last, ...bars.map((bar) => bar.high));
  const low = Math.min(last, ...bars.map((bar) => bar.low));
  if (!Number.isFinite(high) || !Number.isFinite(low) || high === low) return null;
  return ((last - open) / (high - low)) * 100;
}

/** Session VWAP z-score: (price - vwap) / sigma; 0 when the session has no spread. */
export function vwapZ(
  closed: readonly MetricBar[],
  forming: MetricBar | null,
  last: number,
  now: number,
): number | null {
  const bars = sessionBars(closed, forming, last, now);
  if (bars.length === 0) return null;

  const totalVolume = sum(bars.map((bar) => bar.volume));
  if (!(totalVolume > 0)) return null;

  let weighted = 0;
  let weightedSquare = 0;
  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    weighted += typical * bar.volume;
    weightedSquare += typical * typical * bar.volume;
  }
  const vwap = weighted / totalVolume;
  const variance = Math.max(0, weightedSquare / totalVolume - vwap * vwap);
  const sigma = Math.sqrt(variance);
  return sigma > 0 ? (last - vwap) / sigma : 0;
}

/**
 * TradingView-style 24h volume change and RVOL.
 *
 * The current window is the last `barsPerDay` closed bars plus the forming bar;
 * the previous window is the `barsPerDay` closed bars directly before it. RVOL
 * compares the current window against the mean of `rvolDays` earlier windows.
 */
export function volumeChange24h(
  closed: readonly MetricBar[],
  forming: MetricBar | null,
  barsPerDayCount: number,
  rvolDays: number,
): { change: number | null; rvol: number | null } {
  if (!(barsPerDayCount > 0) || closed.length < barsPerDayCount * 2) {
    return { change: null, rvol: null };
  }

  const currentBars = [
    ...closed.slice(-barsPerDayCount),
    ...(forming ? [forming] : []),
  ];
  const currentVolume = sum(currentBars.map(quoteVolume));
  const previousVolume = sum(
    closed
      .slice(-barsPerDayCount * 2, -barsPerDayCount)
      .map(quoteVolume),
  );

  const change =
    previousVolume > 0 ? (currentVolume / previousVolume - 1) * 100 : null;

  let rvol: number | null = null;
  if (
    Number.isFinite(rvolDays) &&
    rvolDays >= 1 &&
    closed.length >= barsPerDayCount * (rvolDays + 1)
  ) {
    const averages: number[] = [];
    for (let day = 1; day <= rvolDays; day += 1) {
      averages.push(
        sum(
          closed
            .slice(-barsPerDayCount * (day + 1), -barsPerDayCount * day)
            .map(quoteVolume),
        ),
      );
    }
    const average = sum(averages) / averages.length;
    rvol = average > 0 ? currentVolume / average : null;
  }

  return { change, rvol };
}

/**
 * Compute the five candle metrics from one series. `bars` must be sorted oldest
 * first and include the forming bar when the source has one. The forming close
 * is replaced by the ticker's last price, and its high/low are widened to it.
 */
export function computeMetrics(
  bars: readonly MetricBar[],
  last: number,
  now: number,
  options: MetricOptions,
): ScreenerMetrics {
  const { closed, forming } = splitBars(bars, now, options.timeframe);
  const dayBars = barsPerDay(options.timeframe);

  const closes = closed.map((bar) => bar.close);
  if (forming) closes.push(last);

  const volume = volumeChange24h(closed, forming, dayBars, options.rvolDays);

  return {
    sessionRangePct: sessionRangePct(closed, forming, last, now),
    volumeChange24hPct: volume.change,
    rvol: volume.rvol,
    vwapZ: vwapZ(closed, forming, last, now),
    rsi: wilderRsi(closes, options.rsiPeriod),
  };
}
