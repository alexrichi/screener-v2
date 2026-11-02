import { Indicator, PineTS } from 'pinets';
import { SidecarVenueAdapter } from '../venues/sidecar';
import { VenueRateLimitError } from '../venues/rateLimit';
import type { Instrument } from '../venues/types';
import type { ScanResult, ScanWorkerIn, ScanWorkerOut } from '../types';
import { extractPlots, type PlotLike } from './extractPlots';

interface RunContext {
  plots?: Record<string, PlotLike>;
}

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<ScanWorkerIn>) => void) | null;
  postMessage: (message: ScanWorkerOut) => void;
};

let activeId = 0;
let controller: AbortController | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function scan(msg: Extract<ScanWorkerIn, { type: 'scan' }>): Promise<void> {
  activeId = msg.id;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;

  let indicator: Indicator;
  try {
    indicator = new Indicator(msg.script);
  } catch (error) {
    workerSelf.postMessage({ type: 'fatal', id: msg.id, error: errorMessage(error) });
    return;
  }

  const adapter = new SidecarVenueAdapter('binance');
  let instruments: Instrument[];
  try {
    instruments = await adapter.listInstruments(signal);
  } catch (error) {
    if (signal.aborted) return;
    controller?.abort();
    workerSelf.postMessage({ type: 'fatal', id: msg.id, error: errorMessage(error) });
    return;
  }
  if (signal.aborted) return;
  const bySymbol = new Map(instruments.map((instrument) => [instrument.nativeId, instrument]));

  const queue = [...msg.symbols];
  const total = queue.length;
  let done = 0;

  const runOne = async (symbol: string): Promise<void> => {
    if (signal.aborted) return;
    const started = performance.now();
    try {
      const instrument = bySymbol.get(symbol);
      if (!instrument) throw new Error(`No ${adapter.id} instrument for ${symbol}`);
      const bars = await adapter.fetchBars(instrument, msg.timeframe, msg.bars, signal);
      if (bars.length < 2) throw new Error('Not enough closed bars');
      const pine = new PineTS(bars, symbol, msg.timeframe);
      const context = (await pine.run(indicator)) as RunContext;
      const result: ScanResult = {
        symbol,
        plots: extractPlots(context.plots),
        ms: Math.round(performance.now() - started),
      };
      if (signal.aborted) return;
      workerSelf.postMessage({ type: 'result', id: msg.id, result });
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof VenueRateLimitError) {
        controller?.abort();
        workerSelf.postMessage({
          type: 'fatal',
          id: msg.id,
          error: error.message,
        });
        return;
      }
      const result: ScanResult = {
        symbol,
        plots: [],
        error: errorMessage(error),
        ms: Math.round(performance.now() - started),
      };
      workerSelf.postMessage({ type: 'result', id: msg.id, result });
    } finally {
      if (!signal.aborted) {
        done += 1;
        workerSelf.postMessage({
          type: 'progress',
          id: msg.id,
          done,
          total,
          symbol,
        });
      }
    }
  };

  const concurrency = Math.max(1, Math.min(10, msg.concurrency || 6));
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0 && !signal.aborted) {
      const symbol = queue.shift();
      if (!symbol) break;
      await runOne(symbol);
    }
  });

  await Promise.all(runners);
  if (!signal.aborted) workerSelf.postMessage({ type: 'done', id: msg.id });
}

workerSelf.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'abort') {
    if (message.id === activeId) controller?.abort();
    return;
  }
  if (message.type === 'scan') {
    void scan(message);
  }
};
