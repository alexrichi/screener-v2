import { describe, expect, it } from 'vitest';
import type { ExecutionHandlers, ExecutionRequest, IndicatorModel } from '@luxalgo/vela/plugin';
import { PineEngine } from '../src/lib/pineVela/engine';

function waitFor(check: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('PineEngine intrabar feed', () => {
  it('fetches lower-timeframe bars through fetchSeries', async () => {
    const bars = Array.from({ length: 4 }, (_, index) => ({
      time: index * 15 * 60_000,
      open: 100 + index,
      high: 110 + index,
      low: 90 + index,
      close: 100 + index,
      volume: 10,
    }));
    const lower = Array.from({ length: 60 }, (_, index) => ({
      time: index * 60_000,
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: 1,
    }));
    const calls: Array<{ symbol: string; timeframe: string; limit?: number }> = [];
    const models: IndicatorModel[] = [];
    const errors: Error[] = [];
    const engine = new PineEngine();
    const prepared = await engine.prepare(
      `//@version=6
indicator("Intrabar")
[times, closes] = request.security_lower_tf(syminfo.tickerid, "1", [time, close])
plot(array.size(times), "Count")
plot(array.get(closes, 0), "First close")`,
      'probe',
    );
    const request = {
      prepared,
      market: { symbol: 'BINANCE:BTCUSDT.P', timeframe: '15' },
      bars,
      fetchSeries: async (symbol: string, timeframe: string, range: { limit?: number }) => {
        calls.push({ symbol, timeframe, limit: range.limit });
        return lower;
      },
      mode: 'static',
      historyState: 'complete',
    } as unknown as ExecutionRequest;
    const handlers = {
      onModel: (model: IndicatorModel) => models.push(model),
      onError: (error: Error) => errors.push(error),
    } as unknown as ExecutionHandlers;

    engine.execute(request, handlers);
    await waitFor(() => models.some((model) => {
      const count = model.series.find((series) => series.title === 'Count');
      return count?.kind === 'line' && count.points[0]?.value === 15;
    }) || errors.length > 0);

    expect(errors).toEqual([]);
    expect(calls[0]).toMatchObject({ symbol: 'BINANCE:BTCUSDT.P', timeframe: '1' });
    const model = models.find((candidate) => {
      const count = candidate.series.find((series) => series.title === 'Count');
      return count?.kind === 'line' && count.points[0]?.value === 15;
    })!;
    const count = model.series.find((series) => series.title === 'Count');
    expect(count?.kind).toBe('line');
    if (count?.kind !== 'line') throw new Error('Count series missing');
    expect(count.points[0]!.value).toBe(15);
    const first = model.series.find((series) => series.title === 'First close');
    if (first?.kind !== 'line') throw new Error('First close series missing');
    expect(first.points[0]!.value).toBe(100);
  });
});
