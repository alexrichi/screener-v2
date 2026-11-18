import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela/plugin';
import { coinIconUrl } from '../lib/coinIcon';
import { SidecarVenueAdapter } from './sidecar';
import { subscribeSidecarBar } from './sidecarStream';
import type { Instrument, Unsubscribe } from './types';

function toVelaBar(bar: {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): OHLCV {
  return {
    time: bar.openTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

/** The ticker Vela expects: the venue symbol without its provider prefix. */
function tickerOf(instrument: Instrument): string {
  const at = instrument.velaSymbol.indexOf(':');
  return at >= 0 ? instrument.velaSymbol.slice(at + 1) : instrument.nativeId;
}

/** Suffixes a listing adds on top of the base asset, stripped until none is left. */
const TICKER_SUFFIX = /[-_/]?(SWAP|PERP|USDT|USDC|USD1|USDS|BUSD|FDUSD|USD|EUR)$/i;

function baseOf(symbol: SymbolDescriptor): string {
  const fromDescription = symbol.description?.split('/')[0]?.trim();
  if (fromDescription) return fromDescription.replace(/\s+Perpetual$/i, '');
  // Vela spells a perp `BTCUSDT.P`; strip that before the quote suffixes.
  let code = symbol.ticker.replace(/\.P$/i, '');
  // `BTC-USDT-SWAP` needs both suffixes gone; a single replace leaves `BTC-USDT`.
  while (TICKER_SUFFIX.test(code)) code = code.replace(TICKER_SUFFIX, '');
  return code || symbol.ticker;
}

function iconOf(symbol: SymbolDescriptor): string | undefined {
  const base = baseOf(symbol).trim();
  return base ? coinIconUrl(base) : undefined;
}

/**
 * Vela's DataProvider for one venue, backed entirely by the sidecar. There is
 * no direct exchange path: history, live candles and backfills all go through
 * the sidecar's shared adapter, limiter and caches.
 */
export class SidecarVelaProvider implements DataProvider {
  private readonly sidecar: SidecarVenueAdapter;
  private instruments: Promise<Instrument[]> | null = null;

  constructor(
    private readonly venue: string,
    private readonly label = venue.toUpperCase(),
  ) {
    this.sidecar = new SidecarVenueAdapter(venue);
  }

  info(): ProviderInfo {
    return {
      name: this.venue,
      displayName: this.label,
      requiresApiKey: false,
      supportedTimeframes: ['1', '5', '15', '60', '240', 'D'],
      capabilities: { enumerate: true, stream: true, symbolInfo: true },
    };
  }

  async listSymbols(): Promise<SymbolDescriptor[]> {
    const instruments = await this.getInstruments();
    return instruments.map((instrument) => ({
      ticker: tickerOf(instrument),
      description: `${instrument.base} / ${instrument.quote}${
        instrument.kind === 'perp' ? ' Perpetual' : ''
      }`,
      type: instrument.kind === 'perp' ? 'futures' : 'crypto',
    }));
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const instrument = await this.findInstrument(ticker);
    const bars = await this.sidecar.fetchBars(
      instrument,
      timeframe,
      range.limit ?? 500,
      undefined,
      { includeForming: true, from: range.from, to: range.to },
    );
    return bars.map(toVelaBar);
  }

  resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
    return iconOf(symbol);
  }

  subscribe(
    ticker: string,
    timeframe: string,
    onBar: (bar: OHLCV) => void,
    opts?: { session?: string },
  ): Unsubscribe {
    let stopped = false;
    let poll: number | null = null;
    let stopStream: Unsubscribe | null = null;

    const stopPolling = () => {
      if (poll !== null) {
        window.clearInterval(poll);
        poll = null;
      }
    };
    // The sidecar feeds live bars; the browser only polls while the socket to it
    // is down (restart, network loss).
    const startPolling = () => {
      if (stopped || poll !== null) return;
      poll = window.setInterval(() => {
        void this.getBars(ticker, timeframe, { limit: 2 })
          .then((bars) => {
            const bar = bars[bars.length - 1];
            if (bar && !stopped) onBar(bar);
          })
          .catch(() => {});
      }, 1000);
    };

    void this.findInstrument(ticker)
      .then((instrument) => {
        if (stopped) return;
        stopStream = subscribeSidecarBar(instrument.key, timeframe, {
          onBar: (bar) => {
            stopPolling();
            onBar(toVelaBar(bar));
          },
          onError: () => {
            stopPolling();
          },
          onStatus: (status) => {
            if (status === 'closed') startPolling();
            else stopPolling();
          },
        });
      })
      .catch(() => {
        // Sidecar unreachable: the chart keeps what it has; a reload retries.
      });

    return () => {
      stopped = true;
      stopPolling();
      stopStream?.();
    };
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const instrument = await this.findInstrument(ticker);
    const scale = 10 ** instrument.pricePrecision;
    const mintick = instrument.tickSize && instrument.tickSize > 0 ? instrument.tickSize : 1 / scale;
    const prefix = this.venue.toUpperCase();
    return {
      ticker,
      tickerid: `${prefix}:${ticker}`,
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
    };
  }

  private getInstruments(): Promise<Instrument[]> {
    if (!this.instruments) {
      this.instruments = this.sidecar.listInstruments().catch((error) => {
        this.instruments = null;
        throw error;
      });
    }
    return this.instruments;
  }

  private async findInstrument(ticker: string): Promise<Instrument> {
    const wanted = ticker.toUpperCase();
    const instruments = await this.getInstruments();
    const instrument = instruments.find(
      (item) => tickerOf(item).toUpperCase() === wanted,
    );
    if (instrument) return instrument;
    // A script's bare `ETHUSDT` means the perpetual on a futures venue.
    if (!wanted.endsWith('.P')) {
      const perp = instruments.find(
        (item) => tickerOf(item).toUpperCase() === `${wanted}.P`,
      );
      if (perp) return perp;
    }
    // Venues with different ticker shapes (OKX, Bybit, Bitget) still resolve
    // a bare base/quote pair such as ETHUSDT.
    const quote = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USD', 'BTC', 'ETH', 'EUR']
      .find((suffix) => wanted.endsWith(suffix));
    if (quote) {
      const base = wanted.slice(0, -quote.length);
      const pair =
        instruments.find(
          (item) =>
            item.base.toUpperCase() === base &&
            item.quote.toUpperCase() === quote &&
            item.kind === 'perp',
        ) ??
        instruments.find(
          (item) =>
            item.base.toUpperCase() === base &&
            item.quote.toUpperCase() === quote,
        );
      if (pair) return pair;
    }
    throw new Error(`Sidecar has no ${this.venue} instrument "${ticker}"`);
  }
}
