import type { ScriptRunSummary } from '../../types';
import {
  emptyRunSummary,
  maxBarsBackOf,
  summarizeError,
  type RunMeta,
} from './debugResult';

export interface DebugRunRequest {
  symbol: string;
  timeframe: string;
  source: string;
  /** Bar count to mirror from the active chart; 0 falls back to the worker default. */
  bars: number;
}

export type DebugWorkerMessage =
  | { type: 'log'; line: string }
  | { type: 'result'; summary: ScriptRunSummary };

const DEBUG_TIMEOUT_MS = 20_000;
const MAX_LOGS = 60;

/**
 * Run Pine in a disposable worker over sidecar bars. The worker is terminated on
 * completion, on error, and on timeout, so a runaway script cannot block the UI
 * or leak an indicator into the chart.
 */
export async function runScriptInWorker(request: DebugRunRequest): Promise<ScriptRunSummary> {
  const meta: RunMeta = {
    symbol: request.symbol,
    timeframe: request.timeframe,
    bars: request.bars,
    maxBarsBack: maxBarsBackOf(request.source),
  };
  try {
    return await new Promise<ScriptRunSummary>((resolve) => {
      const logs: string[] = [];
      let settled = false;
      const worker = new Worker(new URL('./debug.worker.ts', import.meta.url), {
        type: 'module',
        name: 'ai-debug',
      });
      const finish = (summary: ScriptRunSummary) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        worker.terminate();
        resolve(summary);
      };
      const timer = window.setTimeout(() => {
        const summary = emptyRunSummary(
          meta,
          `The debug worker did not finish within ${DEBUG_TIMEOUT_MS / 1000} seconds; the run was terminated.`,
        );
        summary.logs = logs.slice();
        finish(summary);
      }, DEBUG_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<DebugWorkerMessage>) => {
        const message = event.data;
        if (message.type === 'log') {
          if (logs.length >= MAX_LOGS) logs.shift();
          logs.push(message.line);
          return;
        }
        if (message.type === 'result') finish(message.summary);
      };
      worker.onerror = (event) => {
        const summary = emptyRunSummary(meta, event.message || 'The debug worker crashed.');
        summary.logs = logs.slice();
        finish(summary);
      };
      worker.postMessage(request);
    });
  } catch (error) {
    return summarizeError(error, meta);
  }
}
