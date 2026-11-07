import { describe, expect, it } from 'vitest';
import type { StrategyResult } from '@screener/pine-engine';
import {
  strategyStateOf,
  strategyTradesOf,
  tradeExecutionsOf,
} from '../src/lib/pineVela/strategy';

const result: StrategyResult = {
  trades: [
    {
      id: 'Long Exit',
      entryId: 'Long',
      direction: 'long',
      entryPrice: 100,
      exitPrice: 110,
      qty: 2,
      profit: 20,
      entryBar: 1,
      exitBar: 3,
      entryTime: 1_000,
      exitTime: 3_000,
    },
    {
      id: 'Short Exit',
      entryId: 'Short',
      direction: 'short',
      entryPrice: 120,
      exitPrice: 125,
      qty: 1,
      profit: -5,
      entryBar: 4,
      exitBar: 6,
      entryTime: 4_000,
      exitTime: 6_000,
    },
  ],
  equityCurve: [],
  netProfit: 15,
  totalTrades: 2,
  winRate: 0.5,
  profitFactor: 4,
  maxDrawdown: 9,
  maxRunup: 30,
  initialCapital: 1_000,
  grossProfit: 20,
  grossLoss: 5,
  equity: 1_015,
  openPnl: 3,
  position: {
    direction: 'short',
    qty: 1,
    avgPrice: 130,
    entryBar: 7,
    entryTime: 7_000,
    entryId: 'Open Short',
  },
};

describe('pineVela strategy mapping', () => {
  it('maps the broker ledger to Vela strategy state', () => {
    expect(strategyStateOf(result)).toEqual({
      position: -1,
      avgPrice: 130,
      equity: 1_015,
      openPnl: 3,
      netPnl: 15,
      grossProfit: 20,
      grossLoss: 5,
      wins: 1,
      losses: 1,
      even: 0,
      maxDrawdown: 9,
      maxRunup: 30,
      initialCapital: 1_000,
    });
  });

  it('lists closed round trips then the open one', () => {
    const trades = strategyTradesOf(result);
    expect(trades).toHaveLength(3);
    expect(trades[0]).toMatchObject({
      id: 'Long Exit',
      side: 'long',
      qty: 2,
      entry: { id: 'Long', time: 1_000, price: 100 },
      exit: { time: 3_000, price: 110 },
      open: false,
      pnl: 20,
    });
    expect(trades[2]).toMatchObject({
      id: 'open:7000:Open Short',
      side: 'short',
      open: true,
      entry: { id: 'Open Short', time: 7_000, price: 130 },
    });
    expect(trades[2]?.exit).toBeUndefined();
  });

  it('paints an entry and an exit marker for every round trip', () => {
    const fills = tradeExecutionsOf(result);
    expect(fills).toHaveLength(5);
    expect(fills[0]).toMatchObject({
      time: 1_000,
      price: 100,
      side: 'buy',
      kind: 'entry',
      label: 'Long',
      qty: 2,
      tradeId: 'Long Exit',
    });
    expect(fills[1]).toMatchObject({
      time: 3_000,
      price: 110,
      side: 'sell',
      kind: 'exit',
    });
    expect(fills[2]).toMatchObject({ side: 'sell', kind: 'entry' });
    expect(fills[3]).toMatchObject({ side: 'buy', kind: 'exit' });
    expect(fills[4]).toMatchObject({
      time: 7_000,
      kind: 'entry',
      tradeId: 'open:7000:Open Short',
    });
  });
});
