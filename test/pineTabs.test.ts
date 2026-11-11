import { describe, expect, it } from 'vitest';
import { isPineTabs, makePineTab } from '../src/lib/pineTabs';

describe('Pine editor tabs', () => {
  it('accepts a valid tab list and rejects malformed entries', () => {
    expect(isPineTabs([makePineTab('plot(close)')])).toBe(true);
    expect(isPineTabs([])).toBe(false);
    expect(isPineTabs([{ id: '', script: 'x', savedId: '' }])).toBe(false);
    expect(isPineTabs([{ id: 'a', script: 1, savedId: '' }])).toBe(false);
    expect(isPineTabs([{ id: 'a', script: 'x', savedId: 1 }])).toBe(false);
  });

  it('creates independent ids and keeps the saved id', () => {
    const first = makePineTab('a', 'saved-1');
    const second = makePineTab('b');
    expect(first.id).not.toBe(second.id);
    expect(first.savedId).toBe('saved-1');
    expect(second.savedId).toBe('');
  });
});
