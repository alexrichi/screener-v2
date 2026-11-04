import { describe, expect, it } from 'vitest';
import { inputDeltas, isStoredScripts } from '../src/lib/indicatorState';

const schema = [
  { key: 'length', defval: 14 },
  { key: 'source', defval: 'close' },
  { key: 'show', defval: true },
];

describe('inputDeltas', () => {
  it('writes nothing when every value is the declaration default', () => {
    expect(inputDeltas(schema, { length: 14, source: 'close', show: true })).toBeUndefined();
  });

  it('keeps only the edited keys', () => {
    expect(inputDeltas(schema, { length: 21, source: 'close', show: true })).toEqual({
      length: 21,
    });
  });

  it('keeps false and empty strings as real edits', () => {
    expect(inputDeltas(schema, { length: 14, source: '', show: false })).toEqual({
      source: '',
      show: false,
    });
  });

  it('ignores keys the schema does not declare', () => {
    expect(inputDeltas(schema, { length: 14, source: 'close', show: true, gone: 1 })).toBeUndefined();
  });
});

describe('isStoredScripts', () => {
  it('accepts the old source-only payload', () => {
    expect(isStoredScripts([{ id: 'saved-1', name: 'SMC', script: '//@version=6' }])).toBe(true);
  });

  it('accepts inputs, props and hidden', () => {
    expect(
      isStoredScripts([
        {
          id: 'saved-1',
          name: 'SMC',
          script: '//@version=6',
          inputs: { length: 21, show: false },
          props: { precision: 2 },
          hidden: true,
        },
      ]),
    ).toBe(true);
  });

  it('rejects values Vela cannot restore', () => {
    expect(
      isStoredScripts([{ id: 'saved-1', name: 'SMC', script: 'x', inputs: { length: null } }]),
    ).toBe(false);
    expect(
      isStoredScripts([{ id: 'saved-1', name: 'SMC', script: 'x', hidden: 'yes' }]),
    ).toBe(false);
    expect(isStoredScripts([{ id: 'saved-1', name: 'SMC' }])).toBe(false);
  });
});
