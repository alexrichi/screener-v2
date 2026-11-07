import type { Vela } from '@luxalgo/vela';
import { registerStatePersistence } from '@luxalgo/vela/plugin';
import {
  isStoredScale,
  scaledRange,
  scalePayload,
  type ScaleMarket,
  type ScaleRange,
  type StoredScale,
} from './scaleState';
import { timeframeMs } from './timeframe';

const KEY = 'screener.scale';
/** A document applied before its market loads gets this long to paint. */
const RESTORE_WAIT_MS = 30_000;

function marketOf(chart: Vela): ScaleMarket | null {
  try {
    const market = chart.market;
    if (!market.symbol || !market.timeframe) return null;
    return { symbol: market.symbol, timeframe: market.timeframe };
  } catch {
    return null;
  }
}

function rangeOf(chart: Vela): ScaleRange | null {
  try {
    const range = chart.getVisibleRange();
    return range ? { from: range.from, to: range.to } : null;
  } catch {
    return null;
  }
}

function barMsOf(market: ScaleMarket): number {
  try {
    return timeframeMs(market.timeframe);
  } catch {
    return 0;
  }
}

/** The chart's configured right margin, in bars (Settings → Margins → Right). */
function rightMarginOf(chart: Vela): number {
  try {
    const config = chart.renderer.getConfig() as { margins?: { right?: unknown } } | null;
    const right = config?.margins?.right;
    return typeof right === 'number' && Number.isFinite(right) && right > 0
      ? Math.min(200, Math.round(right))
      : 0;
  } catch {
    return 0;
  }
}

/** The last valid zoom per chart, so a transient null range cannot erase it. */
const lastScales = new WeakMap<Vela, StoredScale>();
/** Charts whose saved zoom is still being restored; their live fit must not win. */
const restoring = new WeakSet<Vela>();

/** The cell host, so a chart gesture cancels the restore without catching the table. */
function cellHostOf(cellId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return (
    [...document.querySelectorAll<HTMLElement>('[data-cell-id]')].find(
      (element) => element.dataset.cellId === cellId,
    ) ?? null
  );
}

/**
 * Apply the saved zoom once the cell shows the same market and has painted
 * bars. Only the bar count is restored: the window is anchored to the newest
 * bar, so a reload opens at the current time at the same zoom. The load and
 * backfill events both retry; a chart gesture cancels the deferred retry.
 */
function restoreScale(chart: Vela, stored: StoredScale, cellId: string): void {
  let offs: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pressed = false;
  let cancelled = false;
  const host = cellHostOf(cellId);

  const onPointerDown = (): void => {
    pressed = true;
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (pressed && event.buttons !== 0) cancel();
  };
  const onPointerUp = (): void => {
    pressed = false;
  };

  const cleanup = (): void => {
    restoring.delete(chart);
    for (const off of offs) off();
    offs = [];
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (host) {
      host.removeEventListener('wheel', cancel, { capture: true });
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('pointermove', onPointerMove, true);
      host.removeEventListener('pointerup', onPointerUp, true);
      host.removeEventListener('pointercancel', onPointerUp, true);
    }
  };

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    cleanup();
  };

  const apply = (): boolean => {
    if (cancelled) return true;
    const market = marketOf(chart);
    if (!market || market.symbol !== stored.symbol || market.timeframe !== stored.timeframe) {
      return false;
    }
    const range = rangeOf(chart);
    if (!range) return false;
    const barMs = barMsOf(market);
    if (!(barMs > 0) || stored.bars < 2) return false;
    let last = range.to;
    try {
      last = chart.replay.bounds?.last ?? range.to;
    } catch {
      last = range.to;
    }
    try {
      chart.setVisibleRange(scaledRange(last, stored.bars, rightMarginOf(chart), barMs));
    } catch {
      return false;
    }
    return true;
  };

  if (host) {
    host.addEventListener('wheel', cancel, { capture: true, passive: true });
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('pointermove', onPointerMove, true);
    host.addEventListener('pointerup', onPointerUp, true);
    host.addEventListener('pointercancel', onPointerUp, true);
  }
  offs = [
    chart.on('load:end', () => void apply()),
    chart.on('history:complete', ({ reason }) => {
      if (reason !== 'aborted' && apply()) cleanup();
    }),
  ];
  timer = setTimeout(cleanup, RESTORE_WAIT_MS);
  apply();
}

registerStatePersistence({
  key: KEY,
  scope: 'cell',
  serialize(ctx) {
    const cached = lastScales.get(ctx.chart);
    // The saved zoom must survive the initial fit and any save during the restore.
    if (restoring.has(ctx.chart)) return cached;
    const market = marketOf(ctx.chart);
    const payload = scalePayload(
      cached,
      market,
      rangeOf(ctx.chart),
      market ? barMsOf(market) : 0,
    );
    if (payload) lastScales.set(ctx.chart, payload);
    else lastScales.delete(ctx.chart);
    return payload;
  },
  restore(payload, ctx) {
    if (!isStoredScale(payload)) return;
    lastScales.set(ctx.chart, payload);
    restoring.add(ctx.chart);
    restoreScale(ctx.chart, payload, ctx.cellId);
  },
});
