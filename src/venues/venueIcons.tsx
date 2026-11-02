import type { VenueId } from '../types';
import { VENUE_CATALOG } from './catalog';
import { cn } from '../ui/cn';

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const BINANCE_SVG = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#F0B90B"/><g transform="translate(3.36 3.36) scale(0.72)"><path fill="#0B0E11" d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z"/></g></svg>`,
);

const OKX_SVG = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#000"/><g fill="#fff"><rect x="4.5" y="4.5" width="5" height="5"/><rect x="14.5" y="4.5" width="5" height="5"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="4.5" y="14.5" width="5" height="5"/><rect x="14.5" y="14.5" width="5" height="5"/></g></svg>`,
);

const COINBASE_SVG = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0052FF"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" stroke-width="3.4"/><rect x="15.2" y="10.3" width="7" height="3.4" fill="#0052FF"/></svg>`,
);

const BITGET_SVG = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" rx="8" fill="#00F0FF"/><path d="M17.2038 15.0746H22.1378L27.1854 20.0633C27.5138 20.3878 27.5154 20.9156 27.1888 21.2418L20.7156 27.713H15.6328L17.1694 26.2271L22.8113 20.6506L17.2411 15.0742" fill="#00040C"/><path d="M19.2289 20.6388H14.2949L9.24731 15.6502C8.91896 15.3257 8.91729 14.7979 9.24396 14.4717L15.7172 8H20.7999L19.2633 9.48596L13.6214 15.0624L19.1917 20.6388" fill="#00040C"/></svg>`,
);

const BYBIT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFHSURBVFhH7Ve9TsMwEPYAA5IjerlbGCt21k6o3VHFzM/Me/AMLO0L8BidCkW8RylvgDIZfaYOkes0IMVuVcXSp7PuPue+OJGTT6nfccTM90TynudS5LmYllHg2sx8h16VvkppfSZE/BlYFAVEvNJaS3nnKZs7EPGH3Qlsu19MBWa+VetnvlFMASJZqEgv3F9RQICfTIpOQOsCLi965mpwaqNfC6F1AbPHY/P1rGz0ayHsl4DhcGTm8xcLzF1+MpnaHGITNySgjrshYDy+Nm5g7vJYiIHYxA0JqON2AjoBhyng6eHENkds4kYREMI27n4J6PfPLQHA3OVxeiFXPcXquCFs47b+LfgvOgEQsNufUiJ5CxRS4XWnxkREbpw1W/nF2CCSZWlSYRTh1XxSLKB5lmVc8cc/JhVeDXYp0osJe75Yb3tpz78BKpbwSPQmEYgAAAAASUVORK5CYII=';

const HYPERLIQUID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAMNSURBVFhH7VY7axRRFN60ImJjEwhoI6ktRLDQMv4CCws7wSqghYVYSRBJmiTO3JnZzWPzMraCDySoaCcoEhBEC929c2d2N7sx0bzcueceObNONnv2YYqkkf3ga3bON9+555x7ZlOpLrr4T9Hj6cKVjCmnM6Z8367Kczzg0DCF3457UFyaxyrO4jbO4W+cxB8oIjXCYw8ciNhjg/9iATUK8FFookQPC/gQAW3IDXPNgcLW/nU6ed28TtcUcArX0armL3BdA4RWgxmovMuYyivHhJf583Z4gMWjAlQ4gatN5kklZnATbZBLXLsLC/JDi2hwGn9iFjdwDnfQ1vk7PK4VLC0HKb7V6XergCE6EML4jn+a61Muqn7PlNDD4p7eFeNELJ3rWInR8pdjjg7VBFaaTDlncQttLa/xd6QskHdpYhsFEjNYxjSsbAmUF7kmgQvBIpWX4rkhZ5wA+B5/R4qmN4u/mgS2lkgn86C47ejCzVETnEg0jlFnPCg8nsGNJl07kocD6kmje22Cl+P72kJESSTtEJEsC+2/tyP5KXlhp75z0k0QELxpdEfsEVp9nmw7wXWmsYRTuBYvFxoq/vxfrCXgv21MoHb9PtCLuYCTlspknMDanoHdP2sVU8+4f0po/2mrGUjogELqtR3Jqh35y3bkf7QjuUm/OSZoim/H2i5QWe6fskEN0+7mAqILQbwb3CicHttR/YlGYHjSjYIxqpxr9tcO8rC0vNXoHk90MEAmAlSjCGpXR0T+ENckEDq4Hd+EfwyjY1Q8O5YJmtexi+qIrX21d5XS9P+tynMezyG0/7pTC4m0U2wtQ/Li+hjCqEFaxbWeyrjsHpRWLeP38VgOYfJnKfn2rZA4T4sO/FGu3QV9Th3w52inL2CEE2a1KKL2G5DDivKPyIQqxxPI4Aq6UNz2THiK65qQjooDWbN+ddzkevmzTsiYlV4PSiVqRT0JGe8LOpClcze45sAxVv1+fgIqBTKkFtIMxd8JkIf/jyjBiPna50H5XhpKLzOmPO+a4BKP6aKLLhL8AaX33yt2oBNBAAAAAElFTkSuQmCC';

const ICONS: Record<VenueId, string> = {
  binance: BINANCE_SVG,
  okx: OKX_SVG,
  bybit: BYBIT_PNG,
  bitget: BITGET_SVG,
  hyperliquid: HYPERLIQUID_PNG,
  coinbase: COINBASE_SVG,
};

export function venueIconSrc(venue: VenueId): string | undefined {
  return ICONS[venue];
}

export function VenueIcon({
  venue,
  size = 16,
  className,
}: {
  venue: VenueId;
  size?: number;
  className?: string;
}) {
  const src = ICONS[venue];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('shrink-0 rounded-[3px] object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Vela's picker renders `<span class="vela-sp-badge" data-p="okx">OKX</span>`.
 * A data-URI icon before the label keeps the native badge and its text fallback.
 */
export function installVenueBadgeIcons(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('screener-venue-badge-icons')) return;

  const style = document.createElement('style');
  style.id = 'screener-venue-badge-icons';
  style.textContent = [
    ...VENUE_CATALOG.map((venue) => {
      const src = ICONS[venue.id];
      if (!src) return '';
      return `.vela-sp-badge[data-p="${venue.id}"]::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 5px; vertical-align: -2px; background: url("${src}") center / contain no-repeat; }`;
    }),
  ].join('\n');
  document.head.appendChild(style);
}
