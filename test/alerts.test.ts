import { beforeEach, describe, expect, it } from 'vitest';
import {
  alertsFor,
  clearAlerts,
  pushAlert,
  subscribeAlerts,
  type ChartAlert,
} from '../src/lib/alerts';

function alert(n: number, tabId = 'tab-a'): ChartAlert {
  return {
    id: `alert-${n}`,
    tabId,
    cellId: 'main',
    symbol: 'BTCUSDT.P',
    timeframe: '60',
    indicator: 'RSI',
    message: `message ${n}`,
    time: n,
  };
}

describe('alert store', () => {
  beforeEach(() => {
    clearAlerts('tab-a');
    clearAlerts('tab-b');
  });

  it('keeps the newest alerts first, capped at 50', () => {
    for (let n = 1; n <= 55; n += 1) pushAlert(alert(n));
    const stored = alertsFor('tab-a');
    expect(stored).toHaveLength(50);
    expect(stored[0]?.message).toBe('message 55');
    expect(stored[49]?.message).toBe('message 6');
  });

  it('keeps tabs separate and clears only one', () => {
    pushAlert(alert(1));
    pushAlert(alert(2, 'tab-b'));
    expect(alertsFor('tab-a')).toHaveLength(1);
    expect(alertsFor('tab-b')).toHaveLength(1);
    clearAlerts('tab-a');
    expect(alertsFor('tab-a')).toHaveLength(0);
    expect(alertsFor('tab-b')).toHaveLength(1);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    let calls = 0;
    const off = subscribeAlerts(() => {
      calls += 1;
    });
    pushAlert(alert(1));
    off();
    pushAlert(alert(2));
    expect(calls).toBe(1);
  });
});
