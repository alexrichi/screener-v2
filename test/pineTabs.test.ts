import { describe, expect, it } from 'vitest';
import {
  findPineTabBySavedId,
  findPineTabBySource,
  isPineTabs,
  makePineTab,
  planOpenSavedTab,
  removeSavedPineTabs,
} from '../src/lib/pineTabs';

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

  it('finds an open tab by saved id or by exact source', () => {
    const first = makePineTab('a', 'saved-1');
    const second = makePineTab('b');
    const tabs = [first, second];
    expect(findPineTabBySavedId(tabs, 'saved-1')).toBe(first);
    expect(findPineTabBySavedId(tabs, 'saved-2')).toBeUndefined();
    expect(findPineTabBySavedId(tabs, '')).toBeUndefined();
    expect(findPineTabBySource(tabs, 'b')).toBe(second);
    expect(findPineTabBySource(tabs, 'missing')).toBeUndefined();
  });

  it('opens a saved script in its tab, asks when dirty, or creates one', () => {
    const clean = makePineTab('a', 'saved-1');
    const dirty = makePineTab('a changed', 'saved-1');
    expect(planOpenSavedTab([clean], 'saved-1', 'a')).toEqual({
      kind: 'activate',
      tab: clean,
    });
    expect(planOpenSavedTab([dirty], 'saved-1', 'a')).toEqual({
      kind: 'prompt',
      tab: dirty,
    });
    expect(planOpenSavedTab([], 'saved-1', 'a')).toEqual({ kind: 'create' });
  });

  it('removes clean copies of a deleted script and keeps dirty ones as drafts', () => {
    const clean = makePineTab('a', 'saved-1');
    const dirty = makePineTab('a with edits', 'saved-1');
    const other = makePineTab('b', 'saved-2');
    const result = removeSavedPineTabs([clean, dirty, other], 'saved-1', 'a');
    expect(result.removed).toBe(1);
    expect(result.drafts).toBe(1);
    expect(result.tabs.map((tab) => tab.id)).toEqual([dirty.id, other.id]);
    expect(result.tabs[0]!.savedId).toBe('');
    expect(result.tabs[1]).toBe(other);
  });
});
