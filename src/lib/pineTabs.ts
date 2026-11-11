import { DEFAULT_SCRIPT } from '../scripts/presets';

export interface PineTab {
  id: string;
  script: string;
  savedId: string;
}

export const PINE_TABS_KEY = 'screener.pine.tabs.v1';
export const PINE_ACTIVE_TAB_KEY = 'screener.pine.activeTab.v1';

export function newPineTabId(): string {
  return `pine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makePineTab(script: string, savedId = ''): PineTab {
  return { id: newPineTabId(), script, savedId };
}

export function isPineTabs(value: unknown): value is PineTab[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (tab) =>
        typeof tab === 'object' &&
        tab !== null &&
        typeof (tab as PineTab).id === 'string' &&
        (tab as PineTab).id.length > 0 &&
        typeof (tab as PineTab).script === 'string' &&
        typeof (tab as PineTab).savedId === 'string',
    )
  );
}

/** The old single-buffer keys become the first tab on first load. */
export function readLegacyPineTab(): PineTab {
  try {
    const rawScript = localStorage.getItem('screener.pine.script');
    const rawSavedId = localStorage.getItem('screener.pine.savedId');
    const script = rawScript ? JSON.parse(rawScript) : DEFAULT_SCRIPT;
    const savedId = rawSavedId ? JSON.parse(rawSavedId) : '';
    return {
      id: 'main',
      script: typeof script === 'string' ? script : DEFAULT_SCRIPT,
      savedId: typeof savedId === 'string' ? savedId : '',
    };
  } catch {
    return { id: 'main', script: DEFAULT_SCRIPT, savedId: '' };
  }
}
