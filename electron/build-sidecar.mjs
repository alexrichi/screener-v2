import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist-electron', { recursive: true });

await build({
  entryPoints: ['sidecar/server.ts'],
  outfile: 'dist-electron/sidecar.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  // Optional native accelerators for ws; the pure-JS fallbacks are bundled.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});

console.log('[electron] sidecar bundled to dist-electron/sidecar.cjs');
