import { describe, expect, it } from 'vitest';
import { resolveIcon } from '../sidecar/icons';

function stubFetch(handler: (url: string, call: number) => Response): {
  calls: string[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return handler(String(input), calls.length);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe('icon resolver', () => {
  it('falls through to the next source and caches the winner', async () => {
    const stub = stubFetch((_url, call) =>
      call === 1
        ? new Response('', { status: 404 })
        : new Response('png', { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    try {
      const first = await resolveIcon('ZZICON');
      expect(first?.contentType).toBe('image/png');
      expect(first?.body.length).toBe(3);
      expect(stub.calls.length).toBe(2);

      await resolveIcon('ZZICON');
      expect(stub.calls.length).toBe(2);
    } finally {
      stub.restore();
    }
  });

  it('remembers a miss for a while', async () => {
    const stub = stubFetch(() => new Response('', { status: 404 }));
    try {
      expect(await resolveIcon('ZZMISS')).toBeNull();
      const calls = stub.calls.length;
      expect(calls).toBeGreaterThan(1);
      expect(await resolveIcon('ZZMISS')).toBeNull();
      expect(stub.calls.length).toBe(calls);
    } finally {
      stub.restore();
    }
  });

  it('normalizes contract multipliers to the base code', async () => {
    const stub = stubFetch(() => new Response('png', { status: 200 }));
    try {
      await resolveIcon('1000PEPE');
      expect(stub.calls[0]).toContain('XTVCPEPE');
    } finally {
      stub.restore();
    }
  });
});
