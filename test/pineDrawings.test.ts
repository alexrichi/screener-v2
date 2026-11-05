import { describe, expect, it } from 'vitest';
import { pineDrawings } from '../src/lib/pineVela/drawings';
import type { PineRunResult, PineVisualEvent } from '@screener/pine-engine';

const bars = Array.from({ length: 5 }, (_, index) => ({ time: 1_000 + index * 100 }));

function resultOf(visuals: PineVisualEvent[]): PineRunResult {
  return {
    ok: true,
    name: 'Test',
    overlay: true,
    plots: [],
    visuals,
    inputs: [],
    missingStd: [],
  };
}

describe('pineDrawings', () => {
  it('maps line.new with its style, color and width', () => {
    const drawings = pineDrawings(
      'inst',
      resultOf([
        {
          call: 'line.new',
          args: [1, 10, 3, 20, null, 'right', '#FF5252', 'dashed', 2],
          barIndex: 3,
        },
      ]),
      bars,
    );

    expect(drawings.lines).toHaveLength(1);
    expect(drawings.lines[0]).toMatchObject({
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

  it('maps box.new including fill, border and text', () => {
    const drawings = pineDrawings(
      'inst',
      resultOf([
        {
          call: 'box.new',
          args: [1, 20, 3, 10, '#2962FF', 1, 'solid', null, null, 'rgba(41, 98, 255, 0.2)', 'FVG'],
          barIndex: 3,
        },
      ]),
      bars,
    );

    expect(drawings.boxes[0]).toMatchObject({
      left: 1,
      top: 20,
      right: 3,
      bottom: 10,
      borderColor: '#2962FF',
      bgColor: 'rgba(41, 98, 255, 0.2)',
      text: 'FVG',
      borderWidth: 1,
    });
  });

  it('maps label.new with its style and text color', () => {
    const drawings = pineDrawings(
      'inst',
      resultOf([
        {
          call: 'label.new',
          args: [2, 15, 'HH', null, 'abovebar', '#4CAF50', 'label_down', '#FFFFFF', 'small'],
          barIndex: 2,
        },
      ]),
      bars,
    );

    expect(drawings.labels[0]).toMatchObject({
      x: 2,
      y: 15,
      yloc: 'abovebar',
      text: 'HH',
      style: 'label_down',
      color: '#4CAF50',
      textColor: '#FFFFFF',
      size: 'small',
    });
  });

  it('merges consecutive bgcolor bars into one span', () => {
    const drawings = pineDrawings(
      'inst',
      resultOf([
        { call: 'Std.bgcolor', args: ['rgba(76, 175, 80, 0.1)'], barIndex: 0 },
        { call: 'Std.bgcolor', args: ['rgba(76, 175, 80, 0.1)'], barIndex: 1 },
        { call: 'Std.bgcolor', args: ['rgba(242, 54, 69, 0.1)'], barIndex: 2 },
      ]),
      bars,
    );

    expect(drawings.backgrounds).toHaveLength(2);
    expect(drawings.backgrounds[0]).toMatchObject({ from: 1_000, to: 1_200 });
    expect(drawings.backgrounds[1]).toMatchObject({ from: 1_200, to: 1_300 });
  });

  it('drops a drawing whose coordinates are na', () => {
    const drawings = pineDrawings(
      'inst',
      resultOf([{ call: 'line.new', args: [null, 10, 3, 20], barIndex: 1 }]),
      bars,
    );
    expect(drawings.lines).toEqual([]);
  });
});
