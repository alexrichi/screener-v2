import { registerWidgetAction } from '@luxalgo/vela/plugin';

let openWindow: (() => void) | null = null;

/** The app owns the dialog; the topbar action only opens it. */
export function setIndicatorWindowBridge(open: (() => void) | null): void {
  openWindow = open;
}

// Registering under the built-in `indicators` id replaces the native picker.
// Vela still wires the topbar button, the `/` shortcut and the mobile stop to
// this run, but never constructs its own dialog.
registerWidgetAction({
  id: 'indicators',
  target: 'topbar',
  label: 'Indicators',
  icon: 'indicators',
  run: () => openWindow?.(),
});

let openFavorites: ((anchor: HTMLElement | null) => void) | null = null;

/** The app owns the favorites popover; the topbar action only opens it. */
export function setFavoritesMenuBridge(open: ((anchor: HTMLElement | null) => void) | null): void {
  openFavorites = open;
}

// Sits right after Indicators in the primary topbar cluster. The app anchors its
// favorites popover to this action's own button.
registerWidgetAction({
  id: 'screener-indicator-favorites',
  target: 'topbar',
  label: 'Favorite indicators',
  icon: 'chevron-down',
  iconOnly: true,
  align: 'left',
  order: 1,
  run: (ctx) => {
    const anchor = ctx.host.querySelector<HTMLElement>(
      '[data-action-id="screener-indicator-favorites"]',
    );
    openFavorites?.(anchor);
  },
});
