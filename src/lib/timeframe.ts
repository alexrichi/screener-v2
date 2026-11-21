/** Timeframe aliases sent by Vela and Pine → the app's canonical keys. */
const TF_ALIASES: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '45m': '45',
  '1h': '60',
  '2h': '120',
  '3h': '180',
  '4h': '240',
  '6h': '360',
  '8h': '480',
  '12h': '720',
  '1d': 'D',
  '1w': 'W',
  '1mo': 'M',
  '1D': 'D',
  '1W': 'W',
  '1M': 'M',
  '4H': '240',
};

export function canonicalTimeframe(timeframe: string): string {
  return TF_ALIASES[timeframe] ?? TF_ALIASES[timeframe.toLowerCase()] ?? timeframe;
}

const TF_LABELS: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '45': '45m',
  '60': '1h',
  '120': '2h',
  '180': '3h',
  '240': '4h',
  '360': '6h',
  '480': '8h',
  '720': '12h',
  D: '1D',
  W: '1W',
  M: '1M',
};

/** Display spelling of a canonical timeframe (`15` → `15m`). */
export function timeframeLabel(timeframe: string): string {
  return TF_LABELS[canonicalTimeframe(timeframe)] ?? timeframe;
}

/** Bar duration in ms, for venues that report only the open time. */
export function timeframeMs(timeframe: string): number {
  const canonical = canonicalTimeframe(timeframe);
  const minutes: Record<string, number> = {
    '1': 1,
    '3': 3,
    '5': 5,
    '15': 15,
    '30': 30,
    '60': 60,
    '120': 120,
    '240': 240,
    '360': 360,
    '480': 480,
    '720': 720,
  };
  if (canonical in minutes) return minutes[canonical]! * 60_000;
  if (canonical === 'D') return 86_400_000;
  if (canonical === 'W') return 7 * 86_400_000;
  if (canonical === 'M') return 30 * 86_400_000;
  throw new Error(`Unsupported timeframe: ${timeframe}`);
}
