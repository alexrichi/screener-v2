import type {
  StrategyState,
  StrategyTrade,
  TradeExecution,
} from '@luxalgo/vela/plugin';
import type { StrategyResult } from '@screener/pine-engine';

/** The engine's broker ledger mapped to Vela's neutral strategy state. */
export function strategyStateOf(result: StrategyResult): StrategyState {
  const wins = result.trades.filter((trade) => trade.profit > 0).length;
  const losses = result.trades.filter((trade) => trade.profit < 0).length;
  return {
    position: result.position
      ? result.position.direction === 'long'
        ? result.position.qty
        : -result.position.qty
      : 0,
    avgPrice: result.position?.avgPrice ?? 0,
    equity: result.equity,
    openPnl: result.openPnl,
    netPnl: result.netProfit,
    grossProfit: result.grossProfit,
    grossLoss: result.grossLoss,
    wins,
    losses,
    even: result.trades.length - wins - losses,
    maxDrawdown: result.maxDrawdown,
    maxRunup: result.maxRunup,
    initialCapital: result.initialCapital,
  };
}

/**
 * A round trip's stable id. The engine's `ClosedTrade.id` is the exit ORDER id,
 * which repeats when the script reuses one `strategy.exit(...)` call: React keys
 * and marker trade ids need the entry/exit times to stay unique.
 */
function roundTripId(trade: StrategyResult['trades'][number]): string {
  return `${trade.id}:${trade.entryTime}:${trade.exitTime}`;
}

/** Round trips, closed then open, for the Strategy panel's ledger. */
export function strategyTradesOf(result: StrategyResult): StrategyTrade[] {
  const trades: StrategyTrade[] = result.trades.map((trade) => ({
    id: roundTripId(trade),
    side: trade.direction,
    qty: trade.qty,
    entry: {
      id: trade.entryId,
      time: trade.entryTime,
      price: trade.entryPrice,
    },
    exit: {
      id: trade.id,
      time: trade.exitTime,
      price: trade.exitPrice,
    },
    open: false,
    pnl: trade.profit,
  }));
  if (result.position) {
    trades.push({
      id: `open:${result.position.entryTime}:${result.position.entryId}`,
      side: result.position.direction,
      qty: result.position.qty,
      entry: {
        id: result.position.entryId,
        time: result.position.entryTime,
        price: result.position.avgPrice,
      },
      open: true,
    });
  }
  return trades;
}

/** Order fills painted as trade markers on the price pane. */
export function tradeExecutionsOf(result: StrategyResult): TradeExecution[] {
  const executions: TradeExecution[] = [];
  const fill = (
    time: number,
    price: number,
    side: 'buy' | 'sell',
    kind: 'entry' | 'exit',
    label: string,
    qty: number,
    tradeId: string,
  ): void => {
    executions.push({ time, price, side, kind, label, qty, tradeId });
  };

  for (const trade of result.trades) {
    const entrySide = trade.direction === 'long' ? 'buy' : 'sell';
    const exitSide = trade.direction === 'long' ? 'sell' : 'buy';
    const tradeId = roundTripId(trade);
    fill(trade.entryTime, trade.entryPrice, entrySide, 'entry', trade.entryId, trade.qty, tradeId);
    fill(trade.exitTime, trade.exitPrice, exitSide, 'exit', trade.id, trade.qty, tradeId);
  }
  const position = result.position;
  if (position) {
    const tradeId = `open:${position.entryTime}:${position.entryId}`;
    fill(
      position.entryTime,
      position.avgPrice,
      position.direction === 'long' ? 'buy' : 'sell',
      'entry',
      position.entryId,
      position.qty,
      tradeId,
    );
  }
  return executions;
}

