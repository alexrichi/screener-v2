import {
  canonicalTimeframe,
  compilePine,
  timeframeMs,
  type PineBar,
  type PineInput,
  type PineProgram,
  type PineRunResult,
} from '@screener/pine-engine';

export interface PineVisibleRange {
  left: number;
  right: number;
}

export interface PineMarket {
  symbol: string;
  timeframe: string;
  symbolInfo?: Record<string, unknown>;
}

export interface PineSeriesRequest {
  key: string;
  kind: 'lower' | 'foreign';
  symbol: string;
  timeframe: string;
  from: number;
  to: number;
  limit: number;
}

export interface PineSeriesReply {
  key: string;
  kind: 'lower' | 'foreign';
  bars: PineBar[];
}

export interface PineRunOptions {
  /** Zero-based bar whose top-level variables are snapshotted on this run. */
  debugBar?: number;
  /** Log sink for this run; pass it only on the final pass after `resume`. */
  onLog?: (level: 'info' | 'warning' | 'error', message: string) => void;
}

export interface PineRunOutcome {
  result: PineRunResult;
  needs: PineSeriesRequest[];
  /** Report this partial result before the lower-timeframe fetch. */
  provisional: boolean;
}

export interface SeriesBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FetchSeries {
  (
    symbol: string,
    timeframe: string,
    range: { from: number; to: number; limit: number },
  ): Promise<readonly SeriesBar[]>;
}

export interface PineSessionOptions {
  program: PineProgram;
  instanceId: string;
  market: PineMarket;
  bars: PineBar[];
  inputs: Record<string, string | number | boolean>;
  visibleRange?: PineVisibleRange;
  mode?: string;
}

export interface CompiledPine {
  program: PineProgram;
  inputs: PineInput[];
  meta: {
    name: string;
    shortName?: string;
    overlay: boolean;
  };
  reactsToViewport: boolean;
}

const LOWER_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 20_000;

export function compilePineSession(
  source: string,
  instanceId: string,
  options: { debug?: boolean } = {},
): CompiledPine {
  const program = compilePine({ source, id: instanceId, debug: options.debug });
  if (!program.ok) {
    throw new Error(program.error ?? 'The script could not be compiled');
  }
  return {
    program,
    inputs: program.meta.inputs,
    meta: {
      name: program.meta.name,
      ...(program.meta.shortName ? { shortName: program.meta.shortName } : {}),
      overlay: program.meta.overlay,
    },
    reactsToViewport: /chart\.(?:left|right)_visible_bar_time/.test(source),
  };
}

interface CachedSeries {
  bars: PineBar[];
  at: number;
}

/**
 * One Pine run session. It owns the input values, visible range, the security
 * caches and the nested-probe cache, so a worker can keep the same state across
 * live ticks without sending probe snapshots back to the main thread.
 */
export class PineSession {
  private readonly program: PineProgram;
  private readonly market: PineMarket;
  private readonly mode: string;
  private readonly lowerCache = new Map<string, CachedSeries>();
  private readonly foreignCache = new Map<string, CachedSeries>();
  private readonly probeCache = new Map<string, unknown[]>();
  private readonly prefix: unknown;
  private values: Record<string, string | number | boolean>;
  private bars: PineBar[];
  private visibleRange: PineVisibleRange | undefined;
  private probeSignature = '';
  private foreignChartSignature = '';

  constructor(options: PineSessionOptions) {
    this.program = options.program;
    this.market = options.market;
    this.prefix = (options.market.symbolInfo as { prefix?: unknown } | undefined)?.prefix;
    this.mode = options.mode ?? 'static';
    this.bars = options.bars;
    this.values = { ...options.inputs };
    this.visibleRange = options.visibleRange;
  }

  setBars(bars: PineBar[]): void {
    this.bars = bars;
  }

  setInputs(next: Record<string, string | number | boolean>): void {
    this.values = { ...this.values, ...next };
  }

  setVisibleRange(range: PineVisibleRange | undefined): void {
    this.visibleRange = range;
  }

  resume(series: readonly PineSeriesReply[]): void {
    for (const entry of series) {
      const cache = entry.kind === 'lower' ? this.lowerCache : this.foreignCache;
      cache.set(entry.key, { bars: entry.bars, at: Date.now() });
    }
  }

  run(options: PineRunOptions = {}): PineRunOutcome {
    if (this.bars.length === 0) {
      return {
        result: emptyResult(this.program, this.bars),
        needs: [],
        provisional: false,
      };
    }
    this.syncProbeCache();
    const requested = new Map<string, { symbol: string; timeframe: string }>();
    const foreignRequested = new Map<string, { symbol: string; timeframe: string }>();
    const result = this.program.run({
      bars: this.bars,
      timeframe: this.market.timeframe,
      symbol: this.market.symbol,
      symbolInfo: this.market.symbolInfo,
      live: this.mode === 'live',
      visibleRange: this.visibleRange,
      securityProbeCache: this.probeCache,
      inputs: this.values,
      ...(options.debugBar !== undefined ? { debugBar: options.debugBar } : {}),
      ...(options.onLog ? { onLog: options.onLog } : {}),
      lowerBars: Object.fromEntries(
        [...this.lowerCache].map(([key, entry]) => [key, entry.bars]),
      ),
      foreignBars: Object.fromEntries(
        [...this.foreignCache].map(([key, entry]) => [key, entry.bars]),
      ),
      onLowerTimeframe: (symbol, timeframe) => {
        const tf = canonicalTimeframe(timeframe);
        const normalized = this.normalizeForeign(symbol);
        requested.set(`${normalized}@${tf}`, { symbol: normalized, timeframe: tf });
      },
      onForeignSymbol: (symbol, timeframe) => {
        const tf = canonicalTimeframe(timeframe);
        const normalized = this.normalizeForeign(symbol);
        foreignRequested.set(`${normalized}@${tf}`, {
          symbol: normalized,
          timeframe: tf,
        });
      },
    });
    return {
      result,
      needs: [
        ...this.lowerNeeds(requested),
        ...this.foreignNeeds(foreignRequested),
      ],
      provisional: [...requested.keys()].some((key) => !this.lowerCache.has(key)),
    };
  }

  private normalizeForeign(symbol: string): string {
    const at = symbol.indexOf(':');
    if (
      at > 0 &&
      typeof this.prefix === 'string' &&
      symbol.slice(0, at).toUpperCase() === this.prefix.toUpperCase()
    ) {
      return symbol.slice(at + 1);
    }
    return symbol;
  }

  private lowerNeeds(
    requested: Map<string, { symbol: string; timeframe: string }>,
  ): PineSeriesRequest[] {
    const last = this.bars.at(-1);
    if (!last) return [];
    const chartMs = timeframeMs(this.market.timeframe) || 1;
    const from = this.bars[0]?.time ?? last.time;
    return [...requested]
      .filter(([key]) => {
        const entry = this.lowerCache.get(key);
        return !entry || Date.now() - entry.at >= LOWER_TTL_MS;
      })
      .map(([key, request]) => {
        const lowerMs = timeframeMs(request.timeframe) || 1;
        return {
          key,
          kind: 'lower' as const,
          symbol: request.symbol,
          timeframe: request.timeframe,
          from,
          to: last.time + chartMs,
          limit: Math.min(
            100_000,
            Math.max(500, Math.ceil((this.bars.length * chartMs * 1.1) / lowerMs) + 20),
          ),
        };
      });
  }

  private foreignNeeds(
    requested: Map<string, { symbol: string; timeframe: string }>,
  ): PineSeriesRequest[] {
    const last = this.bars.at(-1);
    if (!last) return [];
    const chartMs = timeframeMs(this.market.timeframe) || 1;
    const from = this.bars[0]?.time ?? last.time;
    return [...requested]
      .filter(([key]) => {
        const entry = this.foreignCache.get(key);
        return !entry || Date.now() - entry.at >= LOWER_TTL_MS;
      })
      .map(([key, request]) => {
        const requestedMs = timeframeMs(request.timeframe) || chartMs;
        return {
          key,
          kind: 'foreign' as const,
          symbol: request.symbol,
          timeframe: request.timeframe,
          from,
          to: last.time + chartMs,
          limit: Math.min(
            100_000,
            Math.max(50, Math.ceil((this.bars.length * chartMs * 1.1) / requestedMs) + 20),
          ),
        };
      });
  }

  private syncProbeCache(): void {
    const lowerSignature = Object.entries(this.lowerCache)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => {
        const last = entry.bars.at(-1);
        return `${key}:${entry.bars.length}:${last?.time ?? 0}:${last?.close ?? 0}:${last?.high ?? 0}:${last?.low ?? 0}:${last?.volume ?? 0}`;
      })
      .join('|');
    const last = this.bars.at(-1);
    const chartSignature = `${this.bars.length}:${last?.time ?? 0}`;
    if (chartSignature !== this.foreignChartSignature) {
      this.foreignChartSignature = chartSignature;
      this.foreignCache.clear();
    }
    const foreignSignature = Object.entries(this.foreignCache)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => {
        const tail = entry.bars.at(-1);
        return `${key}:${entry.bars.length}:${tail?.time ?? 0}:${tail?.close ?? 0}`;
      })
      .join('|');
    const signature = `${JSON.stringify(this.values)}|${chartSignature}|${lowerSignature}|${foreignSignature}`;
    if (signature !== this.probeSignature) {
      this.probeCache.clear();
      this.probeSignature = signature;
    }
  }
}

export async function fetchPineSeries(
  needs: readonly PineSeriesRequest[],
  fetchSeries: FetchSeries | undefined,
  onForeignError: (need: PineSeriesRequest) => void,
): Promise<PineSeriesReply[]> {
  return Promise.all(
    needs.map(async (need) => {
      if (!fetchSeries) {
        if (need.kind === 'foreign') onForeignError(need);
        return { key: need.key, kind: need.kind, bars: [] };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const series = await Promise.race([
          fetchSeries(need.symbol, need.timeframe, {
            from: need.from,
            to: need.to,
            limit: need.limit,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Pine series fetch timed out')),
              FETCH_TIMEOUT_MS,
            );
          }),
        ]);
        return {
          key: need.key,
          kind: need.kind,
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
        };
      } catch {
        if (need.kind === 'foreign') onForeignError(need);
        return { key: need.key, kind: need.kind, bars: [] };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }),
  );
}

function emptyResult(program: PineProgram, bars: readonly PineBar[]): PineRunResult {
  const values = new Array<number>(bars.length).fill(Number.NaN);
  return {
    ok: false,
    error: 'No chart bars',
    name: program.meta.name,
    overlay: program.meta.overlay,
    plots: program.meta.plots.map((plot) => ({ ...plot, values })),
    drawings: { lines: [], boxes: [], labels: [], backgrounds: [], linefills: [], polylines: [] },
    tables: [],
    shapes: [],
    candles: [],
    priceLines: [],
    fills: [],
    barColors: [],
    inputs: program.meta.inputs,
    alerts: [],
    warnings: [],
    missingStd: [],
  };
}
