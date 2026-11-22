import type { PineBar } from '@screener/pine-engine';
import { sameVelaSymbol } from '../../venues/instrument';
import type { Instrument, VenueBar } from '../../venues/types';
import type { PineMarket } from './session';

/**
 * The chart's execution market and symbol info for one instrument. Mirrors
 * `SidecarVelaProvider.getSymbolInfo` and Vela's `EngineOrchestrator.market()`
 * so `syminfo.*` and `request.security(syminfo.tickerid, ...)` resolve exactly
 * as they do on the chart.
 */
export function marketOf(instrument: Instrument, timeframe: string): PineMarket {
  const prefix = String(instrument.venue).toUpperCase();
  const ticker = instrument.velaSymbol.slice(instrument.velaSymbol.indexOf(':') + 1);
  const scale = 10 ** instrument.pricePrecision;
  const mintick =
    instrument.tickSize && instrument.tickSize > 0 ? instrument.tickSize : 1 / scale;
  return {
    symbol: instrument.velaSymbol,
    timeframe,
    symbolInfo: {
      ticker,
      tickerid: instrument.velaSymbol,
      prefix,
      description: `${instrument.base} / ${instrument.quote}${
        instrument.kind === 'perp' ? ' Perpetual' : ''
      }`,
      type: instrument.kind === 'perp' ? 'futures' : 'crypto',
      basecurrency: instrument.base,
      currency: instrument.quote,
      mintick,
      pricescale: Math.round(1 / mintick),
      timezone: 'Etc/UTC',
      session: '24x7',
    },
  };
}

export function toPineBar(bar: VenueBar): PineBar {
  return {
    time: bar.openTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function flatTicker(symbol: string): string {
  const at = symbol.indexOf(':');
  return (at >= 0 ? symbol.slice(at + 1) : symbol)
    .replace(/\.P$/i, '')
    .replace(/[-_/]/g, '')
    .toUpperCase();
}

/** A script's bare `ETHUSDT` still resolves its venue's perpetual. */
export function findPineInstrument(
  instruments: readonly Instrument[],
  symbol: string,
): Instrument | undefined {
  const wanted = flatTicker(symbol);
  // Binance lists spot and perp under the same ticker. An unprefixed script
  // symbol keeps meaning the perpetual; `BINANCE:...` selects the spot one.
  if (!symbol.includes(':') && !/\.P$/i.test(symbol)) {
    const perp = instruments.find(
      (item) => item.kind === 'perp' && flatTicker(item.nativeId) === wanted,
    );
    if (perp) return perp;
  }
  const exact = instruments.find((item) => sameVelaSymbol(item.velaSymbol, symbol));
  if (exact) return exact;
  return (
    instruments.find((item) => flatTicker(item.nativeId) === wanted) ??
    instruments.find((item) => `${item.base}${item.quote}`.toUpperCase() === wanted)
  );
}
