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

/**
 * Monaco stores LF line endings. Compare and persist the same form so a saved
 * CRLF script does not open as a dirty draft.
 */
export function normalizePineSource(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}

export function makePineTab(script: string, savedId = ''): PineTab {
  return { id: newPineTabId(), script: normalizePineSource(script), savedId };
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

/** The tab that owns a saved Library item, when it is already open. */
export function findPineTabBySavedId(
  tabs: readonly PineTab[],
  savedId: string,
): PineTab | undefined {
  if (!savedId) return undefined;
  return tabs.find((tab) => tab.savedId === savedId);
}

/** The tab that already holds exactly this source (a draft or an opened script). */
export function findPineTabBySource(
  tabs: readonly PineTab[],
  source: string,
): PineTab | undefined {
  const normalized = normalizePineSource(source);
  return tabs.find((tab) => normalizePineSource(tab.script) === normalized);
}

/** What an Open-saved-script request should do with the editor tabs. */
export type OpenSavedPlan =
  | { kind: 'activate'; tab: PineTab }
  | { kind: 'prompt'; tab: PineTab }
  | { kind: 'create' };

/** Reuse the item's tab; ask first when its buffer has unsaved edits. */
export function planOpenSavedTab(
  tabs: readonly PineTab[],
  savedId: string,
  source: string,
): OpenSavedPlan {
  const existing = findPineTabBySavedId(tabs, savedId);
  if (!existing) return { kind: 'create' };
  return normalizePineSource(existing.script) === normalizePineSource(source)
    ? { kind: 'activate', tab: existing }
    : { kind: 'prompt', tab: existing };
}

export interface RemovedSavedTabs {
  tabs: PineTab[];
  removed: number;
  drafts: number;
}

/**
 * Delete one saved script from the editor: clean copies disappear, dirty ones
 * stay as drafts so their unsaved code is not lost.
 */
export function removeSavedPineTabs(
  tabs: readonly PineTab[],
  savedId: string,
  source: string,
): RemovedSavedTabs {
  const normalized = normalizePineSource(source);
  const affected = tabs.filter((tab) => tab.savedId === savedId);
  const removed = affected.filter(
    (tab) => normalizePineSource(tab.script) === normalized,
  ).length;
  return {
    tabs: tabs
      .filter(
        (tab) =>
          tab.savedId !== savedId || normalizePineSource(tab.script) !== normalized,
      )
      .map((tab) => (tab.savedId === savedId ? { ...tab, savedId: '' } : tab)),
    removed,
    drafts: affected.length - removed,
  };
}

/** The old single-buffer keys become the first tab on first load. */
export function readLegacyPineTab(): PineTab {  try {
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
