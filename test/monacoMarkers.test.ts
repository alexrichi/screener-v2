import { describe, expect, it } from 'vitest';
import { toPineMarkers } from '../src/lib/monaco/markers';

const finding = (overrides: Partial<Parameters<typeof toPineMarkers>[0][number]> = {}) => ({
  code: 'v6-when',
  line: 2,
  column: 4,
  length: 3,
  message: 'bad',
  severity: 'warning' as const,
  ...overrides,
});

describe('toPineMarkers', () => {
  it('converts a zero-based column to a one-based marker range', () => {
    expect(toPineMarkers([finding()], ['//@version=6', 'plot(close)'])).toEqual([
      {
        code: 'v6-when',
        severity: 'warning',
        message: 'bad',
        startLineNumber: 2,
        startColumn: 5,
        endLineNumber: 2,
        endColumn: 8,
      },
    ]);
  });

  it('clamps a stale line and column to the document', () => {
    const [marker] = toPineMarkers(
      [finding({ line: 99, column: 40, length: 10 })],
      ['plot(close)', ''],
    );
    expect(marker).toMatchObject({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 1,
    });
  });

  it('ignores an empty document', () => {
    expect(toPineMarkers([finding()], [])).toEqual([]);
  });
});
