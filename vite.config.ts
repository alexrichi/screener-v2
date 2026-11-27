import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/** `major.BUILT.HASH` inputs: package major, Vite build minute (UTC), git commit. */
function buildStamp() {
  let git = 'unknown';
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0;
    git = dirty ? `${hash}-dirty` : hash;
  } catch {
    /* a source tarball has no git; the version must still render */
  }
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const built = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '');
  return {
    version: String(version),
    major: String(version).split('.')[0] ?? '0',
    built,
    git,
  };
}

const build = buildStamp();
const velaSrc = path.resolve(root, '../Vela/src');
const velaUiSrc = path.resolve(root, '../Vela/packages/vela-ui/src');
const pineEngineSrc = path.resolve(root, '../pine-engine/src/index.ts');
const pineEditorSrc = path.resolve(root, '../pine-editor/src/index.ts');
const pineEditorMonaco = path.resolve(root, '../pine-editor/src/monaco');

/** Resolve the Vela UI kit from its workspace source, as Vela's own playground does. */
function velaUiSource(): import('vite').Plugin {
  return {
    name: 'vela-ui-source',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@luxalgo/vela-ui') return path.join(velaUiSrc, 'index.ts');
      const match = /^@luxalgo\/vela-ui\/([a-z0-9-]+)$/.exec(id);
      if (!match) return null;
      for (const dir of ['components', 'lib']) {
        const file = path.join(velaUiSrc, dir, `${match[1]}.ts`);
        if (existsSync(file)) return file;
      }
      return null;
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __BUILD_STAMP__: JSON.stringify({ major: build.major, built: build.built, git: build.git }),
  },
  plugins: [velaUiSource(), react(), tailwindcss()],
  resolve: {
    // Vela and the Pine editor pull React from different workspace paths; keep
    // one copy or hooks break in development.
    dedupe: ['react', 'react-dom'],
    alias: [
      // shadcn/assistant-ui registry components use the `@/` project alias.
      { find: /^@\//, replacement: `${root.replace(/\\/g, '/')}/src/` },
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
      // Local Pine engine: edit the transpiler runtime and see it live.
      { find: /^@screener\/pine-engine$/, replacement: pineEngineSrc },
      // Local Pine editor: language data plus the Monaco bindings.
      { find: /^@screener\/pine-editor$/, replacement: pineEditorSrc },
      {
        find: /^@screener\/pine-editor\/monaco$/,
        replacement: path.join(pineEditorMonaco, 'index.ts'),
      },
      {
        find: /^@screener\/pine-editor\/monaco\/react$/,
        replacement: path.join(pineEditorMonaco, 'react.tsx'),
      },
    ],
  },
  optimizeDeps: {
    exclude: [
      '@luxalgo/vela',
      '@luxalgo/vela-ui',
      '@screener/pine-engine',
      '@screener/pine-editor',
      '@screener/pine-editor/monaco',
      '@screener/pine-editor/monaco/react',
    ],
  },
  server: {
    port: 5173,
    fs: {
      allow: [
        root,
        path.resolve(root, '../Vela'),
        path.resolve(root, '../pine-engine'),
        path.resolve(root, '../pine-editor'),
        path.resolve(root, '../pine-script-syntax-highlighter'),
      ],
    },
  },
  worker: {
    format: 'es',
  },
});
