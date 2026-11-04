import { registerWidgetAttachment } from '@luxalgo/vela/plugin';

/**
 * Vela has no action slot in the shared drawing toolbar, so the attachment
 * inserts the app's AI toggle at the top of `.vela-dtb` and keeps it there when
 * the workspace rebuilds the toolbar. Re-check the class on Vela upgrades.
 */
const AI_ICON =
  '<span class="screener-ai-rail-icon" aria-hidden="true">' +
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>' +
  '<path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>' +
  '</svg>' +
  '</span>' +
  '<span class="screener-ai-rail-label" aria-hidden="true">AI</span>';

let toggleAi: (() => void) | null = null;
let aiOpen = false;
const buttons = new Set<HTMLButtonElement>();

function paint(button: HTMLButtonElement): void {
  const label = aiOpen ? 'Hide AI' : 'Show AI';
  button.dataset.active = aiOpen ? 'true' : 'false';
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** App owns the sidebar; the rail button only asks it to toggle. */
export function setAiBridge(toggle: (() => void) | null): void {
  toggleAi = toggle;
}

/** Reflect the app's sidebar state on every mounted workspace rail. */
export function setAiRailState(open: boolean): void {
  aiOpen = open;
  for (const button of buttons) paint(button);
}

registerWidgetAttachment({
  id: 'screener-ai-rail',
  mount(ctx) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'screener-ai-rail';
    button.innerHTML = AI_ICON;
    paint(button);
    buttons.add(button);

    const onClick = () => toggleAi?.();
    button.addEventListener('click', onClick);

    const attach = () => {
      if (button.isConnected) return;
      const toolbar = ctx.host.querySelector('.vela-dtb');
      if (toolbar) toolbar.prepend(button);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(ctx.host, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      button.removeEventListener('click', onClick);
      buttons.delete(button);
      button.remove();
    };
  },
});
