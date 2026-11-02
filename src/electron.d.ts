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
    };
  }
}
