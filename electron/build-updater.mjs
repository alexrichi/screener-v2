import { build } from 'esbuild';

await build({
  entryPoints: ['electron/updater.src.cjs'],
  outfile: 'electron/updater.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  external: ['electron'],
  logLevel: 'info',
});

console.log('[electron] updater bundled to electron/updater.cjs');
