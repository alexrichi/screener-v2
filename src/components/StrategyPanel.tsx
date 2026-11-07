import { useSyncExternalStore } from 'react';
import { Activity } from 'lucide-react';
import { formatPrice } from '../lib/format';
import {
  strategyRunsFor,
  subscribeStrategyRuns,
  type StrategyRunState,
} from '../lib/strategyRuns';
import type { StrategyTrade } from '@luxalgo/vela/plugin';

interface Props {
  /** Workspace tab whose strategies the panel shows. */
  tabId: string;
}

const TRADE_ROWS = 30;

function money(value: number): string {
  return formatPrice(value, 2);
}

function signedMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${money(value)}`;
}

function tradeTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Value({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-[3px]">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-[11px] tabular-nums ${
          tone === 'up'
            ? 'text-emerald-500'
            : tone === 'down'
              ? 'text-red-500'
              : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function TradeRow({ trade }: { trade: StrategyTrade }) {
  const long = trade.side === 'long';
  return (
    <li className="px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span
            className={`rounded border px-1 text-[9px] font-semibold uppercase ${
              long
                ? 'border-emerald-500/40 text-emerald-500'
                : 'border-red-500/40 text-red-500'
            }`}
          >
            {trade.side}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {trade.qty} @ {money(trade.entry.price)}
          </span>
        </span>
        {trade.open ? (
          <span className="rounded border border-border px-1 text-[9px] uppercase text-muted-foreground">
            open
          </span>
        ) : (
          <span
            className={`font-mono text-[11px] tabular-nums ${
              (trade.pnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {signedMoney(trade.pnl ?? 0)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{tradeTime(trade.entry.time)}</span>
        {trade.exit ? <span>exit {money(trade.exit.price)}</span> : null}
      </div>
    </li>
  );
}

function StrategySection({ run }: { run: StrategyRunState }) {
  const state = run.state;
  const decided = state.wins + state.losses + state.even;
  const winRate = decided > 0 ? (state.wins / decided) * 100 : null;
  const profitFactor =
    state.grossLoss > 0
      ? state.grossProfit / state.grossLoss
      : state.grossProfit > 0
        ? Number.POSITIVE_INFINITY
        : null;
  const position = state.position !== 0;
  const trades = [...run.trades].reverse().slice(0, TRADE_ROWS);

  return (
    <div className="border-b border-border/60">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="min-w-0 truncate text-[12px] font-medium text-foreground" title={run.title}>
          {run.title}
        </span>
        <span
          className={`shrink-0 font-mono text-[11px] tabular-nums ${
            state.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500'
          }`}
        >
          {signedMoney(state.netPnl)}
        </span>
      </div>
      <Value label="Equity" value={money(state.equity)} />
      <Value
        label="Win rate"
        value={winRate === null ? '—' : `${winRate.toFixed(1)}%`}
      />
      <Value
        label="Trades"
        value={`${decided}${position ? ' + open' : ''}`}
      />
      <Value
        label="Profit factor"
        value={
          profitFactor === null
            ? '—'
            : Number.isFinite(profitFactor)
              ? profitFactor.toFixed(2)
              : '∞'
        }
        tone={profitFactor !== null && profitFactor >= 1 ? 'up' : 'down'}
      />
      <Value label="Max drawdown" value={money(state.maxDrawdown)} tone="down" />
      {position ? (
        <Value
          label="Position"
          value={`${state.position > 0 ? 'long' : 'short'} ${Math.abs(state.position)} @ ${money(state.avgPrice)}`}
          tone={state.openPnl >= 0 ? 'up' : 'down'}
        />
      ) : null}
      {trades.length > 0 ? (
        <ul className="divide-y divide-border/40 border-t border-border/40">
          {trades.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </ul>
      ) : (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">
          {run.tradesLoaded ? 'No closed trades.' : 'Loading trades…'}
        </p>
      )}
      {run.trades.length > TRADE_ROWS ? (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          Latest {TRADE_ROWS} of {run.trades.length} trades.
        </p>
      ) : null}
    </div>
  );
}

/** Backtest summary and trade ledger for the tab's strategy scripts. */
export function StrategyPanel({ tabId }: Props) {
  const runs = useSyncExternalStore(
    subscribeStrategyRuns,
    () => strategyRunsFor(tabId),
    () => strategyRunsFor(tabId),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Activity className="size-6 opacity-40" />
            <p className="text-[12px]">
              No strategy on this chart. Apply a script with `strategy()` in Pine.
            </p>
          </div>
        ) : (
          runs.map((run) => <StrategySection key={`${run.cellId}:${run.id}`} run={run} />)
        )}
      </div>
    </div>
  );
}
