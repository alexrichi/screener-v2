import type { Instrument, MarketKind, VenueId } from './types';

export interface InstrumentInput {
  venue: VenueId;
  nativeId: string;
  base: string;
  quote: string;
  kind: MarketKind;
  /** Override the app-facing name when the venue needs a special spelling. */
  display?: string;
  /** Price decimals from the venue's tick size. */
  pricePrecision?: number;
  /** Actual price step (e.g. 0.1), when the venue exposes it. */
  tickSize?: number;
  /** Base units per contract, for derivatives quoted in contracts. */
  contractSize?: number;
  /** Required: only the adapter knows the symbol Vela's provider expects. */
  velaSymbol: string;
}

export function instrumentKey(
  venue: VenueId,
  kind: MarketKind,
  nativeId: string,
): string {
  return `${venue}:${kind}:${nativeId}`;
}

/**
 * Compare chart symbols across the forms the app stores: a bare Binance ticker
 * means the perpetual, a provider-prefixed ticker keeps its own market, and the
 * `.P` suffix marks a Binance perp. A bare ticker and a prefixed spot ticker are
 * different instruments.
 */
export function sameVelaSymbol(a: string, b: string): boolean {
  const normalize = (raw: string): string => {
    const at = raw.indexOf(':');
    const provider = at >= 0 ? raw.slice(0, at).toLowerCase() : 'binance';
    const ticker = (at >= 0 ? raw.slice(at + 1) : raw)
      .replace(/\.P$/i, '')
      .toUpperCase();
    const perp = at < 0 || raw.slice(at + 1).toUpperCase().endsWith('.P');
    return `${provider}:${ticker}${perp ? '.P' : ''}`;
  };
  return normalize(a) === normalize(b);
}

/** Perps always carry the `.P` suffix in the app-facing name. */
export function perpDisplay(base: string, quote: string): string {
  return `${base}${quote}.P`;
}

/**
 * Spot keeps a slash when the venue's own ticker has one; otherwise the
 * compact concatenated form is used (BTCUSDT / BTCUSD).
 */
export function spotDisplay(nativeId: string, base: string, quote: string): string {
  return nativeId.includes('/') ? nativeId : `${base}${quote}`;
}

export function makeInstrument(input: InstrumentInput): Instrument {
  if (!input.venue || !input.nativeId || !input.base || !input.quote) {
    throw new Error('Instrument requires venue, nativeId, base and quote');
  }
  if (!input.velaSymbol) throw new Error('Instrument requires a Vela symbol');
  return {
    key: instrumentKey(input.venue, input.kind, input.nativeId),
    venue: input.venue,
    nativeId: input.nativeId,
    display:
      input.display ??
      (input.kind === 'perp'
        ? perpDisplay(input.base, input.quote)
        : spotDisplay(input.nativeId, input.base, input.quote)),
    velaSymbol: input.velaSymbol,
    base: input.base,
    quote: input.quote,
    kind: input.kind,
    pricePrecision: input.pricePrecision ?? 2,
    tickSize: input.tickSize,
    ...(input.contractSize && input.contractSize > 0
      ? { contractSize: input.contractSize }
      : {}),
  };
}
