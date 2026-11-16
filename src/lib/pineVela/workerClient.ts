import type { PineBar, PineProgram, PineRunResult } from '@screener/pine-engine';
import type {
  MainToWorker,
  PineRunState,
  PineToken,
  WorkerReply,
  WorkerToMain,
} from './protocol';
import { fetchPineSeries, PineSession } from './session';
import type {
  FetchSeries,
  PineMarket,
  PineSeriesReply,
  PineSeriesRequest,
} from './session';

export type { FetchSeries, SeriesBar } from './session';

const WORKER_IDLE_MS = 30_000;

/** Run ids are per session; key pending replies by both. */
function replyKey(sessionId: number, runId: number): string {
  return `${sessionId}:${runId}`;
}

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
  terminate(): void;
}

export type WorkerFactory = () => WorkerLike;

export interface PineRunner {
  run(
    state: PineRunState,
    onProvisional?: (result: PineRunResult) => void,
  ): Promise<{ result: PineRunResult; durationMs: number }>;
  stop(): void;
}

/** One worker per PineEngine; sessions are multiplexed by id. */
export class PineWorkerClient {
  private worker: WorkerLike | null = null;
  private readonly replies = new Map<
    string,
    { resolve: (value: WorkerReply) => void; reject: (error: Error) => void }
  >();
  private readonly sessionRuns = new Map<number, Set<number>>();
  private readonly stoppedSessions = new Set<number>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly factory: WorkerFactory) {}

  run(message: {
    sessionId: number;
    runId: number;
    token: PineToken;
    market: PineMarket;
    state: PineRunState;
  }): void {
    this.stoppedSessions.delete(message.sessionId);
    this.trackSession(message.sessionId, message.runId);
    try {
      this.post({ kind: 'run', ...message });
    } catch (error) {
      this.sessionRuns.get(message.sessionId)?.delete(message.runId);
      throw error;
    }
  }

  resume(sessionId: number, runId: number, series: PineSeriesReply[]): void {
    this.post({ kind: 'resume', sessionId, runId, series });
  }

  next(sessionId: number, runId: number): Promise<WorkerReply> {
    if (this.stoppedSessions.has(sessionId)) {
      return Promise.reject(new Error('The Pine run was stopped'));
    }
    return new Promise<WorkerReply>((resolve, reject) => {
      this.replies.set(replyKey(sessionId, runId), { resolve, reject });
    });
  }

  stop(sessionId: number): void {
    this.stoppedSessions.add(sessionId);
    if (this.worker) this.post({ kind: 'stop', sessionId });
    const runs = this.sessionRuns.get(sessionId);
    this.sessionRuns.delete(sessionId);
    for (const runId of runs ?? []) {
      const key = replyKey(sessionId, runId);
      this.replies.get(key)?.reject(new Error('The Pine run was stopped'));
      this.replies.delete(key);
    }
    this.scheduleIdle();
  }

  terminate(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error('The Pine worker was terminated'));
  }

  private trackSession(sessionId: number, runId: number): void {
    const runs = this.sessionRuns.get(sessionId) ?? new Set<number>();
    runs.add(runId);
    this.sessionRuns.set(sessionId, runs);
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const pending = [...this.sessionRuns.values()].some((runs) => runs.size > 0);
      if (!pending && this.replies.size === 0) {
        this.terminate();
      }
    }, WORKER_IDLE_MS);
  }

  private post(message: MainToWorker): void {
    this.ensureWorker().postMessage(message);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.addEventListener('message', (event) => {
      this.onMessage(event.data as WorkerToMain);
    });
    worker.addEventListener('error', (event) => {
      const message =
        event instanceof ErrorEvent && event.message
          ? event.message
          : 'The Pine worker failed';
      this.failAll(new Error(message));
    });
    this.worker = worker;
    this.scheduleIdle();
    return worker;
  }

  private onMessage(message: WorkerToMain): void {
    const key = replyKey(message.sessionId, message.runId);
    const pending = this.replies.get(key);
    if (!pending) return;
    if (message.kind === 'needs') {
      // Keep the run id tracked across the main-thread fetch so stop() can
      // still reject a run that is waiting for series.
      this.replies.delete(key);
      pending.resolve(message);
      return;
    }
    this.replies.delete(key);
    const runs = this.sessionRuns.get(message.sessionId);
    runs?.delete(message.runId);
    if (runs && runs.size === 0) this.sessionRuns.delete(message.sessionId);
    if (message.kind === 'error') pending.reject(new Error(message.message));
    else pending.resolve(message);
    this.scheduleIdle();
  }

  private failAll(error: Error): void {
    for (const pending of this.replies.values()) pending.reject(error);
    this.replies.clear();
    this.sessionRuns.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

export function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** Node and worker-less hosts run the same session on the main thread. */
export class LocalPineRunner implements PineRunner {
  private session: PineSession | null = null;

  constructor(
    private readonly program: PineProgram,
    private readonly instanceId: string,
    private readonly market: PineMarket,
    private readonly fetchSeries: FetchSeries | undefined,
    private readonly onForeignError: (need: PineSeriesRequest) => void,
  ) {}

  async run(
    state: PineRunState,
    onProvisional?: (result: PineRunResult) => void,
  ): Promise<{ result: PineRunResult; durationMs: number }> {
    if (!this.session) {
      this.session = new PineSession({
        program: this.program,
        instanceId: this.instanceId,
        market: this.market,
        bars: state.bars,
        inputs: state.inputs,
        visibleRange: state.visibleRange,
        mode: state.mode,
      });
    } else {
      this.session.setBars(state.bars);
      this.session.setInputs(state.inputs);
      this.session.setVisibleRange(state.visibleRange);
    }
    const started = performance.now();
    let outcome = this.session.run();
    if (outcome.needs.length > 0) {
      if (outcome.provisional) onProvisional?.(outcome.result);
      const series = await fetchPineSeries(
        outcome.needs,
        this.fetchSeries,
        this.onForeignError,
      );
      this.session.resume(series);
      outcome = this.session.run();
    }
    return { result: outcome.result, durationMs: performance.now() - started };
  }

  stop(): void {
    this.session = null;
  }
}

export class WorkerPineRunner implements PineRunner {
  private runId = 0;

  constructor(
    private readonly client: PineWorkerClient,
    private readonly sessionId: number,
    private readonly token: PineToken,
    private readonly market: PineMarket,
    private readonly fetchSeries: FetchSeries | undefined,
    private readonly onForeignError: (need: PineSeriesRequest) => void,
  ) {}

  async run(
    state: PineRunState,
    onProvisional?: (result: PineRunResult) => void,
  ): Promise<{ result: PineRunResult; durationMs: number }> {
    const runId = ++this.runId;
    this.client.run({
      sessionId: this.sessionId,
      runId,
      token: this.token,
      market: this.market,
      state,
    });
    let reply = await this.client.next(this.sessionId, runId);
    while (reply.kind === 'needs') {
      if (reply.provisional) onProvisional?.(reply.provisional);
      const series = await fetchPineSeries(
        reply.needs,
        this.fetchSeries,
        this.onForeignError,
      );
      this.client.resume(this.sessionId, runId, series);
      reply = await this.client.next(this.sessionId, runId);
    }
    if (reply.kind === 'error') throw new Error(reply.message);
    return { result: reply.result, durationMs: reply.durationMs };
  }

  stop(): void {
    this.client.stop(this.sessionId);
  }
}

