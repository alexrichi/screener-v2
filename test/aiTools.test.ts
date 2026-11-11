import { describe, expect, it } from 'vitest';
import { emptyRunSummary } from '../src/lib/ai/debugResult';
import { createAppTools, toolsForAgent } from '../src/lib/ai/tools';

const meta = { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15', bars: 3, maxBarsBack: null };

describe('AI tools', () => {
  it('passes the requested debug bar to the worker run', async () => {
    const seen: Array<{ source: string; bar?: number }> = [];
    const summary = emptyRunSummary(meta);
    const tools = createAppTools({
      getScript: () => '//@version=6\nindicator("x")\nplot(close)',
      applyScript: () => {},
      newScript: () => ({ created: true }),
      chartContext: () => null,
      runScript: async (source, options) => {
        seen.push({ source, bar: options?.bar });
        return { ok: true, live: summary, worker: summary };
      },
      applyLive: async () => ({ ok: true, charts: 1 }),
    });

    await tools.run_script.execute!({ source: 'plot(open)', bar: 7 }, {} as never);
    expect(seen).toEqual([{ source: 'plot(open)', bar: 7 }]);
  });

  it('returns the compiler-AST outline from get_script', async () => {
    const source = `//@version=6
indicator("x")
f(
  a,
  b) =>
    a + b
plot(f(1, 2))`;
    const tools = createAppTools({
      getScript: () => source,
      applyScript: () => {},
      newScript: () => ({ created: true }),
      chartContext: () => ({
        symbol: 'BINANCE:BTCUSDT.P',
        timeframe: '60',
        layout: '1',
        indicators: ['SMC {WeloTrades}'],
        appliedPine: { name: 'Valid BOS Pullback', chars: 100 },
        cells: 1,
        bars: 500,
        visible: null,
      }),
      runScript: async () => {
        const summary = emptyRunSummary(meta);
        return { ok: true, live: summary, worker: summary };
      },
      applyLive: async () => ({ ok: true, charts: 1 }),
    });

    const result = (await tools.get_script.execute!({}, {} as never)) as {
      scope: string;
      appliedPine: { name: string; chars: number } | null;
      outline: Array<{ kind: string; name?: string; line: number }>;
    };
    expect(result.scope).toBe('editor');
    expect(result.appliedPine).toEqual({ name: 'Valid BOS Pullback', chars: 100 });
    expect(result.outline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'function', name: 'f', line: 3 }),
        expect.objectContaining({ kind: 'plot', name: 'plot' }),
      ]),
    );
  });

  it('forwards the new-script draft decision and hides the tool from read-only agents', async () => {
    const calls: Array<{ source: string; title?: string; conflict?: string }> = [];
    const tools = createAppTools({
      getScript: () => '//@version=6\nindicator("x")\nplot(close)',
      newScript: (input) => {
        calls.push(input);
        return input.conflict
          ? { created: true, chars: input.source.length }
          : {
              created: false,
              needsDecision: true,
              draft: { title: 'Draft', chars: 42, saved: false },
              options: ['save', 'discard', 'cancel'],
            };
      },
      applyScript: () => {},
      chartContext: () => null,
      runScript: async () => {
        const summary = emptyRunSummary(meta);
        return { ok: true, live: summary, worker: summary };
      },
      applyLive: async () => ({ ok: true, charts: 1 }),
    });

    const first = (await tools.new_script.execute!(
      { source: 'plot(close)' },
      {} as never,
    )) as { needsDecision?: boolean };
    expect(first.needsDecision).toBe(true);

    const second = (await tools.new_script.execute!(
      { source: 'plot(close)', conflict: 'save' },
      {} as never,
    )) as { created: boolean };
    expect(second.created).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].conflict).toBe('save');

    expect(toolsForAgent(tools, true)).not.toHaveProperty('new_script');
    expect(toolsForAgent(tools, false)).toHaveProperty('new_script');
  });
});
