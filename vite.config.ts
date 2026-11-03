import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import * as esbuild from 'esbuild';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const velaSrc = path.resolve(root, '../Vela/src');
const velaPinetsSrc = path.resolve(root, '../Vela-pinets/src');
const velaPinetsEditor = path.resolve(root, '../Vela-pinets/src/editor/index.ts');

/** Same `inline-worker:` scheme Vela-pinets uses in its own build and playground. */
function inlineWorker(): import('vite').Plugin {
  const PREFIX = 'inline-worker:';
  const RESOLVED = '\0inline-worker\0';
  return {
    name: 'inline-worker',
    resolveId(id, importer) {
      if (!id.startsWith(PREFIX)) return undefined;
      return RESOLVED + path.resolve(path.dirname(importer ?? ''), id.slice(PREFIX.length));
    },
    async load(id) {
      if (!id.startsWith(RESOLVED)) return undefined;
      const entry = id.slice(RESOLVED.length);
      const out = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        minify: true,
        sourcemap: false,
        target: 'es2020',
      });
      this.addWatchFile(entry);
      return `export default ${JSON.stringify(out.outputFiles?.[0]?.text ?? '')};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), inlineWorker()],
  resolve: {
    // The local Vela-pinets editor entry has its own CodeMirror and pinets installs.
    // Keep one copy or production bundles two @codemirror/state instances and fails.
    dedupe: [
      '@codemirror/autocomplete',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/highlight',
      'pinets',
    ],
    alias: [
      // Local Vela checkout: edit the chart core and see it live.
      { find: /^@luxalgo\/vela$/, replacement: path.join(velaSrc, 'index.ts') },
      {
        find: /^@luxalgo\/vela\/workspace$/,
        replacement: path.join(velaSrc, 'workspace/index.ts'),
      },
      { find: /^@luxalgo\/vela\/plugin$/, replacement: path.join(velaSrc, 'plugin.ts') },
      { find: /^@luxalgo\/vela\/ui$/, replacement: path.join(velaSrc, 'ui/index.ts') },
      {
        find: /^@luxalgo\/vela\/providers\/binance$/,
        replacement: path.join(velaSrc, 'data/providers/binance/index.ts'),
      },
      // The editor entry lives in the local addon; the engine stays on npm.
      { find: /^@luxalgo\/vela-pinets\/editor$/, replacement: velaPinetsEditor },
      // Local addon: edit hline/fill and engine code without rebuilding the npm package.
      { find: /^@luxalgo\/vela-pinets$/, replacement: path.join(velaPinetsSrc, 'index.ts') },
    ],
  },
  optimizeDeps: {
    exclude: ['@luxalgo/vela', '@luxalgo/vela-pinets'],
  },
  server: {
    port: 5173,
    fs: {
      allow: [root, path.resolve(root, '../Vela'), path.resolve(root, '../Vela-pinets')],
    },
  },
  worker: {
    format: 'es',
  },
});
