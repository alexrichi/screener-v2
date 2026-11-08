import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Activity, ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { formatPrice } from '../lib/format';
import {
  STRATEGY_DOCK_MAX,
  STRATEGY_DOCK_MIN,
  setStrategyDock,
  useStrategyDock,
} from '../lib/strategyDock';
import { cn } from '../lib/utils';
import {
  strategyRunsFor,
  subscribeStrategyRuns,
  type StrategyRunState,
} from '../lib/strategyRuns';
import { Modal } from '../ui/overlays';
import { Segmented } from '../ui/primitives';
import { StrategyEquity } from './StrategyEquity';

interface Props {
  /** Workspace tab whose strategies the dock shows. */
  tabId: string;
}

const COLLAPSED_HEIGHT = 36;

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

function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

function dateRange(run: StrategyRunState): string | null {
  const first = run.equityCurve[0]?.time;
  const last = run.equityCurve[run.equityCurve.length - 1]?.time;
  if (!first || !last) return null;
  return `${shortDay(first)} – ${shortDay(last)}`;
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

function runKey(run: StrategyRunState): string {
  return `${run.cellId}:${run.id}`;
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
    return <p className="py-10 text-center text-[11px] text-muted-foreground">No trades.</p>;
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
              <td className="px-2 py-1.5 font-mono tabular-nums text-muted-foreground">{index}</td>
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
  onOpenChange,
}: {
  run: StrategyRunState;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<'performance' | 'trades'>('performance');
  return (
    <Modal
      open
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

function DockMetrics({ run }: { run: StrategyRunState }) {
  const state = run.state;
  const decided = state.wins + state.losses + state.even;
  const winRate = winRateOf(state);
  const profitFactor = profitFactorOf(state);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
      <ViewerMetric
        label="Net Profit"
        value={signedMoney(state.netPnl)}
        tone={state.netPnl >= 0 ? 'up' : 'down'}
      />
      <ViewerMetric
        label="Trades"
        value={`${decided}${state.position !== 0 ? ' + open' : ''}`}
      />
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
  );
}

/** App-owned strategy dock under the chart: metrics, equity curve and viewer. */
export function StrategyPanel({ tabId }: Props) {
  const dock = useStrategyDock();
  const runs = useSyncExternalStore(
    subscribeStrategyRuns,
    () => strategyRunsFor(tabId),
    () => strategyRunsFor(tabId),
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const dragHeightRef = useRef<number | null>(null);
  const { height, collapsed } = dock;

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start) return;
      const next = Math.min(
        STRATEGY_DOCK_MAX,
        Math.max(STRATEGY_DOCK_MIN, start.startHeight + start.startY - event.clientY),
      );
      dragHeightRef.current = next;
      setDragHeight(next);
    };
    const finish = () => {
      setDragging(false);
      const next = dragHeightRef.current;
      dragHeightRef.current = null;
      drag.current = null;
      setDragHeight(null);
      if (next !== null) setStrategyDock({ height: next });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragging]);

  if (runs.length === 0) return null;

  const first = runs[0]!;
  const multiple = runs.length > 1;
  const net = multiple
    ? runs.reduce((sum, run) => sum + run.state.netPnl, 0)
    : first.state.netPnl;
  const title = multiple ? `${runs.length} strategies` : first.title;
  const range = multiple ? null : dateRange(first);
  const viewerRun = viewerKey
    ? (runs.find((run) => runKey(run) === viewerKey) ?? null)
    : null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    event.preventDefault();
    const startHeight = dragHeight ?? height;
    drag.current = { startY: event.clientY, startHeight };
    dragHeightRef.current = startHeight;
    setDragging(true);
  };

  return (
    <div
      data-strategy-dock={collapsed ? 'collapsed' : 'open'}
      className="flex shrink-0 flex-col border-t border-border bg-card"
      style={{ height: collapsed ? COLLAPSED_HEIGHT : (dragHeight ?? height) }}
    >
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize strategy panel"
          onPointerDown={onPointerDown}
          className={cn(
            'group flex h-2 shrink-0 cursor-row-resize touch-none items-start justify-center',
            dragging && 'bg-primary/10',
          )}
        >
          <div
            className={cn(
              'mt-0.5 h-1 w-8 rounded-full bg-border transition-colors group-hover:bg-primary',
              dragging && 'bg-primary',
            )}
          />
        </div>
      ) : null}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-foreground" title={title}>
              {title}
            </div>
            {range ? (
              <div className="truncate text-[10px] text-muted-foreground">{range}</div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              net >= 0 ? 'text-emerald-500' : 'text-red-500',
            )}
          >
            {signedMoney(net)}
          </span>
          {!multiple ? (
            <button
              type="button"
              aria-label="Open strategy viewer"
              title="Open strategy viewer"
              onClick={() => setViewerKey(runKey(first))}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Maximize2 className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={collapsed ? 'Expand strategy panel' : 'Collapse strategy panel'}
            title={collapsed ? 'Expand strategy panel' : 'Collapse strategy panel'}
            onClick={() => setStrategyDock({ collapsed: !collapsed })}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {multiple ? (
            runs.map((run) => (
              <div
                key={runKey(run)}
                className="border-b border-border/40 px-3 py-2 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span
                      className="truncate text-[12px] font-medium text-foreground"
                      title={run.title}
                    >
                      {run.title}
                    </span>
                    {dateRange(run) ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {dateRange(run)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span
                      className={cn(
                        'font-mono text-[11px] tabular-nums',
                        run.state.netPnl >= 0 ? 'text-emerald-500' : 'text-red-500',
                      )}
                    >
                      {signedMoney(run.state.netPnl)}
                    </span>
                    <button
                      type="button"
                      aria-label="Open strategy viewer"
                      title="Open strategy viewer"
                      onClick={() => setViewerKey(runKey(run))}
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Maximize2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5">
                  <DockMetrics run={run} />
                </div>
                {run.equityCurve.length > 1 ? (
                  <div className="mt-1">
                    <StrategyEquity
                      points={run.equityCurve}
                      initialCapital={run.state.initialCapital}
                      heightClass="h-20"
                    />
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="px-3 pb-2">
              <DockMetrics run={first} />
              {first.equityCurve.length > 1 ? (
                <div className="mt-1.5">
                  <StrategyEquity
                    points={first.equityCurve}
                    initialCapital={first.state.initialCapital}
                    heightClass="h-24"
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {viewerRun ? (
        <StrategyViewer
          run={viewerRun}
          onOpenChange={(open) => {
            if (!open) setViewerKey(null);
          }}
        />
      ) : null}
    </div>
  );
}
