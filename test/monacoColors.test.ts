import { describe, expect, it } from 'vitest';
import { expandHex } from '../src/lib/monaco/colors';

describe('expandHex', () => {
  it('expands the three- and four-digit forms Chromium returns', () => {
    expect(expandHex('#fff')).toBe('ffffff');
    expect(expandHex('fff')).toBe('ffffff');
    expect(expandHex('#abcd')).toBe('aabbccdd');
  });

  it('keeps six- and eight-digit hex', () => {
    expect(expandHex('#0f172a')).toBe('0f172a');
    expect(expandHex('#0f172a09')).toBe('0f172a09');
  });

  it('leaves non-hex colors untouched', () => {
    expect(expandHex('rgba(70, 95, 255, 0.28)')).toBe('rgba(70, 95, 255, 0.28)');
  });
});
