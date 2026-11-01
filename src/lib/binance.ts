import type { MarketRow } from '../types';

const FUTURES = 'https://fapi.binance.com/fapi/v1';

interface BinanceExchangeSymbol {
  symbol: string;
  status: string;
  contractType: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision?: number;
  tickSize?: string;
}

interface BinanceExchangeInfo {
  symbols: BinanceExchangeSymbol[];
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
    throw new Error(`Binance ${response.status}${detail ? `: ${detail}` : ''}`);
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

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function chartSymbol(symbol: string): string {
  return symbol.endsWith('.P') ? symbol : `${symbol}.P`;
}

export function spotSymbol(symbol: string): string {
  return symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol;
}

export function baseFromSymbol(symbol: string): string {
  return spotSymbol(symbol).replace(/(USDT|USDC|BUSD|FDUSD)$/i, '');
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
  const interval = map[timeframe];
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
    }));
  metaCache = { at: Date.now(), rows };
  return rows;
}

export async function fetchUniverse(signal?: AbortSignal): Promise<MarketRow[]> {
  const [meta, tickers, premium] = await Promise.all([
    fetchSymbolMeta(signal),
    fetchJson<BinanceTicker24h[]>(`${FUTURES}/ticker/24hr`, signal),
    fetchJson<BinancePremiumIndex[]>(`${FUTURES}/premiumIndex`, signal),
  ]);
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const fundingBySymbol = new Map(premium.map((p) => [p.symbol, p]));

  const rows: MarketRow[] = meta.map((m) => {
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
    };
  });

  rows.sort((a, b) => (b.quoteVolume ?? -1) - (a.quoteVolume ?? -1));
  return rows;
}

/**
 * Returns up to `bars` CLOSED candles. Binance includes the forming candle as the
 * last row, so one extra row is requested and any row whose close time is still in
 * the future is dropped.
 */
export async function fetchKlines(
  symbol: string,
  timeframe: string,
  bars: number,
  signal?: AbortSignal,
): Promise<PineBar[]> {
  const interval = binanceInterval(timeframe);
  const limit = Math.min(1500, Math.max(2, bars + 1));
  const url = `${FUTURES}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
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
        bar.closeTime <= now,
    )
    .sort((a, b) => a.openTime - b.openTime);
  return parsed.slice(-bars);
}
