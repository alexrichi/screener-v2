/** One alert a script raised on a cell. Session-only, like Vela's own bell. */
export interface ChartAlertInput {
  id: string;
  cellId: string;
  symbol: string;
  timeframe: string;
  indicator?: string;
  title?: string;
  message: string;
  time: number;
}

export interface ChartAlert extends ChartAlertInput {
  tabId: string;
}

/** Retention matches Vela's `alertCap` default. */
const CAP = 50;
const EMPTY: readonly ChartAlert[] = [];
const byTab = new Map<string, readonly ChartAlert[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Store an alert, newest first, keeping the tab's last `CAP` entries. */
export function pushAlert(alert: ChartAlert): void {
  const current = byTab.get(alert.tabId) ?? EMPTY;
  byTab.set(alert.tabId, [alert, ...current].slice(0, CAP));
  emit();
}

export function clearAlerts(tabId: string): void {
  if (!byTab.delete(tabId)) return;
  emit();
}

export function alertsFor(tabId: string): readonly ChartAlert[] {
  return byTab.get(tabId) ?? EMPTY;
}

export function subscribeAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
