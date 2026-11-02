import { Indicator, PineTS } from 'pinets';
import { SidecarVenueAdapter } from '../venues/sidecar';
import { VenueRateLimitError } from '../venues/rateLimit';
import type { Instrument, ScanResult, ScanWorkerIn, ScanWorkerOut } from '../types';
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

  const total = msg.targets.reduce((sum, target) => sum + target.instruments.length, 0);
  let done = 0;

  const postProgress = (venue: string, symbol: string) => {
    workerSelf.postMessage({
      type: 'progress',
      id: msg.id,
      done,
      total,
      venue,
      symbol,
    });
  };

  const postError = (venue: string, instrument: Instrument, error: unknown) => {
    const result: ScanResult = {
      key: instrument.key,
      venue,
      symbol: instrument.nativeId,
      plots: [],
      error: errorMessage(error),
      ms: 0,
    };
    workerSelf.postMessage({ type: 'result', id: msg.id, result });
  };

  for (const target of msg.targets) {
    if (signal.aborted) return;
    const adapter = new SidecarVenueAdapter(target.venue);
    const queue = [...target.instruments];
    const concurrency = Math.max(1, Math.min(10, msg.concurrency || 6));
    let skipVenue = false;

    const runOne = async (instrument: Instrument): Promise<void> => {
      if (signal.aborted) return;
      const started = performance.now();
      try {
        const bars = await adapter.fetchBars(
          instrument,
          msg.timeframe,
          msg.bars,
          signal,
          { priority: 'background' },
        );
        if (bars.length < 2) throw new Error('Not enough closed bars');
        const pine = new PineTS(bars, instrument.nativeId, msg.timeframe);
        const context = (await pine.run(indicator)) as RunContext;
        if (signal.aborted) return;
        const result: ScanResult = {
          key: instrument.key,
          venue: target.venue,
          symbol: instrument.nativeId,
          plots: extractPlots(context.plots),
          ms: Math.round(performance.now() - started),
        };
        workerSelf.postMessage({ type: 'result', id: msg.id, result });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof VenueRateLimitError) skipVenue = true;
        postError(target.venue, instrument, error);
      } finally {
        if (!signal.aborted) {
          done += 1;
          postProgress(target.venue, instrument.nativeId);
        }
      }
    };

    const runners = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length > 0 && !signal.aborted) {
          const instrument = queue.shift();
          if (!instrument) break;
          if (skipVenue) {
            postError(target.venue, instrument, 'Venue rate limit reached');
            done += 1;
            postProgress(target.venue, instrument.nativeId);
            continue;
          }
          await runOne(instrument);
        }
      },
    );

    await Promise.all(runners);
  }

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
