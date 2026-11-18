import { describe, expect, it } from 'vitest';
import { validateDrawingRequest } from '../src/lib/ai/drawings';

describe('drawing requests', () => {
  it('accepts a valid trend line', () => {
    expect(
      validateDrawingRequest(
        {
          type: 'trendline',
          points: [
            { time: 1_700_000_000_000, price: 64_000 },
            { time: 1_700_003_600_000, price: 65_000 },
          ],
        },
        { min: 2, max: 2 },
      ),
    ).toBeNull();
  });

  it('rejects an unknown type', () => {
    expect(
      validateDrawingRequest({ type: 'not-a-drawing', points: [{ time: 1, price: 2 }] }, null),
    ).toBe('Unknown drawing type "not-a-drawing"');
  });

  it('rejects a wrong anchor count', () => {
    expect(
      validateDrawingRequest({ type: 'trendline', points: [{ time: 1, price: 2 }] }, { min: 2, max: 2 }),
    ).toBe('trendline needs 2 points, got 1');
    expect(
      validateDrawingRequest(
        { type: 'xabcd', points: Array.from({ length: 4 }, () => ({ time: 1, price: 2 })) },
        { min: 5, max: 5 },
      ),
    ).toBe('xabcd needs 5 points, got 4');
  });

  it('rejects non-finite coordinates', () => {
    expect(
      validateDrawingRequest(
        { type: 'hline', points: [{ time: Number.NaN, price: 2 }] },
        { min: 1, max: 1 },
      ),
    ).toBe('Each point needs a finite time (ms) and price');
  });
});
