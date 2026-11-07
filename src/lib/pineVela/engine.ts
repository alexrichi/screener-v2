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
  canonicalTimeframe,
  compilePine,
  timeframeMs,
  type PineBar,
  type PineFillAnchor,
  type PineProgram,
  type PineRunResult,
} from '@screener/pine-engine';
import { pineDrawings } from './drawings';

/**
 * A live tick re-runs a non-streaming engine over the whole series. While the
 * user drags or zooms, those runs fight the gesture for the main thread, so
 * hold them and execute one per pending session once the gesture settles.
 */
let pointerHeld = 0;
let pointerDownAt = 0;
let wheelQuietUntil = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const deferredLive = new Set<() => Promise<void>>();

function busyGesture(): boolean {
  const held = pointerHeld > 0 && performance.now() - pointerDownAt < 30_000;
  return held || (typeof performance !== 'undefined' && performance.now() < wheelQuietUntil);
}

function scheduleLiveFlush(delay: number): void {
  if (typeof window === 'undefined') return;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (busyGesture()) return;
    const runs = [...deferredLive];
    deferredLive.clear();
    for (const run of runs) void run();
  }, delay);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => {
    pointerHeld += 1;
    pointerDownAt = performance.now();
  }, true);
  const releasePointer = () => {
    pointerHeld = Math.max(0, pointerHeld - 1);
    if (pointerHeld === 0 && deferredLive.size > 0) scheduleLiveFlush(120);
  };
  window.addEventListener('pointerup', releasePointer, true);
  window.addEventListener('pointercancel', releasePointer, true);
  window.addEventListener('wheel', () => {
    if (typeof performance !== 'undefined') wheelQuietUntil = performance.now() + 250;
    if (deferredLive.size > 0) scheduleLiveFlush(300);
  }, { capture: true, passive: true });
  // A drag released outside the window never sends pointerup.
  window.addEventListener('blur', () => {
    pointerHeld = 0;
    if (deferredLive.size > 0) scheduleLiveFlush(120);
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

interface PineToken {
  program: PineProgram;
  instanceId: string;
}

/** `#RRGGBB` plus Pine's transparency as an alpha suffix. */
function withTransparency(color: string, transparency = 0): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color) || transparency <= 0) return color;
  const alpha = Math.round((1 - Math.min(transparency, 100) / 100) * 255);
  return `${color}${alpha.toString(16).padStart(2, '0').toUpperCase()}`;
}

function inputsSchema(program: PineProgram): InputSchema[] {
  return program.meta.inputs.map((input) => ({
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
  const { instanceId, program } = token;
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
    title: program.meta.name,
    shorttitle:
      program.meta.shortName && program.meta.shortName !== program.meta.name
        ? program.meta.shortName
        : undefined,
    overlay: program.meta.overlay,
    paneHint: program.meta.overlay ? 'price' : 'new',
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
  };
}

export interface PineEngineOptions {
  /** Called once per distinct warning for this workspace; hosts surface it in the UI. */
  onWarning?: (message: string) => void;
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

  constructor(private readonly options: PineEngineOptions = {}) {}

  private report(message: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    this.options.onWarning?.(message);
  }

  prepare(source: string, instanceId: string): Promise<PreparedScript> {
    const program = compilePine({ source, id: instanceId });
    if (!program.ok) {
      return Promise.reject(new Error(program.error ?? 'The script could not be compiled'));
    }
    const inputs = inputsSchema(program);
    return Promise.resolve({
      language: this.language,
      inputs,
      meta: {
        title: program.meta.name,
        shorttitle: program.meta.shortName,
        overlay: program.meta.overlay,
      },
      reactsToViewport: /chart\.(?:left|right)_visible_bar_time/.test(source),
      token: { program, instanceId } satisfies PineToken,
    });
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
    let visibleRange = req.visibleRange;
    // ponytail: a 60 s lower-timeframe cache; intrabar precision on forming bars
    // trails by at most that long. Shorter needs a per-bar subscription.
    const LOWER_TTL_MS = 60_000;
    const LOWER_FETCH_TIMEOUT_MS = 20_000;
    const lowerCache = new Map<string, { bars: PineBar[]; at: number }>();
    // The probe captures the whole script on HTF/LTF bars; it is expensive and
    // only changes when the inputs or the cached lower series change. Keep it
    // across ticks in this session and clear it on either.
    const probeCache = new Map<string, unknown[]>();
    let probeSignature = '';
    const syncProbeCache = (chartBars: readonly PineBar[]): void => {
      const lowerSignature = Object.entries(lowerCache)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => {
          const last = entry.bars.at(-1);
          return `${key}:${entry.bars.length}:${last?.time ?? 0}:${last?.close ?? 0}:${last?.high ?? 0}:${last?.low ?? 0}:${last?.volume ?? 0}`;
        })
        .join('|');
      // A new chart bar (or backfilled history) can extend the last HTF bucket;
      // intra-bar price ticks do not invalidate a default lookahead_off probe.
      const last = chartBars.at(-1);
      const chartSignature = `${chartBars.length}:${last?.time ?? 0}`;
      const signature = `${JSON.stringify(values)}|${chartSignature}|${lowerSignature}`;
      if (signature !== probeSignature) {
        probeCache.clear();
        probeSignature = signature;
      }
    };

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
        warnings: [],
      };
      handlers.onModel(model);
      if (!provisional) handlers.onDone?.();
    };

    const run = async (): Promise<void> => {
      if (stopped) return;
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

        const requested = new Map<string, { symbol: string; timeframe: string }>();
        const executeOnce = () => {
          syncProbeCache(pineBars);
          return token.program.run({
            bars: pineBars,
            timeframe: req.market.timeframe,
            symbol: req.market.symbol,
            symbolInfo: req.market.symbolInfo as Record<string, unknown> | undefined,
            live: req.mode === 'live',
            visibleRange,
            securityProbeCache: probeCache,
            inputs: values,
            lowerBars: Object.fromEntries(
              [...lowerCache].map(([key, entry]) => [key, entry.bars]),
            ),
            onLowerTimeframe: (symbol, timeframe) => {
              const tf = canonicalTimeframe(timeframe);
              requested.set(`${symbol}@${tf}`, { symbol, timeframe: tf });
            },
          });
        };

        let result = executeOnce();
        const missing = [...requested].filter(([key]) => {
          const entry = lowerCache.get(key);
          return !entry || Date.now() - entry.at >= LOWER_TTL_MS;
        });

        if (missing.length > 0 && req.fetchSeries) {
          // Paint the locally-computable part immediately; the intrabar pass
          // replaces it when the lower series arrives.
          if (missing.some(([key]) => !lowerCache.has(key))) {
            reportResult(result, pineBars, true);
          }
          const last = pineBars[pineBars.length - 1]!;
          const chartMs = timeframeMs(req.market.timeframe) || 1;
          const from = pineBars[0]?.time ?? last.time;
          const fetchSeries = req.fetchSeries;
          await Promise.all(
            missing.map(async ([key, request]) => {
              const lowerMs = timeframeMs(request.timeframe) || 1;
              const limit = Math.min(
                100_000,
                Math.max(500, Math.ceil((pineBars.length * chartMs * 1.1) / lowerMs) + 20),
              );
              try {
                const series = await Promise.race([
                  fetchSeries(request.symbol, request.timeframe, {
                    from,
                    to: last.time + chartMs,
                    limit,
                  }),
                  new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('lower timeframe fetch timed out')), LOWER_FETCH_TIMEOUT_MS);
                  }),
                ]);
                lowerCache.set(key, {
                  bars: series
                    .map((bar) => ({
                      time: bar.time,
                      open: bar.open,
                      high: bar.high,
                      low: bar.low,
                      close: bar.close,
                      volume: bar.volume ?? 0,
                    }))
                    .sort((a, b) => a.time - b.time),
                  at: Date.now(),
                });
              } catch {
                lowerCache.set(key, { bars: [], at: Date.now() });
              }
            }),
          );
          if (stopped || runGeneration !== generation) return;
          result = executeOnce();
        }

        if (stopped || runGeneration !== generation) return;
        reportResult(result, pineBars);
      } finally {
        running = false;
        if (pending && !stopped) {
          pending = false;
          void run();
        }
      }
    };

    // Watch mode starts during the history backfill: running on a partial prefix
    // would compute every series twice at full cost. Wait for the complete signal.
    if (req.historyState !== 'backfill') void run();

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
      },
      update: (next) => {
        Object.assign(values, next);
        void run();
      },
      setVisibleRange: (range) => {
        visibleRange = range;
        void run();
      },
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        if (reason === undefined && busyGesture()) {
          deferredLive.add(run);
          return;
        }
        void run();
      },
    };
  }
}
