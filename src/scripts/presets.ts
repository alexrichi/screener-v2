export interface ScriptPreset {
  id: string;
  name: string;
  source: string;
}

export const DEFAULT_SCRIPT = `//@version=6
indicator("RSI", overlay=false)

length = input.int(14, "Length")
rsi = ta.rsi(close, length)

plot(rsi, "RSI")
plot(rsi <= 30 ? 1 : 0, "Oversold")
plot(rsi >= 70 ? 1 : 0, "Overbought")
`;

export const PRESETS: ScriptPreset[] = [
  {
    id: 'rsi',
    name: 'RSI 14',
    source: DEFAULT_SCRIPT,
  },
  {
    id: 'ema-cross',
    name: 'EMA cross',
    source: `//@version=6
indicator("EMA cross", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)

plot(fast, "EMA 9")
plot(slow, "EMA 21")
plot(ta.crossover(fast, slow) ? 1 : 0, "Long")
plot(ta.crossunder(fast, slow) ? 1 : 0, "Short")
`,
  },
  {
    id: 'volume-breakout',
    name: 'Volume breakout',
    source: `//@version=6
indicator("Volume breakout", overlay=false)

average = ta.sma(volume, 20)
ratio = average > 0 ? volume / average : 0

plot(ratio, "Volume x")
plot(ratio > 2 ? 1 : 0, "Breakout")
plot(ta.change(close) > 0 ? 1 : 0, "Up bar")
`,
  },
  {
    id: 'atr-range',
    name: 'ATR range',
    source: `//@version=6
indicator("ATR range", overlay=false)

atr = ta.atr(14)
percent = close > 0 ? atr / close * 100 : 0

plot(atr, "ATR")
plot(percent, "ATR %")
`,
  },
];
