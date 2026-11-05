import { describe, expect, it } from 'vitest';
import { pineDrawings } from '../src/lib/pineVela/drawings';
import type { PineDrawings, PineRunResult } from '@screener/pine-engine';

const EMPTY: PineDrawings = { lines: [], boxes: [], labels: [], backgrounds: [] };

function resultOf(drawings: Partial<PineDrawings>): PineRunResult {
  return {
    ok: true,
    name: 'Test',
    overlay: true,
    plots: [],
    drawings: { ...EMPTY, ...drawings },
    inputs: [],
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
});
