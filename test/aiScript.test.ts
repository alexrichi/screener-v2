import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/lib/ai/edits';
import { outlineScript } from '../src/lib/ai/scriptOutline';

describe('applyEdits', () => {
  it('applies ordered patches to the buffer', () => {
    const source = ['a = 1', 'b = 2', 'c = 3'].join('\n');
    const result = applyEdits(source, [
      { oldStr: 'b = 2', newStr: 'b = 20' },
      { oldStr: 'c = 3', newStr: 'c = b + 1' },
    ]);
    expect(result).toEqual({ ok: true, code: 'a = 1\nb = 20\nc = b + 1' });
  });

  it('fails when the anchor is missing', () => {
    const result = applyEdits('a = 1', [{ oldStr: 'b = 2', newStr: 'b = 3' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it('fails when the anchor is ambiguous', () => {
    const result = applyEdits('plot(close)\nplot(close)', [
      { oldStr: 'plot(close)', newStr: 'plot(open)' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not unique/i);
  });

  it('applies a later patch against the text produced by an earlier one', () => {
    const result = applyEdits('x = 1', [
      { oldStr: 'x = 1', newStr: 'x = 2' },
      { oldStr: 'x = 2', newStr: 'x = 3' },
    ]);
    expect(result).toEqual({ ok: true, code: 'x = 3' });
  });
});

describe('outlineScript', () => {
  const source = [
    '//@version=5',
    "indicator('SMC v1', overlay = true)",
    'type info',
    '    float top',
    'f_something(a) =>',
    '    a + 1',
    'var arr = array.new<info>(0)',
    'res = request.security(syminfo.tickerid, "15", close)',
    'plot(close)',
  ].join('\n');

  it('reports the line count and the constructs a debugger looks for', () => {
    const outline = outlineScript(source);
    expect(outline.lines).toBe(9);
    expect(outline.entries[0]).toMatchObject({ line: 1, kind: 'version' });
    expect(outline.entries.some((entry) => entry.kind === 'declaration')).toBe(true);
    expect(outline.entries.some((entry) => entry.kind === 'type')).toBe(true);
    expect(outline.entries.some((entry) => entry.kind === 'function')).toBe(true);
    expect(outline.entries.some((entry) => entry.kind === 'security')).toBe(true);
    expect(outline.entries.some((entry) => entry.kind === 'array')).toBe(true);
    // The AST adds calls the line patterns do not know about.
    expect(outline.entries.some((entry) => entry.kind === 'plot')).toBe(true);
  });

  it('uses the parser for multi-line declarations the line scanner misses', () => {
    const outline = outlineScript([
      '//@version=6',
      'indicator("x")',
      'f(',
      '  a,',
      '  b) =>',
      '    a + b',
    ].join('\n'));
    expect(outline.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 3, kind: 'function', name: 'f' }),
      ]),
    );
  });

  it('falls back to the line scanner while the source does not compile', () => {
    const outline = outlineScript('//@version=6\nindicator("x"\nplot(close)');
    expect(outline.entries.some((entry) => entry.kind === 'declaration')).toBe(true);
  });

  it('caps the outline and flags it', () => {
    const big = Array.from({ length: 500 }, (_, index) => `f${index}() => ${index}`).join('\n');
    const outline = outlineScript(big, 10);
    expect(outline.entries).toHaveLength(10);
    expect(outline.truncated).toBe(true);
  });
});
