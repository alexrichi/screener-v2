import type {
  AlertEvent,
  AlertFrequency,
  AlertInputValues,
  AlertRule,
  AlertRunnerRule,
} from '../types';
import { VENUE_IDS } from '../venues/catalog';

export const MAX_ALERT_RULES = 20;
export const MAX_ALERT_SCRIPT_CHARS = 200_000;
export const MAX_ALERT_SITES = 50;

const FREQUENCIES: readonly AlertFrequency[] = ['once', 'once-per-bar-close'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inputValues(value: unknown): AlertInputValues {
  if (!isObject(value)) return {};
  const out: AlertInputValues = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'boolean') out[key] = item;
    else if (finite(item)) out[key] = item;
  }
  return out;
}

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, cap);
}

/** A stored rule is trusted only when every field the runner reads is valid. */
export function parseAlertRule(value: unknown): AlertRule | null {
  if (!isObject(value) || value.kind !== 'chart') return null;
  const target = value.target;
  if (!isObject(target) || target.kind !== 'instrument') return null;
  if (
    typeof target.venue !== 'string' ||
    !VENUE_IDS.includes(target.venue as (typeof VENUE_IDS)[number]) ||
    typeof target.velaSymbol !== 'string' ||
    target.velaSymbol.length === 0 ||
    typeof target.symbol !== 'string' ||
    target.symbol.length === 0
  ) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.name !== 'string' ||
    typeof value.script !== 'string' ||
    value.script.length === 0 ||
    value.script.length > MAX_ALERT_SCRIPT_CHARS ||
    typeof value.timeframe !== 'string' ||
    value.timeframe.length === 0 ||
    typeof value.indicatorTitle !== 'string' ||
    !FREQUENCIES.includes(value.frequency as AlertFrequency) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.includeAlert !== 'boolean' ||
    !finite(value.createdAt) ||
    !finite(value.updatedAt) ||
    !finite(value.fireCount)
  ) {
    return null;
  }
  const notify = value.notify;
  if (!isObject(notify)) return null;
  const sites = stringList(value.sites, MAX_ALERT_SITES);
  if (sites.length === 0 && value.includeAlert !== true) return null;
  return {
    version: 1,
    id: value.id,
    kind: 'chart',
    name: value.name.slice(0, 120),
    target: {
      kind: 'instrument',
      venue: target.venue as AlertRule['target']['venue'],
      velaSymbol: target.velaSymbol,
      symbol: target.symbol,
    },
    timeframe: value.timeframe,
    script: value.script,
    inputs: inputValues(value.inputs),
    sites,
    includeAlert: value.includeAlert,
    frequency: value.frequency as AlertFrequency,
    notify: {
      toast: notify.toast === true,
      sound: notify.sound === true,
      system: notify.system === true,
    },
    indicatorTitle: value.indicatorTitle.slice(0, 120),
    enabled: value.enabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastFiredAt: finite(value.lastFiredAt) ? value.lastFiredAt : null,
    fireCount: Math.max(0, Math.floor(value.fireCount)),
  };
}

/** Rules from storage or a WebSocket frame; malformed entries are dropped. */
export function parseAlertRules(value: unknown): AlertRule[] {
  if (!Array.isArray(value)) return [];
  const out: AlertRule[] = [];
  for (const item of value.slice(0, MAX_ALERT_RULES)) {
    const rule = parseAlertRule(item);
    if (rule) out.push(rule);
  }
  return out;
}

/** The sidecar form: an `AlertRule` plus the resolved target keys to evaluate. */
export function parseRunnerRules(value: unknown): AlertRunnerRule[] {
  if (!Array.isArray(value)) return [];
  const out: AlertRunnerRule[] = [];
  for (const item of value.slice(0, MAX_ALERT_RULES)) {
    const rule = parseAlertRule(item);
    if (!rule || !isObject(item)) continue;
    const targets = Array.isArray(item.targets)
      ? item.targets
          .filter((key): key is string => typeof key === 'string' && key.length > 0)
          .slice(0, 50)
      : [];
    if (targets.length === 0) continue;
    out.push({ ...rule, targets });
  }
  return out;
}

/** Resolve the chart-only target into the runner's target-key list. */
export function runnerRules(rules: readonly AlertRule[]): AlertRunnerRule[] {
  return rules.map((rule) => ({
    ...rule,
    targets: [rule.target.velaSymbol],
  }));
}

export function parseAlertEvent(value: unknown): AlertEvent | null {
  if (!isObject(value)) return null;
  const id = value.id;
  const kind = value.kind;
  const symbol = value.symbol;
  const source = value.source;
  const message = value.message;
  const time = value.time;
  if (
    typeof id !== 'string' ||
    (kind !== 'chart' && kind !== 'rule') ||
    typeof symbol !== 'string' ||
    typeof source !== 'string' ||
    typeof message !== 'string' ||
    !finite(time)
  ) {
    return null;
  }
  return {
    id,
    kind,
    ...(typeof value.ruleId === 'string' ? { ruleId: value.ruleId } : {}),
    ...(typeof value.tabId === 'string' ? { tabId: value.tabId } : {}),
    ...(typeof value.cellId === 'string' ? { cellId: value.cellId } : {}),
    ...(typeof value.venue === 'string' && VENUE_IDS.includes(value.venue as (typeof VENUE_IDS)[number])
      ? { venue: value.venue as AlertEvent['venue'] }
      : {}),
    ...(typeof value.velaSymbol === 'string' ? { velaSymbol: value.velaSymbol } : {}),
    ...(typeof value.timeframe === 'string' ? { timeframe: value.timeframe } : {}),
    ...(typeof value.site === 'string' ? { site: value.site } : {}),
    ...(finite(value.price) ? { price: value.price } : {}),
    symbol,
    source,
    message,
    time,
    receivedAt: finite(value.receivedAt) ? value.receivedAt : Date.now(),
  };
}

/** Live frames stay small; disk and the renderer log keep the full cap. */
export function parseAlertEvents(value: unknown, limit = 100): AlertEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, limit)
    .map(parseAlertEvent)
    .filter((event): event is AlertEvent => event !== null);
}
