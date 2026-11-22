/** Group with a non-breaking space: `77 919.20`, not `77,919.20`. */
function groupThousands(text: string): string {
  return text.replace(/,/g, '\u00a0');
}

export function formatPrice(value: number | null, precision = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const max = Math.max(0, Math.min(8, precision));
  const min = Math.min(2, max);
  return groupThousands(
    value.toLocaleString('en-US', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }),
  );
}

export function formatPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatFunding(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(4)}%`;
}

export function formatNumber(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return groupThousands(
    value.toLocaleString('en-US', {
      maximumFractionDigits: digits,
    }),
  );
}

export function formatClock(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatNextFunding(ms: number | null): string {
  if (!ms) return '';
  return `Next funding: ${new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function shortSymbol(symbol: string): string {
  return symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol;
}

export function layoutLabel(layout: string): string {
  const preset: Record<string, string> = {
    '1': '1',
    '2h': '2×1',
    '2v': '1×2',
    '4': '2×2',
    '8': '4×2',
  };
  if (preset[layout]) return preset[layout];
  const custom = /^g(\d+)x(\d+)$/.exec(layout);
  if (custom) return `${custom[1]}×${custom[2]}`;
  return layout;
}
