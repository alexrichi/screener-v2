import { describe, expect, it } from 'vitest';
import type { ExecutionHandlers, ExecutionRequest, IndicatorModel } from '@luxalgo/vela/plugin';
import { PineEngine } from '../src/lib/pineVela/engine';
import type { MainToWorker, WorkerToMain } from '../src/lib/pineVela/protocol';
import {
  compilePineSession,
  PineSession,
  type CompiledPine,
} from '../src/lib/pineVela/session';
import type { WorkerLike } from '../src/lib/pineVela/workerClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

class InlineWorker {
  private readonly listeners = new Map<string, Set<(event: { data: unknown } | unknown) => void>>();
  private readonly programs = new Map<string, { source: string; compiled: CompiledPine }>();
  private readonly sessions = new Map<number, { session: PineSession; source: string }>();
  private terminated = false;

  postMessage(message: unknown): void {
    setTimeout(() => {
      if (!this.terminated) this.handle(message as MainToWorker);
    }, 0);
  }

  addEventListener(type: string, listener: (event: { data: unknown } | unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
    this.sessions.clear();
  }

  private emit(message: WorkerToMain): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: message });
    }
  }

  private compiledFor(token: { source: string; instanceId: string }): CompiledPine {
    const cached = this.programs.get(token.instanceId);
    if (cached?.source === token.source) return cached.compiled;
    const compiled = compilePineSession(token.source, token.instanceId);
    this.programs.set(token.instanceId, { source: token.source, compiled });
    return compiled;
  }

  private run(sessionId: number, runId: number): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    try {
      const started = performance.now();
      const outcome = entry.session.run();
      const durationMs = performance.now() - started;
      if (outcome.needs.length > 0) {
        this.emit({
          kind: 'needs',
          sessionId,
          runId,
          needs: outcome.needs,
          ...(outcome.provisional ? { provisional: outcome.result } : {}),
          durationMs,
        });
      } else {
        this.emit({ kind: 'result', sessionId, runId, result: outcome.result, durationMs });
      }
    } catch (error) {
      this.emit({
        kind: 'error',
        sessionId,
        runId,
        message: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      });
    }
  }

  private handle(message: MainToWorker): void {
    if (message.kind === 'stop') {
      this.sessions.delete(message.sessionId);
      return;
    }
    if (message.kind === 'resume') {
      const entry = this.sessions.get(message.sessionId);
      if (!entry) return;
      entry.session.resume(message.series);
      this.run(message.sessionId, message.runId);
      return;
    }
    if (message.kind === 'run') {
      const compiled = this.compiledFor(message.token);
      let entry = this.sessions.get(message.sessionId);
      if (entry && entry.source !== message.token.source) {
        this.sessions.delete(message.sessionId);
        entry = undefined;
      }
      if (!entry) {
        entry = {
          session: new PineSession({
            program: compiled.program,
            instanceId: message.token.instanceId,
            market: message.market,
            bars: message.state.bars,
            inputs: message.state.inputs,
            visibleRange: message.state.visibleRange,
            mode: message.state.mode,
          }),
          source: message.token.source,
        };
        this.sessions.set(message.sessionId, entry);
      } else {
        entry.session.setBars(message.state.bars);
        entry.session.setInputs(message.state.inputs);
        entry.session.setVisibleRange(message.state.visibleRange);
      }
      this.run(message.sessionId, message.runId);
    }
  }
}

const bars = Array.from({ length: 8 }, (_, index) => ({
  time: index * 15 * 60_000,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 10,
}));

describe('PineEngine worker protocol', () => {
  it('prepares and runs a script through the worker', async () => {
    const engine = new PineEngine({
      workerFactory: () => new InlineWorker() as unknown as WorkerLike,
    });
    try {
      const prepared = await engine.prepare(
        `//@version=6
indicator("Worker", overlay = true)
plot(close, "Close")`,
        'worker-basic',
      );
      expect(prepared.inputs).toEqual([]);
      const models: IndicatorModel[] = [];
      const handlers = {
        onModel: (model: IndicatorModel) => models.push(model),
      } as unknown as ExecutionHandlers;
      const request = {
        prepared,
        market: { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15' },
        bars,
        mode: 'static',
        historyState: 'complete',
      } as unknown as ExecutionRequest;
      const session = engine.execute(request, handlers);
      await waitFor(() => models.length > 0);
      expect(models[0]?.title).toBe('Worker');
      expect(models[0]?.overlay).toBe(true);
      expect(models[0]?.paneHint).toBe('price');
      expect(models[0]?.series[0]?.title).toBe('Close');
      session.stop();
    } finally {
      engine.dispose();
    }
  });

  it('keeps two indicator sessions with their own run ids', async () => {
    const engine = new PineEngine({
      workerFactory: () => new InlineWorker() as unknown as WorkerLike,
    });
    try {
      const alpha = await engine.prepare(
        `//@version=6
indicator("Alpha")
plot(close, "Alpha close")`,
        'worker-alpha',
      );
      const beta = await engine.prepare(
        `//@version=6
indicator("Beta", overlay = true)
plot(open, "Beta open")`,
        'worker-beta',
      );
      const models: IndicatorModel[] = [];
      const handlers = {
        onModel: (model: IndicatorModel) => models.push(model),
      } as unknown as ExecutionHandlers;
      const base = {
        market: { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15' },
        bars,
        mode: 'static',
        historyState: 'complete',
      } as unknown as ExecutionRequest;
      const alphaSession = engine.execute({ ...base, prepared: alpha }, handlers);
      const betaSession = engine.execute({ ...base, prepared: beta }, handlers);
      await waitFor(() => models.length >= 2);
      const alphaModel = models.find((model) => model.title === 'Alpha');
      const betaModel = models.find((model) => model.title === 'Beta');
      expect(alphaModel?.overlay).toBe(false);
      expect(alphaModel?.paneHint).toBe('new');
      expect(alphaModel?.series[0]?.title).toBe('Alpha close');
      expect(betaModel?.overlay).toBe(true);
      expect(betaModel?.paneHint).toBe('price');
      expect(betaModel?.series[0]?.title).toBe('Beta open');
      alphaSession.stop();
      betaSession.stop();
    } finally {
      engine.dispose();
    }
  });

  it('fetches lower bars through needs/resume', async () => {
    const engine = new PineEngine({
      workerFactory: () => new InlineWorker() as unknown as WorkerLike,
    });
    try {
      const prepared = await engine.prepare(
        `//@version=6
indicator("Intrabar")
[times, closes] = request.security_lower_tf(syminfo.tickerid, "1", [time, close])
plot(array.size(times), "Count")`,
        'worker-lower',
      );
      const lower = Array.from({ length: 60 }, (_, index) => ({
        time: index * 60_000,
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100 + index,
        volume: 1,
      }));
      let calls = 0;
      const models: IndicatorModel[] = [];
      const handlers = {
        onModel: (model: IndicatorModel) => models.push(model),
      } as unknown as ExecutionHandlers;
      const request = {
        prepared,
        market: { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15' },
        bars: Array.from({ length: 4 }, (_, index) => ({
          time: index * 15 * 60_000,
          open: 100 + index,
          high: 110 + index,
          low: 90 + index,
          close: 100 + index,
          volume: 10,
        })),
        fetchSeries: async () => {
          calls += 1;
          return lower;
        },
        mode: 'static',
        historyState: 'complete',
      } as unknown as ExecutionRequest;
      const session = engine.execute(request, handlers);
      await waitFor(() => models.some((model) => {
        const count = model.series.find((series) => series.title === 'Count');
        return count?.kind === 'line' && count.points[0]?.value === 15;
      }));
      expect(calls).toBe(1);
      const model = models.find((candidate) => {
        const count = candidate.series.find((series) => series.title === 'Count');
        return count?.kind === 'line' && count.points[0]?.value === 15;
      });
      expect(model).toBeTruthy();
      session.stop();
    } finally {
      engine.dispose();
    }
  });

  it('captures logs and a debug snapshot on the final run', () => {
    const compiled = compilePineSession(
      `//@version=6
indicator("Debug")
src = close
var total = 0.0
total := total + src
plot(src)
log.info("total " + str.tostring(total))`,
      'worker-debug',
      { debug: true },
    );
    const session = new PineSession({
      program: compiled.program,
      instanceId: 'worker-debug',
      market: { symbol: 'BTCUSDT.P', timeframe: '15' },
      bars: [
        { time: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        { time: 900_000, open: 20, high: 21, low: 19, close: 20, volume: 1 },
        { time: 1_800_000, open: 30, high: 31, low: 29, close: 35, volume: 1 },
      ],
      inputs: {},
      mode: 'static',
    });
    const logs: string[] = [];
    const outcome = session.run({
      debugBar: 2,
      onLog: (level, message) => logs.push(`${level}:${message}`),
    });
    expect(outcome.needs).toEqual([]);
    expect(logs).toEqual(['info:total 10', 'info:total 30', 'info:total 65']);
    expect(outcome.result.debug).toEqual({
      bar: 2,
      values: { src: '35', total: '65' },
    });
  });
});
