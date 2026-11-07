import type { ScriptRun, StrategyState, StrategyTrade } from '@luxalgo/vela/plugin';
import type {
  StrategyEquityPoint,
  StrategyStateWithCurve,
} from './pineVela/strategy';

/** One strategy script running on a chart cell, as the Strategy panel shows it. */
export interface StrategyRunState {
  id: string;
  cellId: string;
  title: string;
  state: StrategyState;
  /** Per-bar equity from the engine, for the panel and viewer chart. */
  equityCurve: readonly StrategyEquityPoint[];
  trades: readonly StrategyTrade[];
  /** The async ledger has landed at least once. */
  tradesLoaded: boolean;
  bar: number;
  forming: boolean;
}

const EMPTY = new Map<string, StrategyRunState>();
const byTab = new Map<string, ReadonlyMap<string, StrategyRunState>>();
const snapshots = new Map<string, readonly StrategyRunState[]>();
const listeners = new Set<() => void>();

function emit(tabId: string): void {
  snapshots.delete(tabId);
  for (const listener of listeners) listener();
}

function keyOf(cellId: string, id: string): string {
  return `${cellId}:${id}`;
}

/** Record a strategy run; the trade ledger is pulled off the tick path. */
export function pushStrategyRun(tabId: string, cellId: string, run: ScriptRun): void {
  if (run.kind !== 'strategy' || !run.strategy) return;
  const key = keyOf(cellId, run.id);
  const current = byTab.get(tabId) ?? EMPTY;
  const previous = current.get(key);
  // A new script under the same indicator id keeps the old ledger until the
  // fresh one lands; drop it instead of showing another strategy's trades.
  const changedScript = previous !== undefined && previous.title !== run.title;
  const state = run.strategy as StrategyStateWithCurve;
  const entry: StrategyRunState = {
    id: run.id,
    cellId,
    title: run.title,
    state,
    equityCurve: state.equityCurve ?? [],
    trades: changedScript ? [] : (previous?.trades ?? []),
    tradesLoaded: changedScript ? false : (previous?.tradesLoaded ?? false),
    bar: run.bar,
    forming: run.forming,
  };
  const next = new Map(current);
  next.set(key, entry);
  byTab.set(tabId, next);
  emit(tabId);

  const needsLedger =
    !entry.tradesLoaded ||
    changedScript ||
    previous?.id !== entry.id ||
    previous.bar !== entry.bar ||
    run.cause !== 'tick';
  if (!needsLedger) return;

  void run.trades().then((trades) => {
    const map = byTab.get(tabId);
    // A newer run replaced this one while the ledger was loading.
    if (!map || map.get(key) !== entry) return;
    const updated = new Map(map);
    updated.set(key, { ...entry, trades, tradesLoaded: true });
    byTab.set(tabId, updated);
    emit(tabId);
  }).catch(() => {
    // A ledger pull after teardown is not a user-visible failure.
  });
}

export function removeStrategyRun(tabId: string, cellId: string, id: string): void {
  const current = byTab.get(tabId);
  if (!current?.has(keyOf(cellId, id))) return;
  const next = new Map(current);
  next.delete(keyOf(cellId, id));
  byTab.set(tabId, next);
  emit(tabId);
}

export function clearStrategyRuns(tabId: string): void {
  if (!byTab.delete(tabId)) return;
  emit(tabId);
}

export function strategyRunsFor(tabId: string): readonly StrategyRunState[] {
  const cached = snapshots.get(tabId);
  if (cached) return cached;
  const map = byTab.get(tabId);
  const list = map && map.size > 0 ? [...map.values()] : [];
  snapshots.set(tabId, list);
  return list;
}

export function subscribeStrategyRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
