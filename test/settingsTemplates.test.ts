import { describe, expect, it } from 'vitest';
import {
  createSettingsTemplateStore,
  migrateLegacyIndicatorTemplates,
} from '../src/lib/settingsTemplates';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('settings templates', () => {
  it('lists, saves, updates and removes templates per scope', () => {
    const store = createSettingsTemplateStore(fakeStorage());
    expect(store.list('indicator:abc')).toEqual([]);

    store.save('indicator:abc', 'Scalp', { inputs: { len: 21 } });
    store.save('indicator:abc', 'Swing', { inputs: { len: 50 } });
    expect(store.list('indicator:abc').map((item) => item.name)).toEqual(['Scalp', 'Swing']);
    expect(store.list('chart')).toEqual([]);

    const [first] = store.list('indicator:abc');
    expect(store.remove('indicator:abc', first!.id).map((item) => item.name)).toEqual(['Swing']);
  });

  it('updates a template saved under the same name', () => {
    const store = createSettingsTemplateStore(fakeStorage());
    const [created] = store.save('chart', 'Trend', { chart: 'line' });
    const [updated] = store.save('chart', 'trend', { chart: 'bars' });
    expect(store.list('chart')).toHaveLength(1);
    expect(updated!.id).toBe(created!.id);
    expect(updated!.payload).toEqual({ chart: 'bars' });
  });

  it('migrates the old indicator store into indicator scopes', () => {
    const storage = fakeStorage();
    storage.setItem(
      'screener.indicatorTemplates.v1',
      JSON.stringify({
        version: 1,
        items: {
          'script:abc': [
            { id: 'old', name: 'Probe', inputs: { len: 21 }, props: { precision: 2 }, updatedAt: 1 },
          ],
        },
      }),
    );
    const store = createSettingsTemplateStore(storage);
    migrateLegacyIndicatorTemplates(storage, store);
    expect(store.list('indicator:script:abc')[0]?.payload).toEqual({
      inputs: { len: 21 },
      props: { precision: 2 },
    });
    expect(storage.getItem('screener.indicatorTemplates.v1')).toBeNull();
  });

  it('survives a corrupt document and keeps saving', () => {
    const storage = fakeStorage();
    storage.setItem('screener.settingsTemplates.v1', '{not json');
    const store = createSettingsTemplateStore(storage);
    expect(store.list('chart')).toEqual([]);
    store.save('chart', 'Fresh', { ok: true });
    expect(store.list('chart').map((item) => item.name)).toEqual(['Fresh']);
  });
});
