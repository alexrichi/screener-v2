import { DEFAULT_SCRIPT, PRESETS } from '../scripts/presets';

export const NEW_SCRIPT = `//@version=6
indicator("My indicator")

plot(close)
`;

/** Template buffers are clean; an edited or arbitrary buffer is a user draft. */
const STARTERS = new Set<string>([NEW_SCRIPT, DEFAULT_SCRIPT, ...PRESETS.map((preset) => preset.source)]);

/**
 * A script is dirty when it differs from the saved item it came from. Without a
 * saved item, a fresh template is clean and anything else is an unsaved draft.
 */
export function isDraftDirty(script: string, savedSource: string | null): boolean {
  if (savedSource !== null) return savedSource !== script;
  return script.trim().length > 0 && !STARTERS.has(script);
}
