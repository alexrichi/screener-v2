import { describe, expect, it } from 'vitest';
import { emptyRunSummary } from '../src/lib/ai/debugResult';
import type { DrawingRequest } from '../src/lib/ai/drawings';
import { createAppTools } from '../src/lib/ai/tools';

const meta = { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15', bars: 3, maxBarsBack: null };

/** Runtimes that do not exercise drawings still need the drawing seam. */
const drawingStubs = {
  drawingTools: () => [],
  listDrawings: () => [],
  drawOnChart: () => ({ created: [], errors: [] }),
  updateDrawing: () => ({ ok: false, error: 'no chart' }),
  removeDrawing: () => ({ ok: false }),
  clearDrawings: () => ({ removed: 0 }),
};

describe('AI tools', () => {
  it('passes the requested debug bar to the worker run', async () => {
    const seen: Array<{ source: string; bar?: number }> = [];
    const summary = emptyRunSummary(meta);
    const tools = createAppTools({
      ...drawingStubs,
      target: () => ({
        pineTabId: 'tab',
        savedId: '',
        name: 'Draft',
        workspaceTabId: 'ws',
      }),
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
      ...drawingStubs,
      target: () => ({
        pineTabId: 'tab',
        savedId: '',
        name: 'Draft',
        workspaceTabId: 'ws',
      }),
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
      target: { name: string; pineTabId: string };
      appliedPine: { name: string; chars: number } | null;
      outline: Array<{ kind: string; name?: string; line: number }>;
    };
    expect(result.scope).toBe('editor');
    expect(result.target).toMatchObject({ name: 'Draft', pineTabId: 'tab' });
    expect(result.appliedPine).toEqual({ name: 'Valid BOS Pullback', chars: 100 });
    expect(result.outline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'function', name: 'f', line: 3 }),
        expect.objectContaining({ kind: 'plot', name: 'plot' }),
      ]),
    );
  });

  it('forwards the new-script draft decision', async () => {
    const calls: Array<{ source: string; title?: string; conflict?: string }> = [];
    const tools = createAppTools({
      ...drawingStubs,
      target: () => ({
        pineTabId: 'tab',
        savedId: '',
        name: 'Draft',
        workspaceTabId: 'ws',
      }),
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
  });

  it('forwards native drawing requests', async () => {
    const seen: DrawingRequest[][] = [];
    const tools = createAppTools({
      ...drawingStubs,
      target: () => ({ pineTabId: 'tab', savedId: '', name: 'Draft', workspaceTabId: 'ws' }),
      getScript: () => '',
      applyScript: () => {},
      newScript: () => ({ created: true }),
      chartContext: () => null,
      runScript: async () => {
        const summary = emptyRunSummary(meta);
        return { ok: true, live: summary, worker: summary };
      },
      applyLive: async () => ({ ok: true, charts: 1 }),
      drawOnChart: (requests) => {
        seen.push(requests);
        return { created: ['draw-1'], errors: [] };
      },
    });

    const result = await tools.draw_on_chart.execute!(
      {
        drawings: [
          {
            type: 'trendline',
            points: [
              { time: 1_700_000_000_000, price: 64_000 },
              { time: 1_700_003_600_000, price: 65_000 },
            ],
            text: 'resistance',
          },
        ],
      },
      {} as never,
    );
    expect(result).toEqual({ created: ['draw-1'], errors: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toMatchObject({ type: 'trendline', text: 'resistance' });
    expect(seen[0]?.[0]?.points).toHaveLength(2);
  });
});

