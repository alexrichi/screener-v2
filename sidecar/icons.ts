/**
 * Public logo CDNs, tried in order. The symbol-logo S3 CDN covers most crypto,
 * OKX adds tokenized stocks and newer listings, Binance and CoinCap fill their
 * own gaps, and FMP carries stock/ETF logos for the tokenized equities some
 * venues list. Ledger is the long-standing crypto fallback.
 */
import { coinIconCode } from '../src/lib/coinIcon';

const SOURCES: ReadonlyArray<(code: string) => string> = [
  (code) => `https://s3-symbol-logo.tradingview.com/crypto/XTVC${code}--big.svg`,
  (code) => `https://www.okx.com/cdn/oksupport/asset/currency/icon/${code.toLowerCase()}.png`,
  (code) => `https://bin.bnbstatic.com/static/assets/logos/${code}.png`,
  (code) => `https://assets.coincap.io/assets/icons/${code.toLowerCase()}@2x.png`,
  (code) => `https://financialmodelingprep.com/image-stock/${code}.png`,
  (code) => `https://crypto-icons.ledger.com/${code}.png`,
];

const CACHE_MAX = 600;
const MISS_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 3_000;

export interface IconImage {
  body: Buffer;
  contentType: string;
}

const cache = new Map<string, { image: IconImage | null; at: number }>();

async function fetchFirst(code: string): Promise<IconImage | null> {
  for (const source of SOURCES) {
    try {
      const response = await fetch(source(code), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!response.ok) continue;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) continue;
      return {
        body,
        contentType: response.headers.get('content-type') ?? 'image/png',
      };
    } catch {
      // Try the next source: a dead CDN must not hide the others.
    }
  }
  return null;
}

/** Binary icon for a base asset, or null when no source has one. */
export async function resolveIcon(base: string): Promise<IconImage | null> {
  const code = coinIconCode(base);
  if (!code) return null;
  const now = Date.now();
  const cached = cache.get(code);
  if (cached && (cached.image !== null || now - cached.at < MISS_TTL_MS)) {
    // Refresh the insertion order so a busy icon survives eviction.
    cache.delete(code);
    cache.set(code, cached);
    return cached.image;
  }

  const image = await fetchFirst(code);
  cache.set(code, { image, at: now });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return image;
}
