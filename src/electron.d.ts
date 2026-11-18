export {};

declare global {
  /** Latest updater state pushed by electron/updater.src.cjs. */
  interface ScreenerUpdateStatus {
    state: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
    version?: string;
    percent?: number;
  }

  interface Window {
    /** Narrow bridge exposed by electron/preload.cjs; absent in the browser. */
    screenerWindow?: {
      setTitleBarTheme: (theme: 'dark' | 'light') => void;
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      quit: () => void;
      /** Native open dialog with Pine/TXT/All filters; returns the selected text. */
      pickScript: () => Promise<
        { name: string; text: string } | { error: string } | null
      >;
      /** Opens an allow-listed partner link in the system browser. */
      openExternal: (url: string) => void;
      /** Latest updater state; the title bar shows a button when downloaded. */
      getUpdateStatus: () => Promise<ScreenerUpdateStatus>;
      onUpdateStatus: (callback: (status: ScreenerUpdateStatus) => void) => void;
      installUpdate: () => void;
      /** Packaged executable mtime as `YYYYMMDDHHMM` UTC; null in dev. */
      buildBuilt: string | null;
    };
  }
}
