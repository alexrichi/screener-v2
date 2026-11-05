import type {
  Background,
  BoxHAlign,
  BoxTextSize,
  BoxVAlign,
  DrawingBox,
  DrawingLabel,
  DrawingLine,
  DrawingXLoc,
  LabelStyle,
  LabelYLoc,
} from '@luxalgo/vela/plugin';
import type { PineRunResult, PineVisualEvent } from '@screener/pine-engine';

/** Vela's line styles; Pine's arrow variants fall back to a solid stroke. */
type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface PineDrawings {
  lines: DrawingLine[];
  boxes: DrawingBox[];
  labels: DrawingLabel[];
  backgrounds: Background[];
}

/** A Pine drawing handle: the transpiler keeps one per created object. */
interface Handle {
  __id: number;
  __deleted?: boolean;
  [field: string]: unknown;
}

const LINE_STYLES: Record<string, LineStyle> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
};

const TEXT_SIZES: Record<string, BoxTextSize> = {
  auto: 'auto',
  tiny: 'tiny',
  small: 'small',
  normal: 'normal',
  large: 'large',
  huge: 'huge',
};

const EXTENDS: Record<string, DrawingLine['extend']> = {
  none: 'none',
  left: 'left',
  right: 'right',
  both: 'both',
};

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function price(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function color(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function flag(value: unknown): boolean {
  return value === true;
}

function xloc(value: unknown): DrawingXLoc {
  return value === 'bar_time' ? 'bar_time' : 'bar_index';
}

function extend(value: unknown): DrawingLine['extend'] {
  return typeof value === 'string' ? EXTENDS[value] ?? 'none' : 'none';
}

function lineStyle(value: unknown): LineStyle {
  return typeof value === 'string' ? LINE_STYLES[value] ?? 'solid' : 'solid';
}

function textSize(value: unknown): BoxTextSize {
  return typeof value === 'string' ? TEXT_SIZES[value] ?? 'normal' : 'normal';
}

function hAlign(value: unknown): BoxHAlign {
  return value === 'left' || value === 'right' ? value : 'center';
}

function vAlign(value: unknown): BoxVAlign {
  return value === 'top' || value === 'bottom' ? value : 'center';
}

function labelStyle(value: unknown): LabelStyle {
  return typeof value === 'string' && value.length > 0 ? (value as LabelStyle) : 'label_center';
}

function labelYLoc(value: unknown): LabelYLoc {
  if (value === 'abovebar') return 'abovebar';
  if (value === 'belowbar') return 'belowbar';
  if (value === 'top') return 'top';
  if (value === 'bottom') return 'bottom';
  return 'price';
}

function isHandle(value: unknown): value is Handle {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { __id?: unknown }).__id === 'number'
  );
}

/**
 * Collect every drawing handle the run touched. The transpiler hands out one
 * object per created drawing and mutates it in place, and `set_*` events carry
 * that same object — so the handle already holds the final state of the object
 * after the last bar. Replaying setters would give the same answer for more
 * work, and would miss setters that fire without an event.
 */
function collectHandles(events: readonly PineVisualEvent[]): Map<number, Handle> {
  const handles = new Map<number, Handle>();
  for (const event of events) {
    for (const arg of event.args) {
      if (!isHandle(arg)) continue;
      handles.set(arg.__id, arg);
    }
  }
  return handles;
}

/**
 * `bgcolor()` fires once per bar. Consecutive bars sharing a color become one
 * span so the model carries ranges instead of one entry per candle.
 */
function backgroundsOf(result: PineRunResult, bars: readonly { time: number }[]): Background[] {
  const spans: Background[] = [];
  for (const event of result.visuals) {
    if (event.call !== 'Std.bgcolor' && event.call !== 'bgcolor') continue;
    const value = color(event.args[0]);
    if (!value) continue;
    const from = bars[event.barIndex]?.time;
    if (from === undefined) continue;
    const to = bars[event.barIndex + 1]?.time ?? from + 1;
    const last = spans[spans.length - 1];
    if (last && last.to === from && last.color === value) {
      last.to = to;
      continue;
    }
    spans.push({ id: `bg:${spans.length}`, paneId: '', from, to, color: value });
  }
  return spans;
}

/**
 * Map the transpiler's drawing events onto Vela's drawing model.
 *
 * A `new` event carries the creation arguments; later `set_*`/`delete` events
 * carry the live handle. The handle's current fields win, which is how a box
 * that `box.set_right` widened ends up at its final size instead of the size it
 * was created with.
 */
export function pineDrawings(
  instanceId: string,
  result: PineRunResult,
  bars: readonly { time: number }[],
): PineDrawings {
  const lines: DrawingLine[] = [];
  const boxes: DrawingBox[] = [];
  const labels: DrawingLabel[] = [];
  const handles = collectHandles(result.visuals);

  const created = (call: string) => result.visuals.filter((event) => event.call === call);

  for (const event of created('line.new')) {
    const handle = event.pineHandleId !== undefined ? handles.get(event.pineHandleId) : undefined;
    if (handle?.__deleted) continue;
    const args = event.args;
    const field = (index: number, name: string) => handle?.[name] ?? args[index];
    const x1 = price(field(0, 'x1'));
    const y1 = price(field(1, 'y1'));
    const x2 = price(field(2, 'x2'));
    const y2 = price(field(3, 'y2'));
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    const style = field(7, 'style');
    lines.push({
      id: `${instanceId}:line:${event.pineHandleId ?? lines.length}`,
      paneId: '',
      xloc: xloc(field(4, 'xloc')),
      x1,
      y1,
      x2,
      y2,
      extend: extend(field(5, 'extend')),
      color: color(field(6, 'color')),
      invisible: false,
      width: price(field(8, 'width')) ?? 1,
      style: lineStyle(style),
      arrowLeft: style === 'arrow_left' || style === 'arrow_both',
      arrowRight: style === 'arrow_right' || style === 'arrow_both',
    });
  }

  for (const event of created('box.new')) {
    const handle = event.pineHandleId !== undefined ? handles.get(event.pineHandleId) : undefined;
    if (handle?.__deleted) continue;
    const args = event.args;
    const field = (index: number, name: string) => handle?.[name] ?? args[index];
    const left = price(field(0, 'left'));
    const top = price(field(1, 'top'));
    const right = price(field(2, 'right'));
    const bottom = price(field(3, 'bottom'));
    if (left === null || top === null || right === null || bottom === null) continue;
    boxes.push({
      id: `${instanceId}:box:${event.pineHandleId ?? boxes.length}`,
      paneId: '',
      xloc: xloc(field(8, 'xloc')),
      left,
      top,
      right,
      bottom,
      extend: extend(field(7, 'extend')),
      bgColor: color(field(9, 'bgcolor')),
      borderColor: color(field(4, 'border_color')),
      borderWidth: price(field(5, 'border_width')) ?? 1,
      borderStyle: lineStyle(field(6, 'border_style')),
      text: text(field(10, 'text')),
      textSize: textSize(field(11, 'text_size')),
      hAlign: hAlign(field(13, 'text_halign')),
      vAlign: vAlign(field(14, 'text_valign')),
      wrap: field(15, 'text_wrap') === 'auto',
      fontFamily: field(17, 'text_font_family') === 'monospace' ? 'monospace' : 'default',
      bold: flag(field(18, 'text_formatting')),
      italic: false,
    });
  }

  for (const event of created('label.new')) {
    const handle = event.pineHandleId !== undefined ? handles.get(event.pineHandleId) : undefined;
    if (handle?.__deleted) continue;
    const args = event.args;
    const field = (index: number, name: string) => handle?.[name] ?? args[index];
    const x = price(field(0, 'x'));
    if (x === null) continue;
    labels.push({
      id: `${instanceId}:label:${event.pineHandleId ?? labels.length}`,
      paneId: '',
      xloc: xloc(field(3, 'xloc')),
      x,
      y: price(field(1, 'y')) ?? 0,
      yloc: labelYLoc(field(4, 'yloc')),
      text: text(field(2, 'text')),
      style: labelStyle(field(6, 'style')),
      color: color(field(5, 'color')),
      textColor: color(field(7, 'textcolor')),
      size: textSize(field(8, 'size')),
      textAlign: hAlign(field(9, 'textalign')),
      tooltip: text(field(10, 'tooltip')),
      fontFamily: 'default',
      noFill: color(field(5, 'color')) === undefined,
    });
  }

  return { lines, boxes, labels, backgrounds: backgroundsOf(result, bars) };
}
