import type { PineBar, PineRunResult } from '@screener/pine-engine';
import type {
  PineMarket,
  PineSeriesReply,
  PineSeriesRequest,
  PineVisibleRange,
} from './session';

export interface PineToken {
  source: string;
  instanceId: string;
  overlay: boolean;
  shortName?: string;
}

export interface PineRunState {
  bars: PineBar[];
  inputs: Record<string, string | number | boolean>;
  visibleRange?: PineVisibleRange;
  mode?: string;
}

export type MainToWorker =
  | {
      kind: 'run';
      sessionId: number;
      runId: number;
      token: PineToken;
      market: PineMarket;
      state: PineRunState;
    }
  | {
      kind: 'resume';
      sessionId: number;
      runId: number;
      series: PineSeriesReply[];
    }
  | { kind: 'stop'; sessionId: number };

export type WorkerToMain =
  | {
      kind: 'needs';
      sessionId: number;
      runId: number;
      needs: PineSeriesRequest[];
      provisional?: PineRunResult;
      durationMs: number;
    }
  | {
      kind: 'result';
      sessionId: number;
      runId: number;
      result: PineRunResult;
      durationMs: number;
    }
  | {
      kind: 'error';
      sessionId: number;
      runId: number;
      message: string;
      durationMs: number;
    };

export type WorkerReply = Extract<
  WorkerToMain,
  { kind: 'needs' } | { kind: 'result' } | { kind: 'error' }
>;
