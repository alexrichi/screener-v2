import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store renders toasts through sonner; keep the module importable in Node.
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, { info: () => {}, warning: () => {} }),
}));

import {
  addAlertRule,
  alertEvents,
  alertRules,
  alertUnreadCount,
  markAlertsRead,
  pushRuleEvents,
  removeAlertRule,
  setAlertRuleEnabled,
  subscribeAlerts,
  subscribeAlertRules,
} from '../src/lib/alerts';
import { MAX_ALERT_RULES } from '../src/lib/alertRules';

const BASE = 1_700_000_000_000;

function rulePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'r1',
    kind: 'chart',
    name: 'Probe',
    target: {
      kind: 'instrument',
      venue: 'binance',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      symbol: 'BTCUSDT.P',
    },
    timeframe: '15',
    script: 'indicator("a")\nalert("hi")\n',
    inputs: {},
    sites: ['Bullish'],
    includeAlert: false,
    frequency: 'once-per-bar-close',
    notify: { toast: false, sound: false, system: false },
    indicatorTitle: 'Probe',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

function event(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `ev-${n}`,
    kind: 'rule',
    ruleId: 'r1',
    venue: 'binance',
    velaSymbol: 'BINANCE:BTCUSDT.P',
    symbol: 'BTCUSDT.P',
    timeframe: '15',
    source: 'Probe',
    site: 'fired',
    message: `message ${n}`,
    price: 100,
    time: BASE + n,
    receivedAt: BASE + n,
    ...overrides,
  };
}

describe('alert store rules', () => {
  it('caps rules at MAX_ALERT_RULES and rejects duplicate ids', () => {
    for (let index = 0; index < MAX_ALERT_RULES; index += 1) {
      expect(addAlertRule(rulePayload({ id: `cap-${index}` }))).not.toBeNull();
    }
    expect(alertRules()).toHaveLength(MAX_ALERT_RULES);
    expect(addAlertRule(rulePayload({ id: 'one-more' }))).toBeNull();
    expect(addAlertRule(rulePayload({ id: 'cap-0' }))).toBeNull();
    for (let index = 0; index < MAX_ALERT_RULES; index += 1) {
      removeAlertRule(`cap-${index}`);
    }
    expect(alertRules()).toHaveLength(0);
  });

  it('emits rules-only changes for add, enable and remove, but not for repeats', () => {
    let emits = 0;
    const off = subscribeAlertRules(() => {
      emits += 1;
    });
    expect(addAlertRule(rulePayload({ id: 'emit-1' }))).not.toBeNull();
    expect(emits).toBe(1);
    setAlertRuleEnabled('emit-1', false);
    expect(emits).toBe(2);
    setAlertRuleEnabled('emit-1', false);
    expect(emits).toBe(2);
    removeAlertRule('emit-1');
    expect(emits).toBe(3);
    expect(alertRules().some((rule) => rule.id === 'emit-1')).toBe(false);
    off();
  });
});

describe('alert store events', () => {
  beforeEach(() => {
    addAlertRule(rulePayload({ id: 'r1' }));
  });

  afterEach(() => {
    removeAlertRule('r1');
  });

  it('keeps the newest 500 events, newest first', () => {
    for (let batch = 0; batch < 6; batch += 1) {
      pushRuleEvents(Array.from({ length: 100 }, (_, index) => event(batch * 100 + index)));
    }
    const stored = alertEvents();
    expect(stored).toHaveLength(500);
    expect(stored[0]!.id).toBe('ev-599');
  });

  it('counts unread events, notifies subscribers, and marks them read', () => {
    let calls = 0;
    const off = subscribeAlerts(() => {
      calls += 1;
    });
    pushRuleEvents([event(700), event(701)]);
    const notified = calls;
    expect(notified).toBeGreaterThan(0);
    expect(alertUnreadCount()).toBeGreaterThanOrEqual(2);
    off();
    markAlertsRead();
    expect(alertUnreadCount()).toBe(0);
    pushRuleEvents([event(702)]);
    expect(calls).toBe(notified);
  });

  it('drops live events for rules that are not in the store', () => {
    pushRuleEvents([event(900, { ruleId: 'missing' }), event(901, { ruleId: 'r1' })]);
    expect(alertEvents().some((item) => item.id === 'ev-900')).toBe(false);
    expect(alertEvents().some((item) => item.id === 'ev-901')).toBe(true);
  });

  it('disables a once rule on its first fire and dedupes a replayed event', () => {
    expect(addAlertRule(rulePayload({ id: 'once-1', frequency: 'once' }))).not.toBeNull();
    pushRuleEvents([event(800, { ruleId: 'once-1' })]);
    let rule = alertRules().find((item) => item.id === 'once-1');
    expect(rule?.enabled).toBe(false);
    expect(rule?.fireCount).toBe(1);

    pushRuleEvents([event(800, { ruleId: 'once-1' })]);
    rule = alertRules().find((item) => item.id === 'once-1');
    expect(rule?.fireCount).toBe(1);
    expect(alertEvents().filter((item) => item.id === 'ev-800')).toHaveLength(1);
    removeAlertRule('once-1');
  });
});
