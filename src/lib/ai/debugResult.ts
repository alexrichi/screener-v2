import { extractPlots, type PlotLike } from '../../scan/extractPlots';
import type { ScriptRunSummary } from '../../types';

export interface RunMeta {
  symbol: string;
  timeframe: string;
  bars: number;
  maxBarsBack: number | null;
}

const MAX_VARS = 40;
const MAX_VAR_CHARS = 200;
const MAX_WARNINGS = 20;
const MAX_STACK_CHARS = 4000;

interface RawWarning {
  message?: unknown;
  method?: unknown;
}

interface RawContext {
  fullContext?: RawContext;
  plots?: Record<string, PlotLike>;
  warnings?: RawWarning[];
  strategy?: unknown;
  var?: Record<string, unknown>;
  const?: Record<string, unknown>;
  let?: Record<string, unknown>;
}

/** The Pine declaration's lookback, used to report and size the debug window. */
export function maxBarsBackOf(source: string): number | null {
  const match = /max_bars_back\s*=\s*(\d+)/.exec(source);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function emptyRunSummary(meta: RunMeta, error: string | null = null): ScriptRunSummary {
  return {
    ok: false,
    error,
    stack: null,
    errorName: null,
    method: null,
    complete: false,
    warnings: [],
    plots: {},
    vars: {},
    strategy: false,
    bars: meta.bars,
    maxBarsBack: meta.maxBarsBack,
    symbol: meta.symbol,
    timeframe: meta.timeframe,
    logs: [],
  };
}

/** A series' newest value; plain values pass through unchanged. */
function currentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value[value.length - 1];
  if (value && typeof value === 'object') {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data[data.length - 1];
  }
  return value;
}

/** PineTS scopes globals as `glb<n>_<name>`; the model must see the source name. */
function sourceName(key: string): string {
  return key.replace(/^glb\d+_/, '');
}

function pickVars(bucket: Record<string, unknown> | undefined, into: Record<string, string>): void {
  for (const [key, value] of Object.entries(bucket ?? {})) {
    if (Object.keys(into).length >= MAX_VARS) return;
    if (key.startsWith('_')) continue;
    const current = currentValue(value);
    if (
      typeof current === 'number' ||
      typeof current === 'boolean' ||
      typeof current === 'string'
    ) {
      into[sourceName(key)] = String(current).slice(0, MAX_VAR_CHARS);
    }
  }
}

/** Scalar variables at the last bar, keyed by the names written in the source. */
export function scalarVars(context: unknown): Record<string, string> {
  const ctx = (context ?? {}) as RawContext;
  const root = ctx.fullContext ?? ctx;
  const vars: Record<string, string> = {};
  pickVars(root.const, vars);
  pickVars(root.var, vars);
  pickVars(root.let, vars);
  return vars;
}

export function summarizeContext(context: unknown, meta: RunMeta): ScriptRunSummary {
  const ctx = (context ?? {}) as RawContext;
  const plots: Record<string, number | null> = {};
  for (const plot of extractPlots(ctx.plots)) {
    plots[plot.key] = plot.value;
  }
  const warnings = (ctx.warnings ?? [])
    .map((warning) => {
      const message = String(warning.message ?? '');
      const method = typeof warning.method === 'string' ? warning.method : '';
      return method ? `${method}: ${message}` : message;
    })
    .filter(Boolean)
    .slice(0, MAX_WARNINGS);
  return {
    ok: true,
    error: null,
    stack: null,
    errorName: null,
    method: null,
    complete: true,
    warnings,
    plots,
    vars: scalarVars(context),
    strategy: ctx.strategy != null,
    bars: meta.bars,
    maxBarsBack: meta.maxBarsBack,
    symbol: meta.symbol,
    timeframe: meta.timeframe,
    logs: [],
  };
}

export function summarizeError(error: unknown, meta: RunMeta): ScriptRunSummary {
  const raw =
    error && typeof error === 'object'
      ? (error as { message?: unknown; name?: unknown; stack?: unknown; method?: unknown })
      : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof raw?.message === 'string'
        ? raw.message
        : String(error);
  return {
    ...emptyRunSummary(meta, message || 'The run failed.'),
    errorName: typeof raw?.name === 'string' && raw.name ? raw.name : null,
    method: typeof raw?.method === 'string' ? raw.method : null,
    stack: typeof raw?.stack === 'string' ? raw.stack.slice(0, MAX_STACK_CHARS) : null,
  };
}
