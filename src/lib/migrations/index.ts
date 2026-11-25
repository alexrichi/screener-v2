import { migration as binanceSpot } from './1-binance-spot';
import type { Migration, MigrationReport, MigrationStorage } from './types';

export type { Migration, MigrationReport, MigrationStorage } from './types';

/** Integer schema revision; a store without the key is on revision 0. */
const SCHEMA_KEY = 'screener.schemaVersion';

/** Applied in order; each entry is one storage revision. */
const MIGRATIONS: readonly Migration[] = [binanceSpot];

function storageKeys(storage: MigrationStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * Every key and value as it was before a migration. localStorage has no
 * transactions, so a failing migration is rolled back from this copy.
 */
function snapshot(storage: MigrationStorage): Map<string, string> {
  const copy = new Map<string, string>();
  for (const key of storageKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) copy.set(key, value);
  }
  return copy;
}

function restore(storage: MigrationStorage, copy: Map<string, string>): void {
  for (const key of storageKeys(storage)) {
    if (!copy.has(key)) storage.removeItem(key);
  }
  for (const [key, value] of copy) storage.setItem(key, value);
}

function readSchema(storage: MigrationStorage): number {
  try {
    const raw = storage.getItem(SCHEMA_KEY)?.trim();
    return raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function writeSchema(storage: MigrationStorage, schema: number): void {
  storage.setItem(SCHEMA_KEY, String(schema));
}

/**
 * Bring stored app data up to the latest schema revision before React reads it.
 * Database-style: revisions run once, in order, each in its own rollback window,
 * and the revision is written after a step succeeds. Upgrade only — a stored
 * revision newer than this build is left untouched, and a failing step is rolled
 * back and retried on the next start.
 */
export function runMigrations(
  storage: MigrationStorage,
  options: { steps?: readonly Migration[] } = {},
): MigrationReport {
  const steps = [...(options.steps ?? MIGRATIONS)].sort(
    (left, right) => left.schema - right.schema,
  );
  const latest = steps.reduce((max, step) => Math.max(max, step.schema), 0);
  const from = readSchema(storage);
  if (from > latest) {
    console.warn(
      `[migrations] storage schema ${from} is newer than the app (${latest}); leaving it untouched`,
    );
    return { from, to: from, applied: [], status: 'newer' };
  }

  let to = from;
  const applied: number[] = [];
  for (const step of steps) {
    if (step.schema <= to) continue;
    let before: Map<string, string> | null = null;
    try {
      before = snapshot(storage);
      step.run(storage);
      to = step.schema;
      applied.push(to);
      writeSchema(storage, to);
    } catch (error) {
      if (before) {
        try {
          restore(storage, before);
        } catch {
          /* a failed restore leaves the app on its read-time defaults */
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[migrations] schema ${step.schema} failed`, error);
      return { from, to, applied, status: 'failed', error: message };
    }
  }

  return {
    from,
    to,
    applied,
    status: to > from ? 'upgraded' : 'current',
  };
}
