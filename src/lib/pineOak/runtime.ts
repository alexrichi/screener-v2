import {
  transpileToPineJS,
  type IndicatorFactory,
  type TranspileToPineJSResult,
} from '@opus-aether-ai/pine-transpiler';
import { taCore } from 'oakscriptjs';
import { timeframeMs } from '../timeframe';

/** A closed or forming bar, in the app's millisecond time unit. */
export interface PineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PinePlot {
  id: string;
  title: string;
  type: string;
  values: number[];
}

export interface PineVisualEvent {
  call: string;
  args: unknown[];
  barIndex: number;
  pineHandleId?: number;
}

export interface PineInput {
  id: string;
  name: string;
  type: string;
  defval: number | boolean | string;
}

export interface PineRunResult {
  ok: boolean;
  error?: string;
  name: string;
  overlay: boolean;
  plots: PinePlot[];
  visuals: PineVisualEvent[];
  inputs: PineInput[];
  /** Std names the shim had to stub; empty means full coverage for this script. */
  missingStd: string[];
}

type Factory = IndicatorFactory;
type CustomIndicator = ReturnType<Factory>;
type Instance = InstanceType<CustomIndicator['constructor']>;
type Context = Parameters<Instance['main']>[0];
type InputCallback = Parameters<Instance['main']>[1];
type StdLibrary = Parameters<Factory>[0]['Std'];

class Series {
  readonly values: number[] = [];

  push(value: unknown): void {
    this.values.push(typeof value === 'number' ? value : Number(value));
  }

  get(offset: number): number {
    const index = this.values.length - 1 - offset;
    return index >= 0 && index < this.values.length ? this.values[index]! : Number.NaN;
  }
}

function last(values: readonly number[]): number {
  return values.length > 0 ? values[values.length - 1]! : Number.NaN;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function seriesOf(value: unknown): Series {
  if (value instanceof Series) return value;
  const series = new Series();
  if (value !== undefined) series.push(value);
  return series;
}

function trueRange(bars: readonly PineBar[], index: number): number {
  const bar = bars[index];
  if (!bar) return Number.NaN;
  if (index === 0) return bar.high - bar.low;
  const previous = bars[index - 1]!;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previous.close),
    Math.abs(bar.low - previous.close),
  );
}

function timeframeMinutes(timeframe: string | undefined): number {
  if (!timeframe) return 0;
  try {
    return Math.round(timeframeMs(timeframe) / 60_000);
  } catch {
    return 0;
  }
}

interface MutableContext {
  barIndex: number;
  totalBars: number;
  isRealtime: boolean;
  vars: Series[];
  varIndex: number;
  symbol: {
    tickerid: string;
    timezone: string;
    session: string;
    pricescale: number;
    minmov: number;
    timeframe: string;
  };
  new_var: (value: unknown) => unknown;
  reset: () => void;
  [key: string]: unknown;
}

export interface RunPineOptions {
  source: string;
  bars: readonly PineBar[];
  /** Canonical app timeframe, e.g. `60`, `D`. */
  timeframe?: string;
  symbol?: string;
  /** Input overrides by input id. */
  inputs?: Record<string, number | boolean | string>;
  id?: string;
  name?: string;
}

/**
 * Run a Pine script through the MIT transpiler with an OakScriptJS-backed
 * standard library. This is the `dev-oak` seam: no Vela or PineTS involved.
 */
export function runPineScript(options: RunPineOptions): PineRunResult {
  const { source, bars } = options;
  const name = options.name ?? 'Pine';
  const indicatorId = options.id ?? 'oak-pine';
  const transpiled: TranspileToPineJSResult = transpileToPineJS(source, indicatorId, name);
  if (!transpiled.success || !transpiled.indicatorFactory) {
    return {
      ok: false,
      error: transpiled.error ?? 'The script could not be transpiled',
      name,
      overlay: false,
      plots: [],
      visuals: [],
      inputs: [],
      missingStd: [],
    };
  }

  const timeframe = options.timeframe ?? '';
  const minutes = timeframeMinutes(timeframe);
  const tfMs = minutes * 60_000;
  const missing = new Set<string>();
  const context: MutableContext = {
    barIndex: 0,
    totalBars: bars.length,
    isRealtime: false,
    vars: [],
    varIndex: 0,
    symbol: {
      tickerid: options.symbol ?? 'OAK:PINE',
      timezone: 'UTC',
      session: '24x7',
      pricescale: 100,
      minmov: 1,
      timeframe,
    },
    new_var(value) {
      const index = this.varIndex;
      let series = this.vars[index];
      if (!series) {
        series = new Series();
        this.vars.push(series);
      }
      series.push(value);
      this.varIndex += 1;
      return series;
    },
    reset() {
      this.varIndex = 0;
    },
  };

  const current = (): PineBar => bars[Math.min(context.barIndex, bars.length - 1)]!;
  const closes = (): number[] => bars.slice(0, context.barIndex + 1).map((bar) => bar.close);
  const highs = (): number[] => bars.slice(0, context.barIndex + 1).map((bar) => bar.high);
  const lows = (): number[] => bars.slice(0, context.barIndex + 1).map((bar) => bar.low);

  const std: Record<string, unknown> = {
    close: () => current().close,
    open: () => current().open,
    high: () => current().high,
    low: () => current().low,
    volume: () => current().volume,
    hl2: () => (current().high + current().low) / 2,
    hlc3: () => (current().high + current().low + current().close) / 3,
    ohlc4: () => (current().open + current().high + current().low + current().close) / 4,
    hlcc4: () => (current().high + current().low + current().close + current().close) / 4,
    time: () => current().time,
    time_close: () => current().time + tfMs,
    period: () => timeframe,
    interval: () => minutes,
    isdwm: () => ['D', 'W', 'M'].includes(timeframe),
    isintraday: () => !['D', 'W', 'M'].includes(timeframe),
    isdaily: () => timeframe === 'D',
    isweekly: () => timeframe === 'W',
    ismonthly: () => timeframe === 'M',
    sma: (value: unknown, length: number) =>
      last(taCore.sma(seriesOf(value).values, Math.trunc(length))),
    ema: (value: unknown, length: number) =>
      last(taCore.ema(seriesOf(value).values, Math.trunc(length))),
    rsi: (value: unknown, length: number) =>
      last(taCore.rsi(seriesOf(value).values, Math.trunc(length))),
    change: (value: unknown, lengthOrContext: unknown = 1) =>
      last(
        taCore.change(
          seriesOf(value).values,
          typeof lengthOrContext === 'number' ? Math.trunc(lengthOrContext) : 1,
        ),
      ),
    atr: (length: number) => last(taCore.atr(Math.trunc(length), highs(), lows(), closes())),
    tr: () => trueRange(bars, context.barIndex),
    cross: (a: unknown, b: unknown, ctx: unknown) => {
      const mutable = ctx as MutableContext;
      const aSeries = seriesOf(mutable.new_var(numberValue(a)));
      const bSeries = seriesOf(mutable.new_var(numberValue(b)));
      const previousA = aSeries.get(1);
      const previousB = bSeries.get(1);
      if (!Number.isFinite(previousA) || !Number.isFinite(previousB)) return false;
      const currentA = numberValue(a);
      const currentB = numberValue(b);
      return (
        (currentA > currentB && previousA <= previousB) ||
        (currentA < currentB && previousA >= previousB)
      );
    },
    crossover: (a: unknown, b: unknown, ctx: unknown) => {
      const mutable = ctx as MutableContext;
      const aSeries = seriesOf(mutable.new_var(numberValue(a)));
      const bSeries = seriesOf(mutable.new_var(numberValue(b)));
      const previousA = aSeries.get(1);
      const previousB = bSeries.get(1);
      return (
        Number.isFinite(previousA) &&
        Number.isFinite(previousB) &&
        numberValue(a) > numberValue(b) &&
        previousA <= previousB
      );
    },
    crossunder: (a: unknown, b: unknown, ctx: unknown) => {
      const mutable = ctx as MutableContext;
      const aSeries = seriesOf(mutable.new_var(numberValue(a)));
      const bSeries = seriesOf(mutable.new_var(numberValue(b)));
      const previousA = aSeries.get(1);
      const previousB = bSeries.get(1);
      return (
        Number.isFinite(previousA) &&
        Number.isFinite(previousB) &&
        numberValue(a) < numberValue(b) &&
        previousA >= previousB
      );
    },
    gt: (a: unknown, b: unknown) => numberValue(a) > numberValue(b),
    lt: (a: unknown, b: unknown) => numberValue(a) < numberValue(b),
    na: (value: unknown) => !Number.isFinite(numberValue(value)),
    nz: (value: unknown, replacement = 0) =>
      Number.isFinite(numberValue(value)) ? numberValue(value) : numberValue(replacement),
    year: (time: number) => new Date(time).getUTCFullYear(),
    month: (time: number) => new Date(time).getUTCMonth() + 1,
    dayofmonth: (time: number) => new Date(time).getUTCDate(),
    dayofweek: (time: number) => new Date(time).getUTCDay() + 1,
    hour: (time: number) => new Date(time).getUTCHours(),
    minute: (time: number) => new Date(time).getUTCMinutes(),
    second: (time: number) => new Date(time).getUTCSeconds(),
    bar_index: () => context.barIndex,
    plot: () => undefined,
    plotshape: () => undefined,
    plotchar: () => undefined,
    plotarrow: () => undefined,
    hline: () => undefined,
    bgcolor: () => undefined,
    fill: () => undefined,
    barcolor: () => undefined,
  };

  const stdProxy = new Proxy(std, {
    get(target, property) {
      const entry = target[String(property)];
      if (entry !== undefined) return entry;
      return () => {
        missing.add(String(property));
        return Number.NaN;
      };
    },
  });

  try {
    const indicator = transpiled.indicatorFactory({
      Std: stdProxy,
    } as unknown as Parameters<Factory>[0]);
    const instance = new indicator.constructor();
    const metainfo = indicator.metainfo;
    const inputMetadata = (metainfo.inputs ?? []) as PineInput[];
    const defaults = (metainfo.defaults?.inputs ?? {}) as Record<string, unknown>;
    const inputValues = inputMetadata.map((input) => {
      const override = options.inputs?.[input.id];
      if (override !== undefined) return override;
      const declared = defaults[input.id];
      return declared !== undefined ? declared : input.defval;
    });
    const inputCallback = ((index: number) =>
      inputValues[index] ?? 0) as unknown as InputCallback;

    const plots: PinePlot[] = (metainfo.plots ?? []).map((plot) => ({
      id: String(plot.id),
      title: String(plot.id),
      type: String(plot.type ?? 'line'),
      values: [],
    }));
    const visuals: PineVisualEvent[] = [];

    for (let bar = 0; bar < bars.length; bar += 1) {
      context.barIndex = bar;
      context.reset();
      const output = instance.main(context as unknown as Context, inputCallback);
      if (!Array.isArray(output)) {
        return {
          ok: false,
          error: 'The transpiled script returned no plot array',
          name,
          overlay: metainfo.is_price_study === true,
          plots: [],
          visuals,
          inputs: inputMetadata,
          missingStd: [...missing].sort(),
        };
      }
      const values = output as unknown[];
      for (let index = 0; index < plots.length; index += 1) {
        plots[index]!.values.push(numberValue(values[index]));
      }
      const events = (output as { __visualEvents?: PineVisualEvent[] }).__visualEvents;
      if (events) visuals.push(...events);
    }

    return {
      ok: true,
      name,
      overlay: metainfo.is_price_study === true,
      plots,
      visuals,
      inputs: inputMetadata,
      missingStd: [...missing].sort(),
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      name,
      overlay: false,
      plots: [],
      visuals: [],
      inputs: [],
      missingStd: [...missing].sort(),
    };
  }
}
