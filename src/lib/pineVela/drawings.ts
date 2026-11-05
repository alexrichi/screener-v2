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
 * Map the transpiler's drawing events onto Vela's drawing model. Argument order
 * follows the Pine call signature, so the indexes below are that signature.
 */
export function pineDrawings(
  instanceId: string,
  result: PineRunResult,
  bars: readonly { time: number }[],
): PineDrawings {
  const lines: DrawingLine[] = [];
  const boxes: DrawingBox[] = [];
  const labels: DrawingLabel[] = [];

  for (const event of result.visuals) {
    const args = event.args;
    switch (event.call) {
      case 'line.new': {
        const [x1, y1, x2, y2, xlocArg, extendArg, colorArg, styleArg, widthArg] = args;
        const left = price(x1);
        const top = price(y1);
        const right = price(x2);
        const bottom = price(y2);
        if (left === null || top === null || right === null || bottom === null) break;
        lines.push({
          id: `${instanceId}:line:${lines.length}`,
          paneId: '',
          xloc: xloc(xlocArg),
          x1: left,
          y1: top,
          x2: right,
          y2: bottom,
          extend: extend(extendArg),
          color: color(colorArg),
          invisible: false,
          width: price(widthArg) ?? 1,
          style: lineStyle(styleArg),
          arrowLeft: false,
          arrowRight: false,
        });
        break;
      }
      case 'box.new': {
        const [leftArg, topArg, rightArg, bottomArg, borderArg, widthArg, styleArg, extendArg, xlocArg, bgArg, textArg] =
          args;
        const left = price(leftArg);
        const top = price(topArg);
        const right = price(rightArg);
        const bottom = price(bottomArg);
        if (left === null || top === null || right === null || bottom === null) break;
        boxes.push({
          id: `${instanceId}:box:${boxes.length}`,
          paneId: '',
          xloc: xloc(xlocArg),
          left,
          top,
          right,
          bottom,
          extend: extend(extendArg),
          bgColor: color(bgArg),
          borderColor: color(borderArg),
          borderWidth: price(widthArg) ?? 1,
          borderStyle: lineStyle(styleArg),
          text: text(textArg),
          textSize: textSize(args[11]),
          hAlign: hAlign(args[13]),
          vAlign: vAlign(args[14]),
          wrap: args[15] === 'auto',
          fontFamily: args[17] === 'monospace' ? 'monospace' : 'default',
          bold: false,
          italic: false,
        });
        break;
      }
      case 'label.new': {
        const [xArg, yArg, textArg, xlocArg, ylocArg, colorArg, styleArg, textColorArg, sizeArg, alignArg, tooltipArg] =
          args;
        const x = price(xArg);
        const y = price(yArg);
        if (x === null) break;
        labels.push({
          id: `${instanceId}:label:${labels.length}`,
          paneId: '',
          xloc: xloc(xlocArg),
          x,
          y: y ?? 0,
          yloc: labelYLoc(ylocArg),
          text: text(textArg),
          style: labelStyle(styleArg),
          color: color(colorArg),
          textColor: color(textColorArg),
          size: textSize(sizeArg),
          textAlign: hAlign(alignArg),
          tooltip: text(tooltipArg),
          fontFamily: 'default',
          noFill: color(colorArg) === undefined,
        });
        break;
      }
      default:
        break;
    }
  }

  return { lines, boxes, labels, backgrounds: backgroundsOf(result, bars) };
}
