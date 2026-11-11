import { compilePine } from '@screener/pine-engine';
import { VENUE_IDS } from '../../venues/catalog';
import { sameVelaSymbol } from '../../venues/instrument';
import { SidecarVenueAdapter } from '../../venues/sidecar';
import type { VenueId } from '../../venues/types';
import type { ScriptRunSummary } from '../../types';
import type { DebugRunRequest, DebugWorkerMessage } from './debugRun';
import {
  emptyRunSummary,
  maxBarsBackOf,
  summarizeRun,
  type DebugRunMeta,
} from './debugResult';

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<DebugRunRequest>) => void) | null;
  postMessage: (message: DebugWorkerMessage) => void;
};

const DEFAULT_BARS = 500;
const MAX_BARS = 10_000;
const MAX_LOGS = 60;
const MAX_LOG_CHARS = 300;

function venueOf(symbol: string): VenueId | null {
  const at = symbol.indexOf(':');
  const provider = (at >= 0 ? symbol.slice(0, at) : 'binance').toLowerCase();
  return VENUE_IDS.find((id) => id === provider) ?? null;
}

async function run(request: DebugRunRequest): Promise<ScriptRunSummary> {
  const meta: DebugRunMeta = {
    symbol: request.symbol,
    timeframe: request.timeframe,
    bars: 0,
    maxBarsBack: maxBarsBackOf(request.source),
  };
  const venue = venueOf(request.symbol);
  if (!venue) return emptyRunSummary(meta, `Unknown venue in "${request.symbol}".`);

  const logs: string[] = [];
  try {
    const adapter = new SidecarVenueAdapter(venue);
    const instruments = await adapter.listInstruments();
    const instrument = instruments.find((candidate) =>
      sameVelaSymbol(candidate.velaSymbol, request.symbol),
    );
    if (!instrument) {
      return emptyRunSummary(meta, `No ${venue} instrument matches "${request.symbol}".`);
    }

    const requested = request.bars > 0 ? Math.round(request.bars) : DEFAULT_BARS;
    const bars = await adapter.fetchBars(
      instrument,
      request.timeframe,
      Math.max(2, Math.min(MAX_BARS, requested)),
      undefined,
      { includeForming: true },
    );
    meta.bars = bars.length;
    if (bars.length < 2) {
      return emptyRunSummary(
        meta,
        `Not enough bars for ${request.symbol} ${request.timeframe}.`,
      );
    }

    const program = compilePine({ source: request.source, debug: true });
    if (!program.ok) {
      return emptyRunSummary(meta, program.error ?? 'The script could not be compiled');
    }
    const result = program.run({
      bars: bars.map((bar) => ({
        time: bar.openTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })),
      timeframe: request.timeframe,
      symbol: instrument.nativeId,
      live: true,
      debugBar: request.bar ?? bars.length - 1,
      onLog: (level, message) => {
        const prefix = level === 'warning' ? 'WARN ' : level === 'error' ? 'ERROR ' : '';
        const line = `${prefix}${message}`.slice(0, MAX_LOG_CHARS);
        if (logs.length >= MAX_LOGS) logs.shift();
        logs.push(line);
        workerSelf.postMessage({ type: 'log', line });
      },
    });
    if (!result.ok) {
      const summary = emptyRunSummary(meta, result.error ?? 'The script failed');
      summary.logs = logs.slice();
      return summary;
    }
    return summarizeRun(result, meta, logs);
  } catch (error) {
    const summary = emptyRunSummary(
      meta,
      error instanceof Error ? error.message : String(error),
    );
    summary.logs = logs.slice();
    return summary;
  }
}

workerSelf.onmessage = (event) => {
  void run(event.data).then((summary) => workerSelf.postMessage({ type: 'result', summary }));
};
