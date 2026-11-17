import type { ScreenerConfig, ScreenerPatch, ScreenerRow, ScreenerSnapshot } from '../types';
import { sidecarBaseUrl } from '../venues/sidecar';

function baseUrl(): string {
  return sidecarBaseUrl().replace(/\/+$/, '');
}

/** Applies a batched row patch and keeps the table's 24h-volume order. */
export function mergeScreenerRows(
  current: ScreenerRow[],
  patch: ScreenerPatch,
): ScreenerRow[] {
  const byKey = new Map(current.map((row) => [row.instrument.key, row]));
  for (const row of patch.rows) byKey.set(row.instrument.key, row);
  for (const key of patch.removed) byKey.delete(key);
  return [...byKey.values()].sort(
    (left, right) => (right.quoteVolume ?? -1) - (left.quoteVolume ?? -1),
  );
}

export function screenerWsUrl(): string {
  const url = new URL(baseUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/screener';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function fetchScreenerSnapshot(signal?: AbortSignal): Promise<ScreenerSnapshot> {
  const response = await fetch(`${baseUrl()}/screener/snapshot`, { signal });
  if (!response.ok) {
    throw new Error(`Screener snapshot failed: HTTP ${response.status}`);
  }
  return (await response.json()) as ScreenerSnapshot;
}

export async function postScreenerConfig(
  config: ScreenerConfig,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${baseUrl()}/screener/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Screener config failed: HTTP ${response.status}`);
  }
}
