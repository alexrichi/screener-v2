import { inputDeltas, type IndicatorValue } from './indicatorState';

/** Values one indicator settings template stores. */
export interface IndicatorTemplatePayload {
  /** Input deltas against the script's declaration defaults. */
  inputs?: Record<string, IndicatorValue>;
  /** Declaration-prop overrides; absent keys mean the declaration value. */
  props?: Record<string, IndicatorValue>;
}

export interface IndicatorTemplateTarget {
  nativeType?: string;
  source?: string;
  title: string;
}

interface IndicatorSettingsHandle {
  inputs: readonly { key: string; defval: unknown }[];
  props: readonly { key: string; defval: unknown }[];
  inputValues(): Record<string, IndicatorValue>;
  propValues(): Record<string, IndicatorValue>;
  setInputs(values: Record<string, IndicatorValue>): void;
  setProps(values: Record<string, IndicatorValue>): void;
}

/** Stable target key: natives by type, scripts by source hash. */
export function templateKeyFor(target: IndicatorTemplateTarget): string {
  if (target.nativeType) return `native:${target.nativeType}`;
  if (target.source !== undefined) return `script:${hash(target.source)}`;
  return `title:${target.title.trim().toLowerCase()}`;
}

/** FNV-1a over the source; 132k chars hash in well under a millisecond. */
function hash(source: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function templateValuesOf(handle: {
  inputs: readonly { key: string; defval: unknown }[];
  inputValues(): Record<string, IndicatorValue>;
  propValues(): Record<string, IndicatorValue>;
}): IndicatorTemplatePayload {
  const inputs = inputDeltas(handle.inputs, handle.inputValues());
  const props = handle.propValues();
  return {
    ...(inputs ? { inputs } : {}),
    ...(Object.keys(props).length > 0 ? { props } : {}),
  };
}

function isValueBag(value: unknown): value is Record<string, IndicatorValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
  );
}

export function isIndicatorPayload(value: unknown): value is IndicatorTemplatePayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as IndicatorTemplatePayload;
  return (
    (payload.inputs === undefined || isValueBag(payload.inputs)) &&
    (payload.props === undefined || isValueBag(payload.props))
  );
}

/** The full value bags a template applies: declaration defaults overlaid by the template. */
export function defaultsOf(
  schema: readonly { key: string; defval: unknown }[],
): Record<string, IndicatorValue> {
  const values: Record<string, IndicatorValue> = {};
  for (const entry of schema) {
    const value = entry.defval;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[entry.key] = value;
    }
  }
  return values;
}

export function applyIndicatorPayload(
  handle: IndicatorSettingsHandle,
  payload: IndicatorTemplatePayload,
): void {
  handle.setInputs({ ...defaultsOf(handle.inputs), ...(payload.inputs ?? {}) });
  handle.setProps({ ...defaultsOf(handle.props), ...(payload.props ?? {}) });
}
