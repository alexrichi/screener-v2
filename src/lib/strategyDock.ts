import { useSyncExternalStore } from 'react';

export interface StrategyDockState {
  height: number;
  collapsed: boolean;
}

export const STRATEGY_DOCK_KEY = 'screener.strategy.dock';
export const STRATEGY_DOCK_MIN = 160;
export const STRATEGY_DOCK_MAX = 560;
const DEFAULT: StrategyDockState = { height: 280, collapsed: false };

function isState(value: unknown): value is StrategyDockState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const dock = value as Partial<StrategyDockState>;
  return (
    typeof dock.height === 'number' &&
    Number.isFinite(dock.height) &&
    dock.height >= STRATEGY_DOCK_MIN &&
    dock.height <= STRATEGY_DOCK_MAX &&
    typeof dock.collapsed === 'boolean'
  );
}

function read(): StrategyDockState {
  try {
    const raw = localStorage.getItem(STRATEGY_DOCK_KEY);
    if (raw === null) return DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let state = read();
const listeners = new Set<() => void>();

/**
 * One dock preference for every tab's strip. The strip is mounted per Vela
 * workspace, and a hidden tab must pick up a height changed on the active one.
 */
export function setStrategyDock(patch: Partial<StrategyDockState>): void {
  const next: StrategyDockState = {
    height: Math.min(
      STRATEGY_DOCK_MAX,
      Math.max(STRATEGY_DOCK_MIN, Math.round(patch.height ?? state.height)),
    ),
    collapsed: patch.collapsed ?? state.collapsed,
  };
  if (next.height === state.height && next.collapsed === state.collapsed) return;
  state = next;
  try {
    localStorage.setItem(STRATEGY_DOCK_KEY, JSON.stringify(state));
  } catch {
    /* storage can be unavailable; the dock still works in memory */
  }
  for (const listener of listeners) listener();
}

export function useStrategyDock(): StrategyDockState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => DEFAULT,
  );
}
