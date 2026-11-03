const SOURCE_BASE =
  'https://vela.luxalgo.com/api/quant/prod-library/api/library/pinescript/';
const SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 100;

interface CacheEntry {
  code: string;
  at: number;
}

const sources = new Map<string, CacheEntry>();

/**
 * Full Pine source for one Library indicator. The public Vela endpoint returns
 * the exact script its own picker applies, licence header included.
 */
export async function librarySource(codeId: string): Promise<string> {
  const now = Date.now();
  const cached = sources.get(codeId);
  if (cached && now - cached.at < SOURCE_TTL_MS) return cached.code;

  const response = await fetch(`${SOURCE_BASE}${encodeURIComponent(codeId)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`LuxAlgo Library responded ${response.status}`);
  }
  const payload = (await response.json()) as { data?: { code?: unknown } };
  const code = payload?.data?.code;
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('LuxAlgo Library returned an empty script');
  }

  sources.set(codeId, { code, at: now });
  if (sources.size > CACHE_LIMIT) {
    const oldest = sources.keys().next().value;
    if (oldest) sources.delete(oldest);
  }
  return code;
}
