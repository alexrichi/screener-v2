/** A cell's last zoom level: how many bars were on screen. */
export interface StoredScale {
  symbol: string;
  timeframe: string;
  bars: number;
}

export interface ScaleMarket {
  symbol: string;
  timeframe: string;
}

export interface ScaleRange {
  from: number;
  to: number;
}

export function isStoredScale(value: unknown): value is StoredScale {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Partial<StoredScale>;
  return (
    typeof item.symbol === 'string' &&
    typeof item.timeframe === 'string' &&
    typeof item.bars === 'number' &&
    Number.isFinite(item.bars) &&
    Number.isInteger(item.bars) &&
    item.bars >= 1
  );
}

/** Bars covered by a data-bounded range, both ends included. */
export function visibleBars(range: ScaleRange, barMs: number): number {
  if (!(barMs > 0)) return 0;
  return Math.max(1, Math.round((range.to - range.from) / barMs) + 1);
}

/**
 * The window that shows `bars` data bars ending at `last`, plus the chart's
 * configured right margin (in bars). The renderer's data-bounded visible range
 * never includes that whitespace, so it has to be added back on restore.
 */
export function scaledRange(
  last: number,
  bars: number,
  marginBars: number,
  barMs: number,
): ScaleRange {
  const margin = Number.isFinite(marginBars) && marginBars > 0 ? marginBars : 0;
  return {
    from: last - Math.max(0, bars - 1) * barMs,
    to: last + margin * barMs,
  };
}

/**
 * The scale payload to persist.
 *
 * A fresh range on a known market wins. A temporarily missing range keeps the
 * cached scale only while the chart still describes the same market: another
 * symbol or timeframe must not inherit the old zoom.
 */
export function scalePayload(
  cached: StoredScale | undefined,
  market: ScaleMarket | null,
  range: ScaleRange | null,
  barMs: number,
): StoredScale | undefined {
  if (market && range && barMs > 0) {
    return {
      symbol: market.symbol,
      timeframe: market.timeframe,
      bars: visibleBars(range, barMs),
    };
  }
  if (!market) return cached;
  if (!cached) return undefined;
  return cached.symbol === market.symbol && cached.timeframe === market.timeframe
    ? cached
    : undefined;
}
