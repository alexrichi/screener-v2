import type {
  EngineContextSnapshot,
  ExecutionHandlers,
  ExecutionRequest,
  ExecutionSession,
  InputSchema,
  InputValue,
  IndicatorModel,
  LineLikeKind,
  LineLikeSeries,
  PreparedScript,
  ScriptingEngine,
} from '@luxalgo/vela/plugin';
import { ACCENT, CATEGORICAL, stableSeriesId } from '@luxalgo/vela/plugin';
import { compilePine, type PineProgram, type PineRunResult } from '@screener/pine-engine';
import { pineDrawings } from './drawings';

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
    title: input.name || input.id,
    type: INPUT_TYPES[input.type] ?? 'float',
    defval: input.defval,
    ...(input.type === 'integer' ? { step: 1 } : {}),
  }));
}

function modelOf(
  token: PineToken,
  run: PineRunResult,
  bars: readonly { time: number }[],
  inputs: InputSchema[],
  values: Record<string, InputValue>,
): IndicatorModel {
  const { instanceId, program } = token;
  const series: LineLikeSeries[] = [];
  const ordinalByKey = new Map<string, number>();
  const drawings = pineDrawings(instanceId, run, bars);

  for (const plot of run.plots) {
    const kind = SERIES_KINDS[plot.type] ?? 'line';
    const ordinal = ordinalByKey.get(`${kind}:${plot.title}`) ?? 0;
    ordinalByKey.set(`${kind}:${plot.title}`, ordinal + 1);
    series.push({
      id: stableSeriesId({ instanceId, kind, title: plot.title, ordinal }),
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
    fills: [],
    backgrounds: drawings.backgrounds,
    priceLines: [],
    lines: drawings.lines,
    boxes: drawings.boxes,
    labels: drawings.labels,
    inputs,
    inputValues: values,
  };
}

/**
 * Pine Script engine for Vela, backed by the MIT `pine-engine` package.
 *
 * Plots only for now: drawings (`line.new` and friends), `bgcolor`, alerts and
 * `request.security` arrive as the engine reports them. No streaming context —
 * Vela re-runs this engine on every bar notification, which is what the old
 * worker engine did too.
 */
export class PineEngine implements ScriptingEngine {
  readonly language = 'pine';
  readonly capabilities = { streaming: false, visibleRange: false, inputs: true };

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
      reactsToViewport: false,
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

    const run = (): void => {
      if (stopped) return;
      const bars = req.getBars?.() ?? req.bars;
      if (bars.length === 0) return;
      const result = token.program.run({
        bars: bars.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume ?? 0,
        })),
        timeframe: req.market.timeframe,
        symbol: req.market.symbol,
        inputs: values,
      });
      if (!result.ok) {
        handlers.onError?.(new Error(result.error ?? 'The script failed'));
        return;
      }
      if (result.missingStd.length > 0) {
        handlers.onWarning?.({
          message: `Unsupported Pine functions: ${result.missingStd.join(', ')}`,
          bar: bars.length - 1,
        });
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
      handlers.onDone?.();
    };

    // Watch mode starts during the history backfill: running on a partial prefix
    // would compute every series twice at full cost. Wait for the complete signal.
    if (req.historyState !== 'backfill') run();

    return {
      getContext: (select) => {
        if (!snapshot) return Promise.resolve(null);
        if (!select) return Promise.resolve(snapshot);
        const picked = Object.fromEntries(select.map((key) => [key, snapshot![key]]));
        return Promise.resolve({ ...snapshot, ...picked });
      },
      stop: () => {
        stopped = true;
      },
      update: (next) => {
        Object.assign(values, next);
        run();
      },
      setVisibleRange: () => {},
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        run();
      },
    };
  }
}
