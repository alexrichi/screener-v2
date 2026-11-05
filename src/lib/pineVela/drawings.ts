import type {
  Background,
  BoxHAlign,
  BoxTextSize,
  BoxVAlign,
  DrawingBox,
  DrawingLabel,
  DrawingLine,
  LabelStyle,
  LabelYLoc,
} from '@luxalgo/vela/plugin';
import type { PineDrawings, PineRunResult } from '@screener/pine-engine';

type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface VelaDrawings {
  lines: DrawingLine[];
  boxes: DrawingBox[];
  labels: DrawingLabel[];
  backgrounds: Background[];
}

function textSize(value: string): BoxTextSize {
  if (value === 'auto' || value === 'tiny' || value === 'small' || value === 'large' || value === 'huge') {
    return value;
  }
  return 'normal';
}

function hAlign(value: string): BoxHAlign {
  return value === 'left' || value === 'right' ? value : 'center';
}

function vAlign(value: string): BoxVAlign {
  return value === 'top' || value === 'bottom' ? value : 'center';
}

function lineStyle(value: string): LineStyle {
  return value === 'dashed' || value === 'dotted' ? value : 'solid';
}

function labelStyle(value: string): LabelStyle {
  return value.length > 0 ? (value as LabelStyle) : 'label_center';
}

function labelYLoc(value: string): LabelYLoc {
  if (value === 'abovebar') return 'abovebar';
  if (value === 'belowbar') return 'belowbar';
  if (value === 'top') return 'top';
  if (value === 'bottom') return 'bottom';
  return 'price';
}

/** Map the engine's final drawing objects onto Vela's drawing model. */
export function pineDrawings(instanceId: string, result: PineRunResult): VelaDrawings {
  const drawings: PineDrawings = result.drawings;

  return {
    lines: drawings.lines.map((line) => ({
      id: `${instanceId}:line:${line.id}`,
      paneId: '',
      xloc: line.xloc,
      x1: line.x1,
      y1: line.y1,
      x2: line.x2,
      y2: line.y2,
      extend: line.extend,
      color: line.color || undefined,
      invisible: false,
      width: line.width,
      style: lineStyle(line.style),
      arrowLeft: line.arrowLeft === true,
      arrowRight: line.arrowRight === true,
    })),
    boxes: drawings.boxes.map((box) => ({
      id: `${instanceId}:box:${box.id}`,
      paneId: '',
      xloc: box.xloc,
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      extend: box.extend,
      bgColor: box.backgroundColor || undefined,
      borderColor: box.borderColor || undefined,
      borderWidth: box.borderWidth,
      borderStyle: lineStyle(box.borderStyle),
      text: box.text || undefined,
      textSize: textSize(box.textSize),
      hAlign: hAlign(box.hAlign),
      vAlign: vAlign(box.vAlign),
      wrap: false,
      fontFamily: 'default',
      bold: false,
      italic: false,
    })),
    labels: drawings.labels.map((label) => ({
      id: `${instanceId}:label:${label.id}`,
      paneId: '',
      xloc: label.xloc,
      x: label.x,
      y: label.y,
      yloc: labelYLoc(label.yloc),
      text: label.text || undefined,
      style: labelStyle(label.style),
      color: label.color || undefined,
      textColor: label.textColor || undefined,
      size: textSize(label.size),
      textAlign: hAlign(label.textAlign),
      tooltip: label.tooltip || undefined,
      fontFamily: 'default',
      noFill: label.color.length === 0,
    })),
    backgrounds: drawings.backgrounds.map((background, index) => ({
      id: `${instanceId}:bg:${index}`,
      paneId: '',
      from: background.from,
      to: background.to,
      color: background.color,
    })),
  };
}
