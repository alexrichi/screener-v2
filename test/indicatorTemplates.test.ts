import { describe, expect, it } from 'vitest';
import {
  applyIndicatorPayload,
  isIndicatorPayload,
  templateKeyFor,
  templateValuesOf,
} from '../src/lib/indicatorTemplates';

describe('indicator template helpers', () => {
  it('keys a native indicator by type and a script by its source', () => {
    expect(templateKeyFor({ nativeType: 'rsi', title: 'RSI' })).toBe('native:rsi');
    const first = templateKeyFor({ source: '//@version=6\nplot(close)', title: 'A' });
    const second = templateKeyFor({ source: '//@version=6\nplot(close)', title: 'B' });
    const other = templateKeyFor({ source: '//@version=6\nplot(open)', title: 'A' });
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first.startsWith('script:')).toBe(true);
  });

  it('saves only input deltas and the prop overrides', () => {
    const values = templateValuesOf({
      inputs: [
        { key: 'len', defval: 14 },
        { key: 'show', defval: true },
      ],
      inputValues: () => ({ len: 21, show: true }),
      propValues: () => ({ precision: 2 }),
    });
    expect(values).toEqual({ inputs: { len: 21 }, props: { precision: 2 } });
  });

  it('validates payloads before applying them', () => {
    expect(isIndicatorPayload({ inputs: { len: 21 }, props: { precision: 2 } })).toBe(true);
    expect(isIndicatorPayload({ inputs: { len: null } })).toBe(false);
    expect(isIndicatorPayload({ props: { precision: [] } })).toBe(false);
    expect(isIndicatorPayload(null)).toBe(false);
  });

  it('applies declaration defaults overlaid by the template', () => {
    const calls: unknown[] = [];
    applyIndicatorPayload(
      {
        inputs: [
          { key: 'len', defval: 14 },
          { key: 'show', defval: true },
        ],
        props: [{ key: 'precision', defval: 10 }],
        inputValues: () => ({ len: 14, show: true }),
        propValues: () => ({}),
        setInputs: (values) => calls.push(['inputs', values]),
        setProps: (values) => calls.push(['props', values]),
      },
      { inputs: { len: 21 }, props: { precision: 2 } },
    );
    expect(calls).toEqual([
      ['inputs', { len: 21, show: true }],
      ['props', { precision: 2 }],
    ]);
  });
});
