import type { MainToWorker, PineToken, WorkerToMain } from './protocol';
import {
  compilePineSession,
  PineSession,
  type CompiledPine,
} from './session';

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
  postMessage: (message: WorkerToMain) => void;
};

interface SessionEntry {
  session: PineSession;
  source: string;
  startedAt: number;
}

const programs = new Map<string, { source: string; compiled: CompiledPine }>();
const sessions = new Map<number, SessionEntry>();

function post(message: WorkerToMain): void {
  workerSelf.postMessage(message);
}

function compiledFor(token: PineToken): CompiledPine {
  const cached = programs.get(token.instanceId);
  if (cached?.source === token.source) return cached.compiled;
  const compiled = compilePineSession(token.source, token.instanceId);
  programs.set(token.instanceId, { source: token.source, compiled });
  return compiled;
}

function resultOf(
  sessionId: number,
  runId: number,
  outcome: ReturnType<PineSession['run']>,
  startedAt: number,
): WorkerToMain {
  const durationMs = performance.now() - startedAt;
  if (outcome.needs.length > 0) {
    return {
      kind: 'needs',
      sessionId,
      runId,
      needs: outcome.needs,
      ...(outcome.provisional ? { provisional: outcome.result } : {}),
      durationMs,
    };
  }
  return { kind: 'result', sessionId, runId, result: outcome.result, durationMs };
}

function runSession(sessionId: number, runId: number): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  try {
    const outcome = entry.session.run();
    post(resultOf(sessionId, runId, outcome, entry.startedAt));
  } catch (cause) {
    post({
      kind: 'error',
      sessionId,
      runId,
      message: cause instanceof Error ? cause.message : String(cause),
      durationMs: performance.now() - entry.startedAt,
    });
  }
}

workerSelf.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.kind === 'stop') {
      sessions.delete(message.sessionId);
      return;
    }

    if (message.kind === 'resume') {
      const entry = sessions.get(message.sessionId);
      if (!entry) return;
      entry.session.resume(message.series);
      entry.startedAt = performance.now();
      runSession(message.sessionId, message.runId);
      return;
    }

    if (message.kind === 'run') {
      const compiled = compiledFor(message.token);
      let entry = sessions.get(message.sessionId);
      if (entry && entry.source !== message.token.source) {
        sessions.delete(message.sessionId);
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
          startedAt: performance.now(),
        };
        sessions.set(message.sessionId, entry);
      } else {
        entry.session.setBars(message.state.bars);
        entry.session.setInputs(message.state.inputs);
        entry.session.setVisibleRange(message.state.visibleRange);
        entry.startedAt = performance.now();
      }
      runSession(message.sessionId, message.runId);
    }
  } catch (cause) {
    if (message.kind === 'run' || message.kind === 'resume') {
      post({
        kind: 'error',
        sessionId: message.sessionId,
        runId: message.runId,
        message: cause instanceof Error ? cause.message : String(cause),
        durationMs: 0,
      });
    }
  }
};
