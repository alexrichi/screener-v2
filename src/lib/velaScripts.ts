import { registerStatePersistence } from '@luxalgo/vela/plugin';

/** The indicator id the tab's applied Pine script runs under (reapplied by the host). */
export const PINE_ID = 'screener-pine';

const KEY = 'screener.scripts';
const names = new Map<string, string>();

/** Remember the host-facing name for an external script id (the legend row). */
export function rememberScriptName(id: string, name: string): void {
  names.set(id, name);
}

interface StoredScript {
  id: string;
  name: string;
  script: string;
}

function isStoredScripts(value: unknown): value is StoredScript[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredScript).id === 'string' &&
        typeof (item as StoredScript).name === 'string' &&
        typeof (item as StoredScript).script === 'string',
    )
  );
}

/**
 * Vela does not persist external script indicators with the indicator ledger;
 * this cell-scope handler keeps every script except the tab's applied one
 * (which the host restores itself) inside the workspace document. Adding or
 * removing an indicator already triggers the save cycle.
 */
registerStatePersistence({
  key: KEY,
  scope: 'cell',
  serialize(ctx) {
    const scripts: StoredScript[] = [];
    for (const handle of ctx.chart.indicators()) {
      if (!handle.source || handle.id === PINE_ID) continue;
      scripts.push({
        id: handle.id,
        name: names.get(handle.id) ?? handle.title,
        script: handle.source,
      });
    }
    return scripts.length > 0 ? scripts : undefined;
  },
  restore(payload, ctx) {
    if (!isStoredScripts(payload)) return;
    for (const item of payload) {
      try {
        ctx.addIndicator({
          id: item.id,
          name: item.name,
          script: item.script,
          language: 'pine',
        });
      } catch (cause) {
        console.warn('[screener] could not restore an indicator', cause);
      }
    }
  },
});
