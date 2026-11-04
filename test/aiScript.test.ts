import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/lib/ai/edits';
import { outlineScript } from '../src/lib/ai/scriptOutline';
import { toolView } from '../src/lib/ai/toolView';

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

describe('toolView', () => {
  const liveFailure = {
    ok: false,
    error: "Cannot read properties of undefined (reading '2883')",
    errorName: 'TypeError',
    method: null,
    stack: 'TypeError: ...\n    at jit (pineToJS)',
    warnings: [],
    plots: {},
    vars: {},
    bars: 500,
    maxBarsBack: 500,
    symbol: 'BINANCE:BTCUSDT.P',
    timeframe: '15',
    logs: [],
  };
  const workerSuccess = {
    ok: true,
    error: null,
    errorName: null,
    method: null,
    stack: null,
    warnings: [],
    plots: { A: 1, B: 2 },
    vars: { count: '3' },
    bars: 500,
    maxBarsBack: 500,
    symbol: 'BINANCE:BTCUSDT.P',
    timeframe: '15',
    logs: ['[2026-11-03T18:00:00.000Z] probe 2883'],
  };

  it('opens a failed live run but still shows the full worker result', () => {
    const view = toolView({
      name: 'run_script',
      state: 'output-available',
      output: { ok: false, live: liveFailure, worker: workerSuccess },
    });
    expect(view.status).toBe('error');
    expect(view.defaultOpen).toBe(true);
    expect(view.summary).toContain('live failed');
    expect(view.summary).toContain('worker ok');
    expect(view.sections.map((section) => section.label)).toEqual(
      expect.arrayContaining(['Live error', 'Live stack', 'Live context']),
    );
    expect(view.sections.find((section) => section.label === 'Live context')?.text).toContain(
      '500 bars',
    );
    expect(view.sections.find((section) => section.label === 'Worker logs')?.text).toContain(
      'probe 2883',
    );
    expect(view.sections.find((section) => section.label === 'Worker plots')?.text).toContain(
      'A = 1',
    );
  });

  it('keeps a matching two-run result compact and lists both contexts', () => {
    const view = toolView({
      name: 'run_script',
      state: 'output-available',
      output: {
        ok: true,
        live: { ...workerSuccess, ok: true, logs: [] },
        worker: workerSuccess,
      },
    });
    expect(view.status).toBe('ok');
    expect(view.defaultOpen).toBe(false);
    expect(view.summary).toContain('live ok');
    expect(view.summary).toContain('worker ok');
    expect(view.sections.find((section) => section.label === 'Live plots')?.text).toContain('A = 1');
    expect(view.sections.find((section) => section.label === 'Worker plots')?.text).toContain('A = 1');
  });

  it('shows an outline instead of the source for a truncated script', () => {
    const view = toolView({
      name: 'get_script',
      state: 'output-available',
      output: {
        chars: 126_111,
        lines: 2001,
        truncated: true,
        source: null,
        outline: [{ line: 12, kind: 'type', text: 'type info' }],
      },
    });
    expect(view.summary).toContain('outline');
    expect(view.sections.some((section) => section.label === 'Source')).toBe(false);
    expect(view.sections.find((section) => section.label === 'Outline')?.text).toContain('L12');
  });

  it('turns a rejected patch into an open error card', () => {
    const view = toolView({
      name: 'edit_code',
      state: 'output-available',
      input: { summary: 'fix', edits: [{ oldStr: 'a', newStr: 'b' }] },
      output: { applied: false, reason: 'Edit #1: oldStr was not found.' },
    });
    expect(view.status).toBe('error');
    expect(view.defaultOpen).toBe(true);
    expect(view.summary).toContain('Rejected');
  });

  it('summarizes a line read', () => {
    const view = toolView({
      name: 'read_lines',
      state: 'output-available',
      input: { from: 1, to: 5 },
      output: { from: 1, to: 5, total: 2001, text: 'a\nb' },
    });
    expect(view.summary).toBe('Lines 1–5 of 2,001');
    expect(view.sections[0].text).toContain('a');
  });

  it('shows a running call without any payload', () => {
    const view = toolView({ name: 'get_script', state: 'input-streaming' });
    expect(view.status).toBe('running');
    expect(view.sections).toHaveLength(0);
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
  });

  it('caps the outline and flags it', () => {
    const big = Array.from({ length: 500 }, (_, index) => `f${index}() => ${index}`).join('\n');
    const outline = outlineScript(big, 10);
    expect(outline.entries).toHaveLength(10);
    expect(outline.truncated).toBe(true);
  });
});
