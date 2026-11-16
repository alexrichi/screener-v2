import type {
  EngineContextSnapshot,
  ExecutionHandlers,
  ExecutionRequest,
  ExecutionSession,
  Fill,
  InputSchema,
  InputValue,
  IndicatorModel,
  LineLikeKind,
  LineLikeSeries,
  PreparedScript,
  ScriptingEngine,
  SeriesSpec,
} from '@luxalgo/vela/plugin';
import { ACCENT, CATEGORICAL, stableSeriesId } from '@luxalgo/vela/plugin';
import {
  type PineBar,
  type PineFillAnchor,
  type PineInput,
  type PineRunResult,
} from '@screener/pine-engine';
import { pineDrawings } from './drawings';
import { compilePineSession, PineSession } from './session';
import type { PineToken } from './protocol';
import {
  defaultWorkerFactory,
  LocalPineRunner,
  PineWorkerClient,
  WorkerPineRunner,
  type FetchSeries,
  type PineRunner,
  type WorkerFactory,
} from './workerClient';
import { strategyStateOf, strategyTradesOf, tradeExecutionsOf } from './strategy';

/**
 * A live tick re-runs a non-streaming engine over the whole series. While the
 * user drags or zooms, those runs fight the gesture for the main thread. Drop
 * the live tick instead of queueing a catch-up run: executing that run right
 * after pointer-up is a visible hitch, while the next tick refreshes the
 * forming bar once the gesture is over.
 */
let pointerHeld = 0;
let pointerDownAt = 0;
let wheelQuietUntil = 0;

function busyGesture(): boolean {
  const held = pointerHeld > 0 && performance.now() - pointerDownAt < 30_000;
  return held || (typeof performance !== 'undefined' && performance.now() < wheelQuietUntil);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => {
    pointerHeld += 1;
    pointerDownAt = performance.now();
  }, true);
  const releasePointer = () => {
    pointerHeld = Math.max(0, pointerHeld - 1);
  };
  window.addEventListener('pointerup', releasePointer, true);
  window.addEventListener('pointercancel', releasePointer, true);
  window.addEventListener('wheel', () => {
    if (typeof performance !== 'undefined') wheelQuietUntil = performance.now() + 250;
  }, { capture: true, passive: true });
  // A drag released outside the window never sends pointerup.
  window.addEventListener('blur', () => {
    pointerHeld = 0;
  });
}

const INPUT_TYPES: Record<string, InputSchema['type']> = {
  integer: 'int',
  int: 'int',
  float: 'float',
  bool: 'bool',
  boolean: 'bool',
  string: 'string',
  source: 'source',
  color: 'color',
  session: 'session',
  timeframe: 'timeframe',
  symbol: 'symbol',
  time: 'int',
  enum: 'string',
};

const SERIES_KINDS: Record<string, LineLikeKind> = {
  line: 'line',
  area: 'area',
  stepline: 'step',
  step: 'step',
  histogram: 'histogram',
  columns: 'columns',
  column: 'columns',
  circles: 'circles',
  cross: 'cross',
};

/** `#RRGGBB` plus Pine's transparency as an alpha suffix. */
function withTransparency(color: string, transparency = 0): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color) || transparency <= 0) return color;
  const alpha = Math.round((1 - Math.min(transparency, 100) / 100) * 255);
  return `${color}${alpha.toString(16).padStart(2, '0').toUpperCase()}`;
}

function inputsSchema(inputs: readonly PineInput[]): InputSchema[] {
  return inputs.map((input) => ({
    key: input.id,
    title: input.name,
    type: INPUT_TYPES[input.type] ?? 'float',
    defval: input.defval,
    ...(input.options ? { options: input.options } : {}),
    ...(input.group ? { group: input.group } : {}),
    ...(input.inline ? { inline: input.inline } : {}),
    ...(input.tooltip ? { tooltip: input.tooltip } : {}),
    ...(input.min !== undefined ? { min: input.min } : {}),
    ...(input.max !== undefined ? { max: input.max } : {}),
    ...(input.type === 'integer' ? { step: input.step ?? 1 } : input.step !== undefined ? { step: input.step } : {}),
  }));
}

export function modelOf(
  token: PineToken,
  run: PineRunResult,
  bars: readonly { time: number }[],
  inputs: InputSchema[],
  values: Record<string, InputValue>,
): IndicatorModel {
  const { instanceId } = token;
  const series: SeriesSpec[] = [];
  const ordinalByKey = new Map<string, number>();
  const plotSeriesId = new Map<string, string>();
  const drawings = pineDrawings(instanceId, run);

  for (const plot of run.plots) {
    const kind = SERIES_KINDS[plot.type] ?? 'line';
    const ordinal = ordinalByKey.get(`${kind}:${plot.title}`) ?? 0;
    ordinalByKey.set(`${kind}:${plot.title}`, ordinal + 1);
    const id = stableSeriesId({ instanceId, kind, title: plot.title, ordinal });
    plotSeriesId.set(plot.id, id);
    series.push({
      id,
      title: plot.title,
      paneId: '',
      kind,
      points: plot.values.map((value, index) => ({
        time: bars[index]?.time ?? 0,
        value: Number.isFinite(value) ? value : null,
      })),
      style: {
        color: withTransparency(
          plot.color ?? CATEGORICAL[series.length % CATEGORICAL.length] ?? ACCENT,
          plot.transparency,
        ),
        width: plot.width ?? 2,
        lineStyle: plot.lineStyle ?? 'solid',
      },
    });
  }

  for (const candle of run.candles) {
    const key = `${candle.kind}:${candle.title}`;
    const ordinal = ordinalByKey.get(key) ?? 0;
    ordinalByKey.set(key, ordinal + 1);
    series.push({
      id: stableSeriesId({ instanceId, kind: candle.kind, title: candle.title, ordinal }),
      title: candle.title,
      paneId: '',
      kind: candle.kind,
      bars: candle.bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
      style: candle.kind === 'candle'
        ? {
            up: candle.color,
            down: candle.color,
            wickUp: candle.wickColor,
            wickDown: candle.wickColor,
            borderUp: candle.borderColor,
            borderDown: candle.borderColor,
          }
        : undefined,
      barColors: candle.barColors?.map((color) => color
        ? { color: color.color, wickColor: color.wickColor, borderColor: color.borderColor }
        : null),
    });
  }

  const priceLines = run.priceLines.map((line) => ({
    id: `${instanceId}:hline:${line.id}`,
    paneId: '',
    price: line.price,
    color: line.color,
    width: line.width,
    lineStyle: line.style,
    title: line.title,
  }));

  const hlineByIndex = new Map(run.priceLines.map((line) => [line.id, line]));
  const hlineAnchors = new Map<number, string>();
  // Vela keeps a hidden constant series for fills, but a fill stops at the last
  // anchor point. Pad the anchor into the chart's right whitespace so an hline
  // band reaches the chart edge instead of ending on the last bar.
  // ponytail: fixed 1000-bar right padding; raise it if the view can scroll further.
  const FILL_EXTEND_BARS = 1000;
  const lastBar = bars[bars.length - 1];
  const barStep = bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 0;
  const anchorId = (anchor: PineFillAnchor): string | null => {
    if (anchor.kind === 'plot') return plotSeriesId.get(`plot_${anchor.index}`) ?? null;
    const line = hlineByIndex.get(anchor.index);
    if (!line) return null;
    const existing = hlineAnchors.get(anchor.index);
    if (existing) return existing;
    const id = stableSeriesId({ instanceId, kind: 'line', title: `hline_${anchor.index}`, ordinal: 0 });
    const points = bars.map((bar) => ({ time: bar.time, value: line.price }));
    if (lastBar && barStep > 0) {
      for (let index = 1; index <= FILL_EXTEND_BARS; index += 1) {
        points.push({ time: lastBar.time + barStep * index, value: line.price });
      }
    }
    series.push({
      id,
      title: `hline ${anchor.index}`,
      paneId: '',
      kind: 'line',
      points,
      style: { color: 'transparent', width: 1, lineStyle: 'solid' },
      visible: false,
      display: { pane: false, priceScale: false, legend: false, dataWindow: false },
    });
    hlineAnchors.set(anchor.index, id);
    return id;
  };

  const fills: Fill[] = [];
  for (const fill of run.fills) {
    const fromSeriesId = anchorId(fill.from);
    const toSeriesId = anchorId(fill.to);
    if (!fromSeriesId || !toSeriesId) continue;
    fills.push({
      id: `${instanceId}:fill:${fill.id}`,
      paneId: '',
      fromSeriesId,
      toSeriesId,
      color: fill.color,
      colors: fill.colors,
    });
  }

  return {
    id: instanceId,
    title: run.name,
    shorttitle:
      token.shortName && token.shortName !== run.name ? token.shortName : undefined,
    overlay: token.overlay,
    paneHint: token.overlay ? 'price' : 'new',
    series,
    fills,
    backgrounds: drawings.backgrounds,
    priceLines,
    barColors: run.barColors.length > 0 ? run.barColors : undefined,
    lines: drawings.lines,
    boxes: drawings.boxes,
    labels: drawings.labels,
    tables: drawings.tables,
    polylines: drawings.polylines,
    linefills: drawings.linefills,
    inputs,
    inputValues: values,
    ...(run.strategy ? { trades: tradeExecutionsOf(run.strategy) } : {}),
  };
}

export interface PineEngineOptions {
  /** Called once per distinct warning for this workspace; hosts surface it in the UI. */
  onWarning?: (message: string) => void;
  /** Inject a worker factory in tests or hosts without a global Worker. */
  workerFactory?: WorkerFactory;
}

/**
 * Pine Script engine for Vela, backed by the MIT `pine-engine` package.
 *
 * Plots, drawings (`line`/`box`/`label`) and `bgcolor` come from the engine.
 * `request.security` is limited to the chart's own symbol and timeframe.
 * No streaming context: Vela re-runs this engine on every bar notification.
 */

export class PineEngine implements ScriptingEngine {
  readonly language = 'pine';
  readonly capabilities = { streaming: false, visibleRange: true, inputs: true };
  private readonly reported = new Set<string>();
  private readonly localPrograms = new Map<string, ReturnType<typeof compilePineSession>>();
  private worker: PineWorkerClient | null = null;
  private workerEnabled: boolean;
  private sessionSeq = 0;

  constructor(private readonly options: PineEngineOptions = {}) {
    this.workerEnabled =
      typeof Worker !== 'undefined' || options.workerFactory !== undefined;
  }

  private client(): PineWorkerClient {
    this.worker ??= new PineWorkerClient(
      this.options.workerFactory ?? defaultWorkerFactory,
    );
    return this.worker;
  }

  /** Release the worker. Vela has no engine dispose hook yet; idle cleanup covers the app. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private report(message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    this.options.onWarning?.(message);
  }

  private prepared(
    source: string,
    instanceId: string,
    inputs: readonly PineInput[],
    meta: { name: string; shortName?: string; overlay: boolean },
    reactsToViewport: boolean,
  ): PreparedScript {
    return {
      language: this.language,
      inputs: inputsSchema(inputs),
      meta: {
        title: meta.name,
        shorttitle: meta.shortName,
        overlay: meta.overlay,
      },
      reactsToViewport,
      token: {
        source,
        instanceId,
        overlay: meta.overlay,
        ...(meta.shortName ? { shortName: meta.shortName } : {}),
      } satisfies PineToken,
    };
  }

  async prepare(source: string, instanceId: string): Promise<PreparedScript> {
    // Compile once on the main thread for the input/meta schema. The worker
    // compiles its own copy on the first run, so preparing a cell that never
    // executes a script does not spawn a worker.
    const compiled = compilePineSession(source, instanceId);
    this.localPrograms.set(instanceId, compiled);
    return this.prepared(
      source,
      instanceId,
      compiled.inputs,
      compiled.meta,
      compiled.reactsToViewport,
    );
  }

  execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
    const token = req.prepared.token as PineToken;
    const inputs = req.prepared.inputs;
    const values: Record<string, InputValue> = {
      ...Object.fromEntries(inputs.map((input) => [input.key, input.defval])),
      ...req.inputs,
    };
    let stopped = false;
    let snapshot: EngineContextSnapshot | null = null;
    let generation = 0;
    let running = false;
    let pending = false;
    // A heavy script re-run blocks the UI for its whole duration. Coalesce live
    // ticks to at most one run per cooldown instead of one per bar notification;
    // input edits, history completion, and the first paint stay immediate.
    let lastRunEnd = 0;
    let lastRunMs = 0;
    let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
    let visibleRange = req.visibleRange;
    // The engine only alerts on the current bar, but it re-runs that bar on
    // every tick; keep each alert once per bar so the bell does not flood.
    const alerted = new Set<string>();
    const warnedForeign = new Set<string>();
    let latestBars: PineBar[] = [];
    const market = req.market;
    const fetchSeries: FetchSeries | undefined = req.fetchSeries
      ? (symbol, timeframe, range) => req.fetchSeries!(symbol, timeframe, range)
      : undefined;
    const onForeignError = (need: { key: string; symbol: string; timeframe: string }): void => {
      if (warnedForeign.has(need.key)) return;
      warnedForeign.add(need.key);
      handlers.onWarning?.({
        message: `request.security(${need.symbol}, ${need.timeframe}): no bars for this instrument`,
        bar: Math.max(latestBars.length - 1, 0),
      });
    };
    const sessionId = ++this.sessionSeq;
    let runner: PineRunner;
    if (this.workerEnabled) {
      runner = new WorkerPineRunner(
        this.client(),
        sessionId,
        token,
        market,
        fetchSeries,
        onForeignError,
      );
    } else {
      const compiled =
        this.localPrograms.get(token.instanceId) ??
        compilePineSession(token.source, token.instanceId);
      this.localPrograms.set(token.instanceId, compiled);
      runner = new LocalPineRunner(
        compiled.program,
        token.instanceId,
        market,
        fetchSeries,
        onForeignError,
      );
    }

    const reportResult = (
      result: PineRunResult,
      bars: readonly PineBar[],
      provisional = false,
    ): void => {
      if (!result.ok) {
        handlers.onError?.(new Error(result.error ?? 'The script failed'));
        return;
      }
      if (!provisional) {
        if (result.missingStd.length > 0) {
          const message = `Unsupported Pine functions: ${result.missingStd.join(', ')}`;
          this.report(message);
          handlers.onWarning?.({ message, bar: bars.length - 1 });
        }
        for (const warning of result.warnings) {
          this.report(warning);
          handlers.onWarning?.({ message: warning, bar: bars.length - 1 });
        }
        for (const alert of result.alerts) {
          // `freq_all` asks for every tick; the default and alertcondition fire
          // once per bar per call site, so a live re-run does not repeat them.
          const id =
            alert.site !== undefined && alert.freq !== 'freq_all'
              ? `${alert.time}:${alert.site}`
              : `${alert.time}:${alert.title ?? ''}:${alert.message}`;
          if (alerted.has(id)) continue;
          alerted.add(id);
          handlers.onAlert?.({
            id,
            message: alert.message,
            ...(alert.title !== undefined ? { title: alert.title } : {}),
            time: alert.time,
            barIndex: alert.barIndex,
            ...(alert.freq !== undefined ? { freq: alert.freq } : {}),
          });
        }
      }
      const model = modelOf(token, result, bars, inputs, values);
      snapshot = {
        language: this.language,
        phase: 'idle',
        barIndex: bars.length - 1,
        meta: { title: model.title, overlay: model.overlay, shorttitle: model.shorttitle },
        plots: Object.fromEntries(
          result.plots.map((plot) => [
            plot.title,
            plot.values.map((value, index) => ({
              time: bars[index]?.time ?? 0,
              value: Number.isFinite(value) ? value : null,
            })),
          ]),
        ),
        variables: { ...values },
        ...(result.strategy
          ? {
              strategy: strategyStateOf(result.strategy),
              trades: strategyTradesOf(result.strategy),
            }
          : {}),
        warnings: [],
      };
      handlers.onModel(model);
      if (!provisional) handlers.onDone?.();
    };

    const run = async (force = false): Promise<void> => {
      if (stopped) return;
      if (!force) {
        if (busyGesture()) {
          if (cooldownTimer === null) {
            cooldownTimer = setTimeout(() => {
              cooldownTimer = null;
              void run();
            }, 250);
          }
          return;
        }
        const now = performance.now();
        // Scale the pause with the last script cost: a 200 ms run waits ~0.8 s,
        // a small one stays live. The cap keeps the forming-bar outputs from
        // ever sitting still for more than two seconds.
        const cooldown = Math.max(250, Math.min(2000, lastRunMs * 4));
        const wait = lastRunEnd + cooldown - now;
        if (wait > 0) {
          if (cooldownTimer === null) {
            cooldownTimer = setTimeout(() => {
              cooldownTimer = null;
              void run();
            }, wait);
          }
          return;
        }
      }
      if (cooldownTimer !== null) {
        clearTimeout(cooldownTimer);
        cooldownTimer = null;
      }
      if (running) {
        pending = true;
        return;
      }
      running = true;
      const runGeneration = generation;
      try {
        const chartBars = req.getBars?.() ?? req.bars;
        if (chartBars.length === 0) return;
        const pineBars = chartBars.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume ?? 0,
        }));
        latestBars = pineBars;
        const outcome = await runner.run(
          {
            bars: pineBars,
            inputs: values,
            visibleRange,
            mode: req.mode,
          },
          (provisional) => {
            if (stopped || runGeneration !== generation) return;
            reportResult(provisional, pineBars, true);
          },
        );
        if (stopped || runGeneration !== generation) return;
        const reportStarted = performance.now();
        reportResult(outcome.result, pineBars);
        lastRunMs = outcome.durationMs + (performance.now() - reportStarted);
      } catch (error) {
        if (!stopped && runGeneration === generation) {
          handlers.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        running = false;
        lastRunEnd = performance.now();
        if (pending && !stopped) {
          pending = false;
          void run();
        }
      }
    };

    // Watch mode starts during the history backfill: running on a partial prefix
    // would compute every series twice at full cost. Wait for the complete signal.
    if (req.historyState !== 'backfill') void run(true);

    return {
      getContext: (select) => {
        if (!snapshot) return Promise.resolve(null);
        if (!select) return Promise.resolve(snapshot);
        const picked = Object.fromEntries(select.map((key) => [key, snapshot![key]]));
        return Promise.resolve({ ...snapshot, ...picked });
      },
      stop: () => {
        stopped = true;
        generation += 1;
        if (cooldownTimer !== null) {
          clearTimeout(cooldownTimer);
          cooldownTimer = null;
        }
        runner.stop();
      },
      update: (next) => {
        Object.assign(values, next);
        void run(true);
      },
      setVisibleRange: (range) => {
        visibleRange = range;
        void run(true);
      },
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        if (reason === undefined && busyGesture()) return;
        // A completed backfill is a fresh chart; do not hide it behind the
        // live-tick cooldown.
        void run(reason === 'complete');
      },
    };
  }
}
