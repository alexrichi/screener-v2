import { canonicalTimeframe } from './timeframe';

const FUTURES = 'https://fapi.binance.com/fapi/v1';

interface BinanceExchangeSymbol {
  symbol: string;
  status: string;
  contractType: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision?: number;
  tickSize?: string;
  filters?: { filterType?: string; tickSize?: string }[];
}

interface BinanceExchangeInfo {
  symbols: BinanceExchangeSymbol[];
}

export class BinanceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
    this.name = 'BinanceHttpError';
  }
}

interface BinanceTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
}

interface BinancePremiumIndex {
  symbol: string;
  lastFundingRate?: string;
  nextFundingTime?: string;
}

export interface PineBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

interface SymbolMeta {
  symbol: string;
  base: string;
  quote: string;
  pricePrecision: number;
  /** Actual price step from PRICE_FILTER.tickSize, e.g. 0.1 for BTCUSDT.P. */
  tickSize?: number;
}

let metaCache: { at: number; rows: SymbolMeta[] } | null = null;
const META_TTL_MS = 10 * 60_000;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
    throw new BinanceHttpError(
      response.status,
      retryAfterMs,
      `Binance ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return (await response.json()) as T;
}

function decimalsFromTickSize(tickSize: string | undefined): number {
  if (!tickSize || tickSize === '0') return 8;
  const text = String(tickSize);
  const dot = text.indexOf('.');
  if (dot < 0) return 0;
  return Math.min(8, text.length - dot - 1);
}

/** Numeric tick size from the venue's string, or undefined when absent/invalid. */
function numberFromTickSize(tickSize: string | undefined): number | undefined {
  if (!tickSize) return undefined;
  const value = Number(tickSize);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function chartSymbol(symbol: string): string {
  const at = symbol.indexOf(':');
  if (at >= 0) {
    const provider = symbol.slice(0, at);
    const ticker = symbol.slice(at + 1);
    // Provider-prefixed Binance perps keep `.P`. Older persisted tabs may have
    // lost it; the provider only serves USDT-M perpetuals in this app.
    if (provider.toLowerCase() === 'binance' && !ticker.toUpperCase().endsWith('.P')) {
      return `${provider}:${ticker}.P`;
    }
    return symbol;
  }
  return symbol.endsWith('.P') ? symbol : `${symbol}.P`;
}

export function spotSymbol(symbol: string): string {
  // A provider prefix owns its ticker; only bare Binance tickers lose `.P`.
  if (symbol.includes(':')) return symbol;
  return symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol;
}

export function baseFromSymbol(symbol: string): string {
  const at = symbol.indexOf(':');
  const ticker = at >= 0 ? symbol.slice(at + 1) : symbol;
  return spotSymbol(ticker).replace(/(USDT|USDC|BUSD|FDUSD)$/i, '');
}

/** Short tab label: `BTC` for `BTCUSDT`, `binance:BTCUSDT.P`, and `okx:BTC-USDT-SWAP`. */
export function symbolLabel(symbol: string): string {
  const at = symbol.indexOf(':');
  if (at >= 0) {
    const native = symbol.slice(at + 1);
    const dash = native.indexOf('-');
    if (dash > 0) return native.slice(0, dash);
    return baseFromSymbol(native);
  }
  return baseFromSymbol(symbol);
}

export function binanceInterval(timeframe: string): string {
  const map: Record<string, string> = {
    '1': '1m',
    '3': '3m',
    '5': '5m',
    '15': '15m',
    '30': '30m',
    '60': '1h',
    '120': '2h',
    '240': '4h',
    '360': '6h',
    '480': '8h',
    '720': '12h',
    D: '1d',
    W: '1w',
    M: '1M',
  };
  const interval = map[canonicalTimeframe(timeframe)];
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);
  return interval;
}

export async function fetchSymbolMeta(signal?: AbortSignal): Promise<SymbolMeta[]> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.rows;
  const info = await fetchJson<BinanceExchangeInfo>(`${FUTURES}/exchangeInfo`, signal);
  const rows = info.symbols
    .filter(
      (s) =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING',
    )
    .map((s) => ({
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
      pricePrecision:
        typeof s.pricePrecision === 'number'
          ? Math.max(0, Math.min(8, s.pricePrecision))
          : decimalsFromTickSize(s.tickSize),
      tickSize: numberFromTickSize(
        s.tickSize ?? s.filters?.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize,
      ),
    }));
  metaCache = { at: Date.now(), rows };
  return rows;
}

/** Raw Binance ticker row used by the adapter; the browser table never sees it. */
export interface BinanceMarketRow {
  symbol: string;
  base: string;
  quote: string;
  price: number | null;
  change24h: number | null;
  quoteVolume: number | null;
  funding: number | null;
  nextFunding: number | null;
  pricePrecision: number;
  tickSize?: number;
}

export async function fetchUniverse(signal?: AbortSignal): Promise<BinanceMarketRow[]> {
  const [meta, tickers, premium] = await Promise.all([
    fetchSymbolMeta(signal),
    fetchJson<BinanceTicker24h[]>(`${FUTURES}/ticker/24hr`, signal),
    fetchJson<BinancePremiumIndex[]>(`${FUTURES}/premiumIndex`, signal),
  ]);
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const fundingBySymbol = new Map(premium.map((p) => [p.symbol, p]));

  const rows: BinanceMarketRow[] = meta.map((m) => {
    const ticker = tickerBySymbol.get(m.symbol);
    const funding = fundingBySymbol.get(m.symbol);
    const price = numberOrNull(ticker?.lastPrice);
    const quoteVolume = numberOrNull(ticker?.quoteVolume);
    const nextFunding = numberOrNull(funding?.nextFundingTime);
    return {
      symbol: m.symbol,
      base: m.base,
      quote: m.quote,
      price: price && price > 0 ? price : null,
      change24h: numberOrNull(ticker?.priceChangePercent),
      quoteVolume: quoteVolume && quoteVolume > 0 ? quoteVolume : null,
      funding: numberOrNull(funding?.lastFundingRate),
      nextFunding: nextFunding && nextFunding > 0 ? nextFunding : null,
      pricePrecision: m.pricePrecision,
      tickSize: m.tickSize,
    };
  });

  rows.sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
  return rows;
}

export interface KlineOptions {
  /** Keep the in-progress candle (charts); the scanner never does. */
  includeForming?: boolean;
  /** End of the window (epoch ms). Binance `endTime`. */
  to?: number;
}

/**
 * Returns up to `bars` candles ending at `opts.to` (default: now). Binance
 * includes the forming candle as the last row, so by default one extra row is
 * requested and any row whose close time is still in the future is dropped.
 * Charts pass `includeForming` to keep it; the scanner never does. Requests are
 * capped at Binance's 1500-row page; callers paginate for deeper history.
 */
export async function fetchKlines(
  symbol: string,
  timeframe: string,
  bars: number,
  signal?: AbortSignal,
  opts: KlineOptions = {},
): Promise<PineBar[]> {
  const interval = binanceInterval(timeframe);
  const limit = Math.min(1500, Math.max(2, bars + (opts.includeForming ? 0 : 1)));
  const query = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (opts.to != null) query.set('endTime', String(Math.floor(opts.to)));
  const url = `${FUTURES}/klines?${query.toString()}`;
  const raw = await fetchJson<Array<Array<string | number>>>(url, signal);
  const now = Date.now();
  const parsed = raw
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: Number(row[6]),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.openTime) &&
        Number.isFinite(bar.close) &&
        Number.isFinite(bar.closeTime) &&
        (opts.includeForming || bar.closeTime <= now),
    )
    .sort((a, b) => a.openTime - b.openTime);
  return parsed.slice(-bars);
}
