import type { AlertEvent, AlertRule, WorkspaceTab } from '../types';
import { sameVelaSymbol } from '../venues/instrument';

/** Where an alert click lands: an open tab, or a tab the app should create. */
export type AlertChartTarget =
  | { kind: 'tab'; tabId: string }
  | { kind: 'new-tab'; symbol: string; timeframe: string };

/**
 * The chart behind an alert. A tab whose active symbol matches wins; otherwise
 * the caller opens a new tab at the rule's chart timeframe, not the 1m stream
 * the price runner evaluates.
 */
export function resolveAlertChart(
  event: AlertEvent,
  tabs: readonly WorkspaceTab[],
  rules: readonly AlertRule[],
): AlertChartTarget | null {
  const rule = event.ruleId ? rules.find((item) => item.id === event.ruleId) : undefined;
  const symbol = event.velaSymbol || rule?.target.velaSymbol || event.symbol;
  if (!symbol) return null;
  const tab = tabs.find((item) => sameVelaSymbol(item.symbol, symbol));
  if (tab) return { kind: 'tab', tabId: tab.id };
  return {
    kind: 'new-tab',
    symbol,
    timeframe: rule?.timeframe || event.timeframe || '15',
  };
}
