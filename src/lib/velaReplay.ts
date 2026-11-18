import { registerWidgetAttachment } from '@luxalgo/vela/plugin';

let toggleReplay: (() => void) | null = null;

const ICON =
  '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4 3 8l4.5 4V4Z"/><path d="M13 4 8.5 8l4.5 4V4Z"/></svg>';

/**
 * A topbar attachment, not a contributed left action: the left actions group
 * also holds the Indicators favorites caret, so a contributed action would sit
 * between Indicators and its caret. This button follows the whole group.
 */
registerWidgetAttachment({
  id: 'screener-replay',
  mount(ctx) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'screener-replay-action';
    button.title = 'Replay';
    button.setAttribute('aria-label', 'Replay');
    button.innerHTML = `${ICON}<span>Replay</span>`;

    const onClick = () => toggleReplay?.();
    button.addEventListener('click', onClick);

    const attach = () => {
      if (button.isConnected) return;
      const group = ctx.host.querySelector('.vela-widget-actions-left');
      if (group) {
        group.after(button);
        return;
      }
      const right = ctx.host.querySelector('.vela-topbar-right');
      if (right) right.prepend(button);
    };
    attach();

    // The topbar is rebuilt on layout and market changes; put the button back.
    const observer = new MutationObserver(attach);
    observer.observe(ctx.host, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      button.removeEventListener('click', onClick);
      button.remove();
    };
  },
});

/** App owns the replay bar; the topbar button only asks for it. */
export function setReplayBridge(toggle: (() => void) | null): void {
  toggleReplay = toggle;
}
