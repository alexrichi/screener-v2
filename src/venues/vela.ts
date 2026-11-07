import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela/plugin';
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

function baseOf(symbol: SymbolDescriptor): string {
  const fromDescription = symbol.description?.split('/')[0]?.trim();
  if (fromDescription) return fromDescription.replace(/\s+Perpetual$/i, '');
  return symbol.ticker.replace(/[-_/]?(USDT|USDC|BUSD|FDUSD|USD|PERP)$/i, '') || symbol.ticker;
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
      { includeForming: true, to: range.to },
    );
    return bars.map(toVelaBar);
  }

  resolveSymbolIcon(symbol: SymbolDescriptor): string | undefined {
    const base = baseOf(symbol).trim().toUpperCase();
    if (!base) return undefined;
    return `https://crypto-icons.ledger.com/${encodeURIComponent(base)}.png`;
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
    if (!instrument) {
      throw new Error(`Sidecar has no ${this.venue} instrument "${ticker}"`);
    }
    return instrument;
  }
}
