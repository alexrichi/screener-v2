export {};

declare global {
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
      /** Packaged executable mtime as `YYYYMMDDHHMM` UTC; null in dev. */
      buildBuilt: string | null;
    };
  }
}
