/**
 * One icon source for the table and the charts. Icons go through the sidecar
 * because Vela loads them with `crossOrigin` (so a chart screenshot can be
 * exported from the canvas) and only a few public CDNs send CORS headers --
 * no single CDN covers the listed assets anyway, so the sidecar chains several
 * and caches the winning image.
 */
import { sidecarBaseUrl } from '../venues/sidecar';

/** Contract multipliers carry no icon of their own: 1000PEPE is PEPE, kPEPE is PEPE. */
const MULTIPLIER = /^(1000000|10000|1000|1MIL|1M)(?=[A-Z0-9])/;

/** The icon code for a base asset, without its contract multiplier. */
export function coinIconCode(base: string): string {
  const raw = base.trim();
  const withoutK = /^k[A-Z]/.test(raw) ? raw.slice(1) : raw;
  return withoutK.toUpperCase().replace(MULTIPLIER, '');
}

/** Sidecar icon URL for a base asset; `undefined` when there is nothing to ask for. */
export function coinIconUrl(base: string): string | undefined {
  const code = coinIconCode(base);
  if (!code) return undefined;
  return `${sidecarBaseUrl()}/icon/${encodeURIComponent(code)}`;
}
