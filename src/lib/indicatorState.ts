/** Primitive input/prop values Vela accepts in an external indicator entry. */
export type IndicatorValue = string | number | boolean;

export interface StoredScript {
  id: string;
  name: string;
  script: string;
  /** Input values that differ from the script's declaration defaults. */
  inputs?: Record<string, IndicatorValue>;
  /** Declaration-prop overrides; Vela keeps no defaults here. */
  props?: Record<string, IndicatorValue>;
  /** Suspended on restore: the legend row stays, the engine does not run. */
  hidden?: boolean;
}

/**
 * Deltas of a value bag against its schema's declaration defaults. Vela stores
 * the same shape for manifest indicators; a default that changes in the script
 * must not stay frozen in every saved document. Structural compare by JSON.
 */
export function inputDeltas(
  schema: readonly { key: string; defval: unknown }[],
  values: Record<string, IndicatorValue>,
): Record<string, IndicatorValue> | undefined {
  const out: Record<string, IndicatorValue> = {};
  for (const entry of schema) {
    const value = values[entry.key];
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(entry.defval)) {
      out[entry.key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isValueBag(value: unknown): value is Record<string, IndicatorValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
  );
}

export function isStoredScripts(value: unknown): value is StoredScript[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const script = item as StoredScript;
      return (
        typeof script.id === 'string' &&
        typeof script.name === 'string' &&
        typeof script.script === 'string' &&
        (script.inputs === undefined || isValueBag(script.inputs)) &&
        (script.props === undefined || isValueBag(script.props)) &&
        (script.hidden === undefined || typeof script.hidden === 'boolean')
      );
    })
  );
}
