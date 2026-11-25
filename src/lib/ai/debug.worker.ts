import { VENUE_IDS, venueForVelaName } from '../../venues/catalog';
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
import {
  compilePineSession,
  fetchPineSeries,
  PineSession,
  type FetchSeries,
} from '../pineVela/session';
import { findPineInstrument, marketOf, toPineBar } from '../pineVela/seriesHost';

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<DebugRunRequest>) => void) | null;
  postMessage: (message: DebugWorkerMessage) => void;
};

const DEFAULT_BARS = 500;
const MAX_BARS = 10_000;
const MAX_LOGS = 60;
const MAX_LOG_CHARS = 300;
const MAX_SERIES_ROUNDS = 2;

function venueOf(symbol: string): VenueId | null {
  const at = symbol.indexOf(':');
  const provider = (at >= 0 ? symbol.slice(0, at) : 'binance').toLowerCase();
  return venueForVelaName(provider) ?? (VENUE_IDS.includes(provider) ? provider : null);
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
  const log = (level: 'info' | 'warning' | 'error', message: string) => {
    const prefix = level === 'warning' ? 'WARN ' : level === 'error' ? 'ERROR ' : '';
    const line = `${prefix}${message}`.slice(0, MAX_LOG_CHARS);
    if (logs.length >= MAX_LOGS) logs.shift();
    logs.push(line);
    workerSelf.postMessage({ type: 'log', line });
  };

  try {
    const adapter = new SidecarVenueAdapter(venue);
    const instruments = await adapter.listInstruments();
    const instrument = findPineInstrument(instruments, request.symbol);
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

    const compiled = compilePineSession(request.source, 'ai-debug', { debug: true });
    const session = new PineSession({
      program: compiled.program,
      instanceId: 'ai-debug',
      market: marketOf(instrument, request.timeframe),
      bars: bars.map(toPineBar),
      inputs: {},
      mode: 'live',
    });

    const fetchSeries: FetchSeries = async (symbol, timeframe, range) => {
      const target = findPineInstrument(instruments, symbol);
      if (!target) throw new Error(`No ${venue} instrument matches "${symbol}"`);
      const series = await adapter.fetchBars(
        target,
        timeframe,
        range.limit,
        undefined,
        { includeForming: true, to: range.to },
      );
      return series.map(toPineBar);
    };

    let outcome = session.run();
    for (let round = 0; outcome.needs.length > 0 && round < MAX_SERIES_ROUNDS; round++) {
      const series = await fetchPineSeries(outcome.needs, fetchSeries, (need) => {
        log(
          'warning',
          `request.security(${need.symbol}, ${need.timeframe}): no bars for this instrument`,
        );
      });
      session.resume(series);
      outcome = session.run();
    }

    // Logs and the variable snapshot belong to the final pass only; the
    // intrabar fetch runs the script once more after the resume.
    const final = session.run({
      debugBar: request.bar ?? bars.length - 1,
      onLog: log,
    });
    if (!final.result.ok) {
      const summary = emptyRunSummary(meta, final.result.error ?? 'The script failed');
      summary.logs = logs.slice();
      return summary;
    }
    return summarizeRun(final.result, meta, logs);
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
