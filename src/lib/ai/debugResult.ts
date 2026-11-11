import type { PineRunResult } from '@screener/pine-engine';
import { extractEnginePlots } from '../../scan/extractPlots';
import type { ScriptRunSummary } from '../../types';

export interface DebugRunMeta {
  symbol: string;
  timeframe: string;
  bars: number;
  maxBarsBack: number | null;
}

const MAX_WARNINGS = 20;
const MAX_LOGS = 60;

/** The Pine declaration's lookback, used to report and size the debug window. */
export function maxBarsBackOf(source: string): number | null {
  const match = /max_bars_back\s*=\s*(\d+)/.exec(source);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function emptyRunSummary(
  meta: DebugRunMeta,
  error: string | null = null,
): ScriptRunSummary {
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

/** Map one engine run over closed bars to the summary the model reads. */
export function summarizeRun(
  run: PineRunResult,
  meta: DebugRunMeta,
  logs: readonly string[] = [],
): ScriptRunSummary {
  const warnings = [...run.warnings];
  if (run.missingStd.length > 0) {
    warnings.push(`Unsupported Pine functions: ${run.missingStd.join(', ')}`);
  }
  return {
    ok: true,
    error: null,
    stack: null,
    errorName: null,
    method: null,
    complete: true,
    warnings: warnings.slice(0, MAX_WARNINGS),
    plots: Object.fromEntries(
      extractEnginePlots(run.plots).map((plot) => [plot.key, plot.value]),
    ),
    vars: run.debug?.values ?? {},
    strategy: run.strategy != null,
    bars: meta.bars,
    maxBarsBack: meta.maxBarsBack,
    symbol: meta.symbol,
    timeframe: meta.timeframe,
    logs: logs.slice(0, MAX_LOGS),
    ...(run.debug ? { debugBar: run.debug.bar } : {}),
  };
}
