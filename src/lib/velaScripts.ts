import { registerStatePersistence } from '@luxalgo/vela/plugin';
import { inputDeltas, isStoredScripts, type StoredScript } from './indicatorState';

/** The indicator id the tab's applied Pine script runs under (reapplied by the host). */
export const PINE_ID = 'screener-pine';

const KEY = 'screener.scripts';
const names = new Map<string, string>();

/** Remember the host-facing name for an external script id (the legend row). */
export function rememberScriptName(id: string, name: string): void {
  names.set(id, name);
}

/**
 * Vela does not persist external script indicators with the indicator ledger;
 * this cell-scope handler keeps every script except the tab's applied one
 * (which the host restores itself) inside the workspace document. Inputs,
 * props and the hidden flag ride along: without them a custom indicator comes
 * back with declaration defaults after every reload.
 */
registerStatePersistence({
  key: KEY,
  scope: 'cell',
  serialize(ctx) {
    const scripts: StoredScript[] = [];
    for (const handle of ctx.chart.indicators()) {
      if (!handle.source || handle.id === PINE_ID) continue;
      const inputs = inputDeltas(handle.inputs, handle.inputValues());
      const props = handle.propValues();
      scripts.push({
        id: handle.id,
        name: names.get(handle.id) ?? handle.title,
        script: handle.source,
        ...(inputs ? { inputs } : {}),
        ...(Object.keys(props).length > 0 ? { props } : {}),
        ...(handle.visible ? {} : { hidden: true }),
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
          ...(item.inputs ? { inputs: item.inputs } : {}),
          ...(item.props ? { props: item.props } : {}),
          ...(item.hidden ? { hidden: true } : {}),
        });
      } catch (cause) {
        console.warn('[screener] could not restore an indicator', cause);
      }
    }
  },
});
