/** Partner link: the referral parameter must survive. */
const PARTNER_URL = 'https://hashhedge.com?fpr=lexx';

/**
 * Opens the link outside the app. Electron denies `window.open` and external
 * navigation, so the packaged shell routes it through the preload bridge.
 */
export function openPartner(): void {
  const bridge = typeof window === 'undefined' ? undefined : window.screenerWindow;
  if (bridge?.openExternal) {
    bridge.openExternal(PARTNER_URL);
    return;
  }
  window.open(PARTNER_URL, '_blank', 'noopener,noreferrer');
}
