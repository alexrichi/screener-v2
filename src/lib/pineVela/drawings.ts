import type {
  Background,
  BoxHAlign,
  BoxTextSize,
  BoxVAlign,
  DrawingBox,
  DrawingLabel,
  DrawingLine,
  DrawingTable,
  LabelStyle,
  LabelYLoc,
  TablePosition,
} from '@luxalgo/vela/plugin';
import type { PineDrawings, PineRunResult, PineTable, PineTableCell } from '@screener/pine-engine';

type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface VelaDrawings {
  lines: DrawingLine[];
  boxes: DrawingBox[];
  labels: DrawingLabel[];
  backgrounds: Background[];
  tables: DrawingTable[];
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

const TABLE_POSITIONS = new Set<TablePosition>([
  'top_left', 'top_center', 'top_right',
  'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right',
]);

function tablePosition(value: string): TablePosition {
  return TABLE_POSITIONS.has(value as TablePosition) ? (value as TablePosition) : 'top_right';
}

function tableCellOf(cell: PineTableCell): DrawingTable['cells'][number][number] {
  return {
    text: cell.text || undefined,
    textColor: cell.textColor || undefined,
    bgColor: cell.backgroundColor || undefined,
    hAlign: hAlign(cell.hAlign),
    vAlign: vAlign(cell.vAlign),
    textSize: typeof cell.textSize === 'number' ? cell.textSize : textSize(cell.textSize),
    fontFamily: 'default',
    tooltip: cell.tooltip || undefined,
    bold: cell.bold,
    italic: cell.italic,
    width: cell.width,
    height: cell.height,
    merged: cell.merged === true,
  };
}

const LABEL_STYLES = new Set<LabelStyle>([
  'label_up', 'label_down', 'label_left', 'label_right', 'label_center',
  'label_lower_left', 'label_lower_right', 'label_upper_left', 'label_upper_right',
  'circle', 'square', 'diamond', 'flag', 'arrowup', 'arrowdown',
  'triangleup', 'triangledown', 'cross', 'xcross', 'text_outline', 'none',
]);

function shapeStyle(value: string): LabelStyle {
  const normalized = value === 'labelup' ? 'label_up' : value === 'labeldown' ? 'label_down' : value;
  return LABEL_STYLES.has(normalized as LabelStyle) ? (normalized as LabelStyle) : 'circle';
}

function shapeYLoc(value: string): LabelYLoc {
  if (value === 'abovebar') return 'abovebar';
  if (value === 'belowbar') return 'belowbar';
  if (value === 'top') return 'top';
  if (value === 'bottom') return 'bottom';
  return 'price';
}

function shapeLabels(instanceId: string, result: PineRunResult): DrawingLabel[] {
  return result.shapes.map((shape, index) => ({
    id: `${instanceId}:shape:${index}`,
    paneId: '',
    xloc: 'bar_time',
    x: shape.time,
    y: shape.value ?? 0,
    yloc: shapeYLoc(shape.location),
    text: shape.text || undefined,
    style: shapeStyle(shape.style),
    color: shape.color || undefined,
    textColor: shape.color || undefined,
    size: textSize(shape.size),
    textAlign: 'center',
    fontFamily: 'default' as const,
    noFill: !shape.color,
  }));
}

function tableOf(instanceId: string, table: PineTable): DrawingTable {
  return {
    id: `${instanceId}:table:${table.id}`,
    paneId: '',
    position: tablePosition(table.position),
    columns: table.columns,
    rows: table.rows,
    bgColor: table.backgroundColor || undefined,
    frameColor: table.frameColor || undefined,
    frameWidth: table.frameWidth,
    borderColor: table.borderColor || undefined,
    borderWidth: table.borderWidth,
    cells: table.cells.map((row) => row.map((cell) => (cell ? tableCellOf(cell) : null))),
    merges: table.merges.map((merge) => ({
      startCol: merge.startCol,
      startRow: merge.startRow,
      endCol: merge.endCol,
      endRow: merge.endRow,
    })),
  };
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
    labels: [
      ...drawings.labels.map((label): DrawingLabel => ({
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
      ...shapeLabels(instanceId, result),
    ],
    backgrounds: drawings.backgrounds.map((background, index) => ({
      id: `${instanceId}:bg:${index}`,
      paneId: '',
      from: background.from,
      to: background.to,
      color: background.color,
    })),
    tables: result.tables.map((table) => tableOf(instanceId, table)),
  };
}
