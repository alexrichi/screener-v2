import { DEFAULT_SCRIPT, PRESETS } from '../scripts/presets';
import { normalizePineSource } from './pineTabs';

export const NEW_SCRIPT = `//@version=6
indicator("My indicator")

plot(close)
`;

/** Template buffers are clean; an edited or arbitrary buffer is a user draft. */
const STARTERS = new Set<string>(
  [NEW_SCRIPT, DEFAULT_SCRIPT, ...PRESETS.map((preset) => preset.source)].map(
    normalizePineSource,
  ),
);

/**
 * A script is dirty when it differs from the saved item it came from. Without a
 * saved item, a fresh template is clean and anything else is an unsaved draft.
 */
export function isDraftDirty(script: string, savedSource: string | null): boolean {
  const normalized = normalizePineSource(script);
  if (savedSource !== null) return normalizePineSource(savedSource) !== normalized;
  return normalized.trim().length > 0 && !STARTERS.has(normalized);
}
