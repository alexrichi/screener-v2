import { toast } from 'sonner';
import type { AlertEvent, AlertRule } from '../types';
import {
  MAX_ALERT_RULES,
  parseAlertEvents,
  parseAlertRules,
  parseAlertRule,
} from './alertRules';

const RULES_KEY = 'screener.alerts.rules.v1';
const LOG_KEY = 'screener.alerts.log.v1';
const CAP = 500;

interface LogDocument {
  version: 1;
  events: AlertEvent[];
  lastReadAt: number;
  /** Replay guard: events received at or before this were already cleared. */
  clearedAt: number;
}

function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadRules(): AlertRule[] {
  return parseAlertRules(readJson(RULES_KEY));
}

function loadLog(): LogDocument {
  const raw = readJson(LOG_KEY);
  if (!raw || typeof raw !== 'object') {
    return { version: 1, events: [], lastReadAt: 0, clearedAt: 0 };
  }
  const doc = raw as Partial<LogDocument>;
  return {
    version: 1,
    events: parseAlertEvents(doc.events, CAP)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, CAP),
    lastReadAt:
      typeof doc.lastReadAt === 'number' && Number.isFinite(doc.lastReadAt) ? doc.lastReadAt : 0,
    // Old logs carry no field; `receivedAt > undefined` is always false.
    clearedAt:
      typeof doc.clearedAt === 'number' && Number.isFinite(doc.clearedAt) ? doc.clearedAt : 0,
  };
}

let rules = loadRules();
let log = loadLog();
let version = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set(log.events.map((event) => event.id));
const listeners = new Set<() => void>();
const ruleListeners = new Set<() => void>();

function emitRules(): void {
  for (const listener of ruleListeners) listener();
}

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function write(): void {
  try {
    globalThis.localStorage?.setItem(RULES_KEY, JSON.stringify(rules));
    globalThis.localStorage?.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* a full store keeps the session copy */
  }
}

function persist(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    write();
  }, 200);
}

/** Flush the debounced write: `clearedAt` and `lastReadAt` must land before a reload. */
function persistNow(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  write();
}

export function alertRules(): readonly AlertRule[] {
  return rules;
}

export function alertEvents(): readonly AlertEvent[] {
  return log.events;
}

export function alertUnreadCount(): number {
  return log.events.filter((event) => event.receivedAt > log.lastReadAt).length;
}

export function alertsVersion(): number {
  return version;
}

export function subscribeAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Rules-only changes: the sidecar bridge replays config on these, not on every event. */
export function subscribeAlertRules(listener: () => void): () => void {
  ruleListeners.add(listener);
  return () => ruleListeners.delete(listener);
}

export function addAlertRule(input: unknown): AlertRule | null {
  if (rules.length >= MAX_ALERT_RULES) return null;
  const rule = parseAlertRule(input);
  if (!rule) return null;
  if (rules.some((item) => item.id === rule.id)) return null;
  rules = [rule, ...rules];
  persist();
  emitRules();
  emit();
  return rule;
}

export function removeAlertRule(id: string): void {
  const next = rules.filter((rule) => rule.id !== id);
  if (next.length === rules.length) return;
  rules = next;
  persist();
  emitRules();
  emit();
}

export function setAlertRuleEnabled(id: string, enabled: boolean): void {
  let changed = false;
  rules = rules.map((rule) => {
    if (rule.id !== id || rule.enabled === enabled) return rule;
    changed = true;
    return { ...rule, enabled, updatedAt: Date.now() };
  });
  if (!changed) return;
  persist();
  emitRules();
  emit();
}

function beep(): void {
  try {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    oscillator.addEventListener('ended', () => void context.close());
  } catch {
    /* audio is a bonus, never a failure */
  }
}

let askedForNotifications = false;

function systemNotify(title: string, body: string, tag: string): void {
  const Notifier = (globalThis as { Notification?: typeof Notification }).Notification;
  if (!Notifier) return;
  const show = (): void => {
    try {
      const notification = new Notifier(title, { body, tag });
      notification.onclick = () => {
        globalThis.focus?.();
        notification.close();
      };
    } catch {
      /* notification support varies; the toast still shows */
    }
  };
  if (Notifier.permission === 'granted') {
    show();
    return;
  }
  if (Notifier.permission === 'default' && !askedForNotifications) {
    askedForNotifications = true;
    void Notifier.requestPermission().then((permission) => {
      if (permission === 'granted') show();
    });
  }
}

function notify(rule: AlertRule, event: AlertEvent): void {
  if (!rule.notify.toast && !rule.notify.sound && !rule.notify.system) return;
  if (rule.notify.toast) {
    toast(`${event.symbol} · ${rule.name}`, { description: event.message });
  }
  if (rule.notify.sound) beep();
  if (rule.notify.system) {
    systemNotify(`${event.symbol} · ${rule.name}`, event.message, event.id);
  }
}

function addEvents(incoming: AlertEvent[]): void {
  const fresh = incoming.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  if (fresh.length === 0) return;
  log = {
    ...log,
    events: [...fresh, ...log.events].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, CAP),
  };
  persist();
  emit();
}

function ingest(
  incoming: unknown,
  limit: number,
  withNotify: boolean,
  requireRule = false,
): number {
  const parsed = parseAlertEvents(incoming, limit);
  const unique = [...new Map(parsed.map((event) => [event.id, event])).values()];
  const events = unique.filter(
    (event) =>
      !seen.has(event.id) &&
      event.receivedAt > log.clearedAt &&
      // A live event for a rule the UI no longer has is a stale on-disk rule.
      (!requireRule || !event.ruleId || rules.some((rule) => rule.id === event.ruleId)),
  );
  if (events.length === 0) return 0;
  if (withNotify) {
    const byRule = new Map(rules.map((rule) => [rule.id, rule]));
    for (const event of events) {
      const rule = event.ruleId ? byRule.get(event.ruleId) : undefined;
      if (!rule) continue;
      notify(rule, event);
    }
  }
  addEvents(events);
  let changed = false;
  let disabledChanged = false;
  rules = rules.map((rule) => {
    const fired = events.filter((event) => event.ruleId === rule.id);
    if (fired.length === 0) return rule;
    changed = true;
    const latest = Math.max(...fired.map((event) => event.receivedAt));
    const nowOnce = rule.frequency === 'once';
    if (nowOnce && rule.enabled) disabledChanged = true;
    return {
      ...rule,
      fireCount: rule.fireCount + fired.length,
      lastFiredAt: latest,
      updatedAt: latest,
      ...(nowOnce ? { enabled: false } : {}),
    };
  });
  if (changed) {
    persist();
    emit();
    if (disabledChanged) emitRules();
  }
  return events.length;
}

/** Events evaluated by the sidecar for armed rules. */
export function pushRuleEvents(incoming: unknown): void {
  ingest(incoming, 100, true, true);
}

/**
 * Silent replay on connect: history and rule state update without per-event
 * toasts. Returns how many unseen events landed in the log.
 */
export function pushReplayEvents(incoming: unknown): number {
  return ingest(incoming, 500, false);
}

export function markAlertsRead(): void {
  log = { ...log, lastReadAt: Date.now() };
  persistNow();
  emit();
}

export function clearAlertLog(): void {
  log = { ...log, events: [], clearedAt: Date.now() };
  seen.clear();
  persistNow();
  emit();
}
