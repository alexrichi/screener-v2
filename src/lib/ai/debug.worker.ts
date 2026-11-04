import { Indicator, PineTS } from 'pinets';
import type { ScriptRunSummary } from '../../types';
import { VENUE_IDS } from '../../venues/catalog';
import { sameVelaSymbol } from '../../venues/instrument';
import { SidecarVenueAdapter } from '../../venues/sidecar';
import type { VenueId } from '../../venues/types';
import type { DebugRunRequest, DebugWorkerMessage } from './debugRun';
import {
  emptyRunSummary,
  maxBarsBackOf,
  summarizeContext,
  summarizeError,
  type RunMeta,
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

/**
 * PineTS writes `log.info/warning/error` through console; capture those calls
 * so the model gets the script's own log lines with the run result.
 */
function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const write = (prefix: string) => (...args: unknown[]) => {
    const text = args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ');
    const line = `${prefix}${text}`.slice(0, MAX_LOG_CHARS);
    // Keep the newest lines: a per-bar log fills the cap from the oldest bar.
    if (logs.length >= MAX_LOGS) logs.shift();
    logs.push(line);
    workerSelf.postMessage({ type: 'log', line });
  };
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = write('');
  console.warn = write('WARN ');
  console.error = write('ERROR ');
  return {
    logs,
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

async function run(request: DebugRunRequest): Promise<ScriptRunSummary> {
  const meta: RunMeta = {
    symbol: request.symbol,
    timeframe: request.timeframe,
    bars: 0,
    maxBarsBack: maxBarsBackOf(request.source),
  };
  const venue = venueOf(request.symbol);
  if (!venue) return emptyRunSummary(meta, `Unknown venue in "${request.symbol}".`);

  let capture: ReturnType<typeof captureLogs> | null = null;
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

    capture = captureLogs();
    const indicator = new Indicator(request.source);
    const pine = new PineTS(bars, instrument.nativeId, request.timeframe);
    const context = await pine.run(indicator);
    const summary = summarizeContext(context, meta);
    summary.logs = capture.logs.slice();
    return summary;
  } catch (error) {
    const summary = summarizeError(error, meta);
    if (capture) summary.logs = capture.logs.slice();
    return summary;
  } finally {
    capture?.restore();
  }
}

workerSelf.onmessage = (event) => {
  void run(event.data).then((summary) => workerSelf.postMessage({ type: 'result', summary }));
};
