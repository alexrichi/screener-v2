import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const velaSrc = path.resolve(root, '../Vela/src');
const velaPinetsEditor = path.resolve(root, '../Vela-pinets/src/editor/index.ts');

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    ],
  },
  optimizeDeps: {
    exclude: ['@luxalgo/vela'],
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
