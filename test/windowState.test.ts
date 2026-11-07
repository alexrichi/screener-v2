import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { fitBounds, readWindowState, saveWindowState } = require(
  '../electron/window-state.cjs',
) as {
  fitBounds: (
    state: { x: number; y: number; width: number; height: number; maximized?: boolean } | null,
    displays: Array<{ workArea?: { x: number; y: number; width: number; height: number } }>,
  ) => { x?: number; y?: number; width: number; height: number; maximized: boolean };
  readWindowState: (
    file: string,
  ) => { x: number; y: number; width: number; height: number; maximized: boolean } | null;
  saveWindowState: (file: string, state: Record<string, unknown>) => void;
};

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };

describe('window geometry restore', () => {
  it('keeps saved bounds that still land on a connected display', () => {
    expect(fitBounds({ x: 100, y: 80, width: 1280, height: 800, maximized: true }, [display])).toEqual(
      { x: 100, y: 80, width: 1280, height: 800, maximized: true },
    );
  });

  it('falls back to the default size when the monitor is gone', () => {
    expect(
      fitBounds({ x: -4000, y: -3000, width: 1280, height: 800, maximized: true }, [display]),
    ).toEqual({ width: 1440, height: 900, maximized: true });
  });

  it('clamps a saved window to the display it lands on', () => {
    expect(
      fitBounds({ x: 100, y: 100, width: 3000, height: 2000 }, [display]),
    ).toEqual({ x: 100, y: 100, width: 1920, height: 1080, maximized: false });
    expect(
      fitBounds({ x: 100, y: -500, width: 1280, height: 800 }, [display]),
    ).toEqual({ x: 100, y: 0, width: 1280, height: 800, maximized: false });
    expect(
      fitBounds({ x: 1900, y: 100, width: 1280, height: 800 }, [display]),
    ).toEqual({ x: 1840, y: 100, width: 1280, height: 800, maximized: false });
  });

  it('clamps the default size to a smaller primary display', () => {
    const small = { workArea: { x: 0, y: 0, width: 1366, height: 768 } };
    expect(fitBounds(null, [small])).toEqual({
      width: 1366,
      height: 768,
      maximized: false,
    });
  });

  it('never restores a window below the app minimum', () => {
    expect(fitBounds({ x: 10, y: 10, width: 300, height: 200 }, [display])).toEqual({
      x: 10,
      y: 10,
      width: 960,
      height: 600,
      maximized: false,
    });
  });

  it('round-trips a geometry through the file and rejects a broken one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'screener-window-'));
    const file = join(dir, 'window.json');
    saveWindowState(file, { x: 10, y: 20, width: 1280, height: 800, maximized: true });
    expect(readWindowState(file)).toEqual({
      x: 10,
      y: 20,
      width: 1280,
      height: 800,
      maximized: true,
    });
    saveWindowState(file, { x: 10, y: 20, width: 100, height: 100 });
    expect(readWindowState(file)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
