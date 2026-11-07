import { useMemo, useState, useSyncExternalStore } from 'react';
import { Activity, Maximize2 } from 'lucide-react';
import { formatPrice } from '../lib/format';
import { cn } from '../lib/utils';
import {
  strategyRunsFor,
  subscribeStrategyRuns,
  type StrategyRunState,
} from '../lib/strategyRuns';
import type { StrategyTrade } from '@luxalgo/vela/plugin';
import { Modal } from '../ui/overlays';
import { Segmented } from '../ui/primitives';
import { StrategyEquity } from './StrategyEquity';

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

function winRateOf(state: StrategyRunState['state']): number | null {
  const decided = state.wins + state.losses + state.even;
  return decided > 0 ? (state.wins / decided) * 100 : null;
}

function profitFactorOf(state: StrategyRunState['state']): number | null {
  return state.grossLoss > 0
    ? state.grossProfit / state.grossLoss
    : state.grossProfit > 0
      ? Number.POSITIVE_INFINITY
      : null;
}

function SideBadge({ side }: { side: 'long' | 'short' }) {
  return (
    <span
      className={cn(
        'rounded border px-1 text-[9px] font-semibold uppercase',
        side === 'long'
          ? 'border-emerald-500/40 text-emerald-500'
          : 'border-red-500/40 text-red-500',
      )}
    >
      {side}
    </span>
  );
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
        className={cn(
          'font-mono text-[11px] tabular-nums',
          tone === 'up'
            ? 'text-emerald-500'
            : tone === 'down'
              ? 'text-red-500'
              : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TradeRow({ trade }: { trade: StrategyTrade }) {
  return (
    <li className="px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <SideBadge side={trade.side} />
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
            className={cn(
              'font-mono text-[11px] tabular-nums',
              (trade.pnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500',
            )}
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

function ViewerMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-[14px] tabular-nums',
          tone === 'up'
            ? 'text-emerald-500'
            : tone === 'down'
              ? 'text-red-500'
              : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ViewerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Performance({ run }: { run: StrategyRunState }) {
  const state = run.state;
  const decided = state.wins + state.losses + state.even;
  const winRate = winRateOf(state);
  const profitFactor = profitFactorOf(state);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <ViewerMetric
          label="Net Profit"
          value={signedMoney(state.netPnl)}
          tone={state.netPnl >= 0 ? 'up' : 'down'}
        />
        <ViewerMetric label="Trades" value={`${decided}`} />
        <ViewerMetric label="Win Rate" value={winRate === null ? '—' : `${winRate.toFixed(2)}%`} />
        <ViewerMetric label="Max Drawdown" value={money(state.maxDrawdown)} tone="down" />
        <ViewerMetric
          label="Profit Factor"
          value={
            profitFactor === null
              ? '—'
              : Number.isFinite(profitFactor)
                ? profitFactor.toFixed(3)
                : '∞'
          }
          tone={profitFactor !== null && profitFactor >= 1 ? 'up' : 'down'}
        />
      </div>
      <div className="rounded-lg border border-border/60 p-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>Equity curve</span>
          <span>{run.trades.length} trades</span>
        </div>
        {run.equityCurve.length > 1 ? (
          <StrategyEquity
            points={run.equityCurve}
            initialCapital={state.initialCapital}
            heightClass="h-56"
          />
        ) : (
          <p className="py-6 text-center text-[11px] text-muted-foreground">No equity data.</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ViewerStat label="Initial capital" value={money(state.initialCapital)} />
        <ViewerStat label="Equity" value={money(state.equity)} />
        <ViewerStat label="Gross profit" value={signedMoney(state.grossProfit)} />
        <ViewerStat label="Gross loss" value={signedMoney(-state.grossLoss)} />
      </div>
    </div>
  );
}

function TradesLog({ run }: { run: StrategyRunState }) {
  const rows = useMemo(() => {
    let cumulative = 0;
    return [...run.trades]
      .sort((a, b) => a.entry.time - b.entry.time)
      .map((trade, index) => {
        if (!trade.open && trade.pnl != null) cumulative += trade.pnl;
        return { trade, index: index + 1, cumulative };
      });
  }, [run.trades]);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-[11px] text-muted-foreground">No trades.</p>
    );
  }

  return (
    <div className="max-h-[440px] overflow-y-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[660px] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 z-10 bg-card text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Side</th>
            <th className="px-2 py-1.5 font-medium">Entry</th>
            <th className="px-2 py-1.5 font-medium">Exit</th>
            <th className="px-2 py-1.5 text-right font-medium">Size</th>
            <th className="px-2 py-1.5 text-right font-medium">Net P&amp;L</th>
            <th className="px-2 py-1.5 text-right font-medium">Cumulative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ trade, index, cumulative }) => (
            <tr key={trade.id} className="border-t border-border/40">
              <td className="px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                {index}
              </td>
              <td className="px-2 py-1.5">
                <SideBadge side={trade.side} />
              </td>
              <td className="px-2 py-1.5">
                <div className="text-muted-foreground">{tradeTime(trade.entry.time)}</div>
                <div className="font-mono tabular-nums">{money(trade.entry.price)}</div>
              </td>
              <td className="px-2 py-1.5">
                {trade.exit ? (
                  <>
                    <div className="text-muted-foreground">{tradeTime(trade.exit.time)}</div>
                    <div className="font-mono tabular-nums">{money(trade.exit.price)}</div>
                  </>
                ) : (
                  <span className="rounded border border-border px-1 text-[9px] uppercase text-muted-foreground">
                    open
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{trade.qty}</td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right font-mono tabular-nums',
                  trade.open
                    ? 'text-muted-foreground'
                    : (trade.pnl ?? 0) >= 0
                      ? 'text-emerald-500'
                      : 'text-red-500',
                )}
              >
                {trade.open ? '—' : signedMoney(trade.pnl ?? 0)}
              </td>
              <td
                className={cn(
                  'px-2 py-1.5 text-right font-mono tabular-nums',
                  cumulative >= 0 ? 'text-emerald-500' : 'text-red-500',
                )}
              >
                {signedMoney(cumulative)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrategyViewer({
  run,
  open,
  onOpenChange,
}: {
  run: StrategyRunState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<'performance' | 'trades'>('performance');
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={run.title}
      description="Strategy backtest"
      className="w-[min(94vw,980px)]"
    >
      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={tab}
          options={[
            { value: 'performance', label: 'Performance' },
            { value: 'trades', label: 'Trades Log' },
          ]}
          onChange={setTab}
        />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {run.trades.length} trades
        </span>
      </div>
      <div className="mt-3">
        {tab === 'performance' ? <Performance run={run} /> : <TradesLog run={run} />}
      </div>
    </Modal>
  );
}

function StrategySection({ run }: { run: StrategyRunState }) {
  const state = run.state;
  const [viewerOpen, setViewerOpen] = useState(false);
  const decided = state.wins + state.losses + state.even;
  const winRate = winRateOf(state);
  const profitFactor = profitFactorOf(state);
  const position = state.position !== 0;
  const trades = [...run.trades].reverse().slice(0, TRADE_ROWS);

  return (
    <div className="border-b border-border/60">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="min-w-0 truncate text-[12px] font-medium text-foreground" title={run.title}>
          {run.title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              state.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500',
            )}
          >
            {signedMoney(state.netPnl)}
          </span>
          <button
            type="button"
            aria-label="Open strategy viewer"
            title="Open strategy viewer"
            onClick={() => setViewerOpen(true)}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="size-3.5" />
          </button>
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
      {run.equityCurve.length > 1 ? (
        <div className="border-t border-border/40 px-2 py-1.5">
          <StrategyEquity
            points={run.equityCurve}
            initialCapital={state.initialCapital}
          />
        </div>
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
      <StrategyViewer run={run} open={viewerOpen} onOpenChange={setViewerOpen} />
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
