import { canonicalTimeframe } from '../src/lib/timeframe';
import type { Instrument } from '../src/venues/types';
import type { ParsedBar, WsSpec } from './ws';

function canonical(timeframe: string): string {
  return canonicalTimeframe(timeframe);
}

const OKX_CHANNELS: Record<string, string> = {
  '1': 'candle1m',
  '3': 'candle3m',
  '5': 'candle5m',
  '15': 'candle15m',
  '30': 'candle30m',
  '60': 'candle1H',
  '120': 'candle2H',
  '240': 'candle4H',
  '360': 'candle6H',
  '720': 'candle12H',
  D: 'candle1D',
  W: 'candle1W',
  M: 'candle1M',
};

function okxCandleArgs(tokens: string[]): Array<{ channel: string; instId: string }> {
  return tokens.map((token) => {
    const [channel, instId] = token.split('|');
    return { channel: channel!, instId: instId! };
  });
}

export const OKX_STREAM: WsSpec = {
  label: 'okx',
  url: 'wss://ws.okx.com:8443/ws/v5/business',
  token(instrument: Instrument, timeframe: string): string {
    const channel = OKX_CHANNELS[canonical(timeframe)];
    if (!channel) throw new Error(`Unsupported timeframe: ${timeframe}`);
    return `${channel}|${instrument.nativeId}`;
  },
  subscribe: (tokens) => ({ op: 'subscribe', args: okxCandleArgs(tokens) }),
  unsubscribe: (tokens) => ({ op: 'unsubscribe', args: okxCandleArgs(tokens) }),
  parse(raw) {
    const message = JSON.parse(raw) as {
      arg?: { channel?: string; instId?: string };
      data?: string[][];
    };
    if (!message.arg?.channel || !message.arg.instId || !Array.isArray(message.data)) {
      return [];
    }
    const token = `${message.arg.channel}|${message.arg.instId}`;
    const row = message.data[message.data.length - 1];
    if (!row) return [];
    return [
      {
        token,
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[6] ?? row[5]),
      },
    ];
  },
  ping: { everyMs: 25_000, message: 'ping' },
};

function bybitInterval(timeframe: string): string {
  const tf = canonical(timeframe);
  if (!['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'].includes(tf)) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }
  return tf;
}

export const BYBIT_STREAM: WsSpec = {
  label: 'bybit',
  url: 'wss://stream.bybit.com/v5/public/linear',
  token(instrument: Instrument, timeframe: string): string {
    return `kline.${bybitInterval(timeframe)}.${instrument.nativeId}`;
  },
  subscribe: (tokens) => ({ op: 'subscribe', args: tokens }),
  unsubscribe: (tokens) => ({ op: 'unsubscribe', args: tokens }),
  parse(raw) {
    const message = JSON.parse(raw) as {
      topic?: string;
      data?: Array<{
        start: number;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      }>;
    };
    if (!message.topic || !Array.isArray(message.data)) return [];
    const row = message.data[message.data.length - 1];
    if (!row) return [];
    return [
      {
        token: message.topic,
        openTime: Number(row.start),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      },
    ];
  },
  ping: { everyMs: 20_000, message: { op: 'ping' } },
};

const BITGET_CHANNELS: Record<string, string> = {
  '1': 'candle1m',
  '3': 'candle3m',
  '5': 'candle5m',
  '15': 'candle15m',
  '30': 'candle30m',
  '60': 'candle1H',
  '120': 'candle2H',
  '240': 'candle4H',
  '360': 'candle6H',
  '720': 'candle12H',
  D: 'candle1D',
  W: 'candle1W',
  M: 'candle1M',
};

function bitgetArgs(tokens: string[]): Array<{
  instType: 'USDT-FUTURES';
  channel: string;
  instId: string;
}> {
  return tokens.map((token) => {
    const [channel, instId] = token.split('|');
    return { instType: 'USDT-FUTURES', channel: channel!, instId: instId! };
  });
}

export const BITGET_STREAM: WsSpec = {
  label: 'bitget',
  url: 'wss://ws.bitget.com/v2/ws/public',
  token(instrument: Instrument, timeframe: string): string {
    const channel = BITGET_CHANNELS[canonical(timeframe)];
    if (!channel) throw new Error(`Unsupported timeframe: ${timeframe}`);
    return `${channel}|${instrument.nativeId}`;
  },
  subscribe: (tokens) => ({ op: 'subscribe', args: bitgetArgs(tokens) }),
  unsubscribe: (tokens) => ({ op: 'unsubscribe', args: bitgetArgs(tokens) }),
  parse(raw) {
    const message = JSON.parse(raw) as {
      arg?: { channel?: string; instId?: string };
      data?: string[][];
    };
    if (!message.arg?.channel || !message.arg.instId || !Array.isArray(message.data)) {
      return [];
    }
    const token = `${message.arg.channel}|${message.arg.instId}`;
    const row = message.data[message.data.length - 1];
    if (!row) return [];
    return [
      {
        token,
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      },
    ];
  },
  ping: { everyMs: 25_000, message: 'ping' },
};

const HL_INTERVALS: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '480': '8h',
  '720': '12h',
  D: '1d',
  W: '1w',
  M: '1M',
};

function hlToken(token: string): { interval: string; coin: string } {
  const [interval, coin] = token.split('|');
  return { interval: interval!, coin: coin! };
}

export const HYPERLIQUID_STREAM: WsSpec = {
  label: 'hyperliquid',
  url: 'wss://api.hyperliquid.xyz/ws',
  token(instrument: Instrument, timeframe: string): string {
    const interval = HL_INTERVALS[canonical(timeframe)];
    if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);
    return `${interval}|${instrument.nativeId}`;
  },
  subscribe: (tokens) =>
    tokens.map((token) => ({
      method: 'subscribe',
      subscription: { type: 'candle', ...hlToken(token) },
    })),
  unsubscribe: (tokens) =>
    tokens.map((token) => ({
      method: 'unsubscribe',
      subscription: { type: 'candle', ...hlToken(token) },
    })),
  parse(raw) {
    const message = JSON.parse(raw) as {
      channel?: string;
      data?: {
        t: number;
        s: string;
        i: string;
        o: string;
        h: string;
        l: string;
        c: string;
        v: string;
      };
    };
    if (message.channel !== 'candle' || !message.data) return [];
    const row = message.data;
    return [
      {
        token: `${row.i}|${row.s}`,
        openTime: Number(row.t),
        open: Number(row.o),
        high: Number(row.h),
        low: Number(row.l),
        close: Number(row.c),
        volume: Number(row.v),
      },
    ];
  },
  ping: { everyMs: 30_000, message: { method: 'ping' } },
};

/** Type re-export so the server can hold parsed bars from any spec. */
export type { ParsedBar };
