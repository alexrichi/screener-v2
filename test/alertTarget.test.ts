import { describe, expect, it } from 'vitest';
import { resolveAlertChart } from '../src/lib/alertTarget';
import type { AlertEvent, PriceAlertRule, WorkspaceTab } from '../src/types';

function tab(id: string, symbol: string): WorkspaceTab {
  return { id, symbol, timeframe: '15', layout: '1', altSymbol: 'ETHUSDT' };
}

function priceRule(overrides: Partial<PriceAlertRule> = {}): PriceAlertRule {
  return {
    version: 1,
    id: 'price-1',
    kind: 'price',
    name: 'BTCUSDT.P Crossing 61 000',
    target: {
      kind: 'instrument',
      venue: 'binance',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      symbol: 'BTCUSDT.P',
    },
    timeframe: '60',
    price: 61_000,
    priceText: '61 000',
    condition: 'crossing',
    frequency: 'once',
    notify: { toast: true, sound: false, system: false },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

function event(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'price:price-1:1:up',
    kind: 'rule',
    ruleId: 'price-1',
    venue: 'binance',
    velaSymbol: 'BINANCE:BTCUSDT.P',
    symbol: 'BTCUSDT.P',
    timeframe: '1',
    source: 'BTCUSDT.P Crossing 61 000',
    site: 'Crossing up',
    message: 'BTCUSDT.P crossed up 61 000',
    price: 61_000,
    time: 1,
    receivedAt: 1,
    ...overrides,
  };
}

describe('resolveAlertChart', () => {
  it('activates the tab whose active symbol matches, keeping spot and perp apart', () => {
    const tabs = [
      tab('spot', 'BINANCE:BTCUSDT'),
      tab('perp', 'BINANCE:BTCUSDT.P'),
    ];
    expect(resolveAlertChart(event(), tabs, [priceRule()])).toEqual({
      kind: 'tab',
      tabId: 'perp',
    });
  });

  it('opens a new tab at the rule chart timeframe when no tab shows the symbol', () => {
    const tabs = [tab('eth', 'BINANCE:ETHUSDT.P')];
    expect(resolveAlertChart(event(), tabs, [priceRule()])).toEqual({
      kind: 'new-tab',
      symbol: 'BINANCE:BTCUSDT.P',
      timeframe: '60',
    });
  });

  it('falls back to the event timeframe once the rule is gone', () => {
    const target = resolveAlertChart(event(), [], []);
    expect(target).toEqual({
      kind: 'new-tab',
      symbol: 'BINANCE:BTCUSDT.P',
      timeframe: '1',
    });
  });

  it('matches a bare ticker as the Binance perpetual', () => {
    const tabs = [tab('perp', 'BTCUSDT')];
    const bare = event({ velaSymbol: undefined, symbol: 'BTCUSDT.P' });
    expect(resolveAlertChart(bare, tabs, [])).toEqual({ kind: 'tab', tabId: 'perp' });
  });

  it('returns null for an event with no resolvable symbol', () => {
    expect(resolveAlertChart(event({ velaSymbol: undefined, symbol: '' }), [], [])).toBeNull();
  });
});
