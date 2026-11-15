import { describe, expect, it } from 'vitest';
import { DEFAULT_SCRIPT, PRESETS } from '../src/scripts/presets';
import { isDraftDirty, NEW_SCRIPT } from '../src/lib/pineDraft';

describe('Pine draft state', () => {
  it('marks a saved script dirty only when the source differs', () => {
    expect(isDraftDirty('plot(close)', 'plot(close)')).toBe(false);
    expect(isDraftDirty('plot(open)', 'plot(close)')).toBe(true);
  });

  it('keeps fresh templates clean', () => {
    expect(isDraftDirty(NEW_SCRIPT, null)).toBe(false);
    expect(isDraftDirty(DEFAULT_SCRIPT, null)).toBe(false);
    expect(isDraftDirty(PRESETS[1].source, null)).toBe(false);
  });

  it('treats CRLF and LF as the same source', () => {
    expect(isDraftDirty('a\r\nb', 'a\nb')).toBe(false);
    expect(isDraftDirty('a\nb', 'a\r\nb')).toBe(false);
    expect(isDraftDirty(NEW_SCRIPT.replace(/\n/g, '\r\n'), null)).toBe(false);
  });

  it('marks an edited or arbitrary unsaved buffer dirty', () => {
    expect(isDraftDirty(`${NEW_SCRIPT}// my edit`, null)).toBe(true);
    expect(isDraftDirty('//@version=6\nindicator("Custom")\nplot(close)', null)).toBe(true);
    expect(isDraftDirty('   ', null)).toBe(false);
  });
});
