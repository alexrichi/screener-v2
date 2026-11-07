import { describe, expect, it } from 'vitest';
import { pineDrawings } from '../src/lib/pineVela/drawings';
import type { PineDrawings, PineRunResult, PineShapePoint, PineTable } from '@screener/pine-engine';

const EMPTY: PineDrawings = { lines: [], boxes: [], labels: [], backgrounds: [], linefills: [], polylines: [] };

function resultOf(
  drawings: Partial<PineDrawings>,
  tables: PineTable[] = [],
  shapes: PineShapePoint[] = [],
): PineRunResult {
  return {
    ok: true,
    name: 'Test',
    overlay: true,
    plots: [],
    drawings: { ...EMPTY, ...drawings },
    tables,
    shapes,
    candles: [],
    priceLines: [],
    fills: [],
    barColors: [],
    inputs: [],
    alerts: [],
    missingStd: [],
    warnings: [],
  };
}

describe('pineDrawings', () => {
  it('maps a line with its style, color and width', () => {
    const drawings = pineDrawings('inst', resultOf({
      lines: [
        {
          id: 7,
          x1: 1,
          y1: 10,
          x2: 3,
          y2: 20,
          xloc: 'bar_index',
          extend: 'right',
          color: '#FF5252',
          style: 'dashed',
          width: 2,
        },
      ],
    }));

    expect(drawings.lines).toHaveLength(1);
    expect(drawings.lines[0]).toMatchObject({
      id: 'inst:line:7',
      xloc: 'bar_index',
      x1: 1,
      y1: 10,
      x2: 3,
      y2: 20,
      extend: 'right',
      color: '#FF5252',
      width: 2,
      style: 'dashed',
    });
  });

  it('maps a box including fill, border and text', () => {
    const drawings = pineDrawings('inst', resultOf({
      boxes: [
        {
          id: 3,
          left: 1,
          top: 20,
          right: 8,
          bottom: 10,
          xloc: 'bar_index',
          extend: 'none',
          backgroundColor: 'rgba(41, 98, 255, 0.2)',
          borderColor: '#2962FF',
          borderWidth: 1,
          borderStyle: 'solid',
          text: 'FVG',
          textColor: '#FFFFFF',
          textSize: 'normal',
          hAlign: 'center',
          vAlign: 'center',
        },
      ],
    }));

    expect(drawings.boxes[0]).toMatchObject({
      id: 'inst:box:3',
      left: 1,
      top: 20,
      right: 8,
      bottom: 10,
      borderColor: '#2962FF',
      bgColor: 'rgba(41, 98, 255, 0.2)',
      text: 'FVG',
      borderWidth: 1,
    });
  });

  it('maps a label with its style and text color', () => {
    const drawings = pineDrawings('inst', resultOf({
      labels: [
        {
          id: 2,
          x: 2,
          y: 15,
          xloc: 'bar_index',
          yloc: 'abovebar',
          text: 'HH',
          tooltip: 'swing high',
          color: '#4CAF50',
          textColor: '#FFFFFF',
          style: 'label_down',
          size: 'small',
          textAlign: 'center',
        },
      ],
    }));

    expect(drawings.labels[0]).toMatchObject({
      id: 'inst:label:2',
      x: 2,
      y: 15,
      yloc: 'abovebar',
      text: 'HH',
      style: 'label_down',
      color: '#4CAF50',
      textColor: '#FFFFFF',
      size: 'small',
      tooltip: 'swing high',
    });
  });

  it('maps background spans', () => {
    const drawings = pineDrawings('inst', resultOf({
      backgrounds: [{ from: 1_000, to: 2_000, color: '#FF5252' }],
    }));

    expect(drawings.backgrounds).toEqual([
      { id: 'inst:bg:0', paneId: '', from: 1_000, to: 2_000, color: '#FF5252' },
    ]);
  });

  it('maps a table with cells and merges', () => {
    const drawings = pineDrawings('inst', resultOf({}, [
      {
        id: 4,
        position: 'top_right',
        columns: 2,
        rows: 2,
        backgroundColor: '#00000000',
        frameColor: '#787B86',
        frameWidth: 2,
        borderColor: '#FFFFFF',
        borderWidth: 1,
        cells: [
          [
            {
              text: 'A',
              textColor: '#FFFFFF',
              backgroundColor: '#00FF0044',
              textSize: 'small',
              hAlign: 'left',
              vAlign: 'top',
              tooltip: 'tip',
              bold: true,
              italic: false,
              width: 25,
              height: 10,
            },
            null,
          ],
          [null, null],
        ],
        merges: [{ startCol: 0, startRow: 1, endCol: 1, endRow: 1 }],
      },
    ]));

    expect(drawings.tables[0]).toMatchObject({
      id: 'inst:table:4',
      position: 'top_right',
      columns: 2,
      rows: 2,
      frameWidth: 2,
      borderWidth: 1,
      merges: [{ startCol: 0, startRow: 1, endCol: 1, endRow: 1 }],
    });
    expect(drawings.tables[0]!.cells[0]![0]).toMatchObject({
      text: 'A',
      textSize: 'small',
      hAlign: 'left',
      vAlign: 'top',
      bold: true,
      width: 25,
      height: 10,
    });
  });

  it('maps plotshape markers to labels', () => {
    const drawings = pineDrawings('inst', resultOf({}, [], [
      {
        group: 0,
        title: 'Buy',
        time: 1_000,
        value: 1,
        text: 'B',
        style: 'triangleup',
        location: 'belowbar',
        color: '#4CAF50',
        size: 'small',
      },
      {
        group: 1,
        title: 'Sell',
        time: 2_000,
        value: -1,
        style: 'arrowdown',
        location: 'abovebar',
        color: '#FF5252',
        size: 'normal',
      },
    ]));

    expect(drawings.labels).toHaveLength(2);
    expect(drawings.labels[0]).toMatchObject({
      id: 'inst:shape:0',
      xloc: 'bar_time',
      x: 1_000,
      yloc: 'belowbar',
      text: 'B',
      style: 'triangleup',
      color: '#4CAF50',
      size: 'small',
    });
    expect(drawings.labels[1]).toMatchObject({
      id: 'inst:shape:1',
      style: 'arrowdown',
      yloc: 'abovebar',
      color: '#FF5252',
    });
  });

  it('maps linefills and polylines', () => {
    const line = {
      id: 1,
      x1: 0,
      y1: 10,
      x2: 2,
      y2: 10,
      xloc: 'bar_index' as const,
      extend: 'none' as const,
      color: '#2962FF',
      style: 'solid' as const,
      width: 1,
    };
    const second = { ...line, id: 2, y1: 20, y2: 20 };
    const drawings = pineDrawings('inst', resultOf({
      linefills: [
        { id: 3, line1: line, line2: second, color: '#2962FF33' },
      ],
      polylines: [
        {
          id: 4,
          points: [{ xloc: 'bar_index', x: 0, price: 10 }, { xloc: 'bar_index', x: 2, price: 20 }],
          curved: false,
          closed: false,
          lineColor: '#FF5252',
          fillColor: '',
          lineWidth: 2,
          lineStyle: 'dashed',
        },
      ],
    }));

    expect(drawings.linefills[0]).toMatchObject({
      id: 'inst:linefill:3',
      color: '#2962FF33',
    });
    expect(drawings.linefills[0]!.line1.id).toBe('inst:line:1');
    expect(drawings.polylines[0]).toMatchObject({
      id: 'inst:polyline:4',
      lineColor: '#FF5252',
      lineWidth: 2,
      lineStyle: 'dashed',
    });
    expect(drawings.polylines[0]!.points).toHaveLength(2);
  });
});
