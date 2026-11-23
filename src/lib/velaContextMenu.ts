import {
  registerIcon,
  registerWidgetAction,
  type ContextMenuPointer,
  type WidgetActionDescriptor,
  type WidgetContext,
} from '@luxalgo/vela/plugin';
import { formatPrice } from './format';

/**
 * The chart's right-click menu carries two app rows: copy the price under the
 * click and draw an hline there. Vela menu labels are static (`MessageLike`),
 * but `when(ctx)` runs at every menu build with the pointer captured at open,
 * so the label is rewritten there — the only live-price hook on Vela 0.10.x
 * without patching Vela. The rows sort with the built-ins by `order`; -25
 * lands them after `Reset chart view` (-30) and before the removals (-20).
 */
export interface ChartMenuBridge {
  /** Place a full-width hline at `price`; `time` only pins the drag handle.
   * Returns the host's error message, or null when the line was placed. */
  drawHLine(price: number, time: number): string | null;
}

/** Decimal places of the active chart's tick, matching the axis width. */
function tickDecimals(mintick: number | undefined): number {
  if (!mintick || !Number.isFinite(mintick) || mintick <= 0) return 2;
  const text = mintick.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(8, text.length - dot - 1);
}

let bridge: ChartMenuBridge | null = null;

/** App owns the active workspace handle; the menu rows only ask it to act. */
export function setChartMenuBridge(next: ChartMenuBridge | null): void {
  bridge = next;
}

/** Menu-price text, or null where the rows must hide: no bridge, a study pane
 * (its `price` is an indicator value, not a price) or an off-plot click. */
function priceText(ctx: WidgetContext): string | null {
  const pointer: ContextMenuPointer | undefined = ctx.pointer;
  if (!pointer || pointer.paneKind !== 'price') return null;
  const price = pointer.price;
  if (price == null || !Number.isFinite(price)) return null;
  const mintick = ctx.chart.symbolFacts()?.mintick;
  return formatPrice(price, tickDecimals(mintick));
}

function pointerTime(ctx: WidgetContext): number | null {
  const time = ctx.pointer?.time;
  return time != null && Number.isFinite(time) ? time : null;
}

/**
 * `navigator.clipboard` is permission-gated and rejects in embedders that
 * deny it; the `execCommand` fallback rides the still-live user gesture and
 * needs no permission, so a menu copy works in Electron and the browser alike.
 */
function copyText(text: string): Promise<void> {
  const viaApi = navigator.clipboard?.writeText?.(text);
  return viaApi ? viaApi.catch(() => fallbackCopy(text)) : fallbackCopy(text);
}

function fallbackCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) resolve();
    else reject(new Error('execCommand copy failed'));
  });
}

const copyItem: WidgetActionDescriptor = {
  id: 'screener-copy-price',
  target: 'context:body',
  label: 'Copy price',
  icon: 'screener-copy',
  order: -25,
  when(ctx) {
    const text = priceText(ctx);
    if (text === null) return false;
    copyItem.label = `Copy price ${text}`;
    return true;
  },
  run(ctx) {
    const text = priceText(ctx);
    if (text === null) return;
    void copyText(text.replace(/\u00a0/g, ' '))
      .then(() => ctx.toast(`Copied ${text}`, 'success'))
      .catch(() => ctx.toast(`Copy failed: ${text}`, 'error'));
  },
};

const drawItem: WidgetActionDescriptor = {
  id: 'screener-draw-hline',
  target: 'context:body',
  label: 'Draw horizontal line',
  icon: 'screener-hline',
  order: -25,
  // `validateDrawingRequest` rejects a point without a finite time, so the row
  // hides where the crosshair reports none (past the loaded bars).
  when(ctx) {
    const text = priceText(ctx);
    if (!bridge || text === null || pointerTime(ctx) === null) return false;
    drawItem.label = `Draw horizontal line at ${text}`;
    return true;
  },
  run(ctx) {
    const text = priceText(ctx);
    const time = pointerTime(ctx);
    if (text === null || time === null || !ctx.pointer) return;
    const error = bridge?.drawHLine(ctx.pointer.price!, time);
    if (error) ctx.toast(error, 'error');
  },
};

// Registration order breaks the -25 tie: Copy price leads, like the hosted chart.
registerWidgetAction(copyItem);
registerWidgetAction(drawItem);

registerIcon(
  'screener-hline',
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
);
registerIcon(
  'screener-copy',
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
);
