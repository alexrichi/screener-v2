const { app, BrowserWindow, dialog, Menu, ipcMain, screen, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  captureWindowState,
  fitBounds,
  readWindowState,
  saveWindowState,
} = require('./window-state.cjs');

const SIDECAR_PORT = 8787;
const SMOKE = process.argv.includes('--smoke');
const TITLEBAR_HEIGHT = 36;
const TITLEBAR_COLORS = {
  dark: { color: '#030712', symbolColor: '#f3f4f6' },
  light: { color: '#f8fafc', symbolColor: '#0f172a' },
};

let sidecar = null;
let ownsSidecar = false;
let staticServer = null;
let mainWindow = null;
let sidecarStderr = '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function pingSidecar() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: SIDECAR_PORT, path: '/health', timeout: 700 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForSidecar(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingSidecar()) return true;
    if (sidecar && sidecar.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureSidecar() {
  if (await pingSidecar()) {
    console.log('[electron] reusing the running sidecar on 8787');
    return true;
  }

  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'sidecar.cjs')
    : path.join(__dirname, '..', 'dist-electron', 'sidecar.cjs');
  if (!fs.existsSync(script)) {
    dialog.showErrorBox(
      'Sidecar missing',
      `Build the sidecar first: npm run sidecar:build\n${script}`,
    );
    return false;
  }

  sidecar = spawn(process.execPath, [script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SIDECAR_PORT: String(SIDECAR_PORT),
      // Keep the AI settings file next to the app's own state, not in the repo.
      AI_CONFIG_FILE: path.join(app.getPath('userData'), 'ai.json'),
    },
  });
  ownsSidecar = true;
  sidecar.stdout.on('data', (chunk) => console.log('[sidecar]', String(chunk).trim()));
  sidecar.stderr.on('data', (chunk) => {
    sidecarStderr += String(chunk);
    console.error('[sidecar]', String(chunk).trim());
  });
  sidecar.on('exit', (code) => {
    console.log('[electron] sidecar exited', code);
    sidecar = null;
    ownsSidecar = false;
  });

  const ready = await waitForSidecar(20_000);
  if (!ready) {
    dialog.showErrorBox(
      'Sidecar did not start',
      sidecarStderr.slice(-2000) || 'Check the sidecar bundle and port 8787.',
    );
  }
  return ready;
}

function stopSidecar() {
  if (!sidecar || !ownsSidecar) return;
  try {
    sidecar.kill();
  } catch {
    /* already gone */
  }
  sidecar = null;
  ownsSidecar = false;
}

function startStaticServer() {
  const root = path.join(app.getAppPath(), 'dist');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const relative = path.normalize(pathname).replace(/^([/\\])+/, '');
      const file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(file, (error, body) => {
        if (error) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
        });
        res.end(body);
      });
    });

    // A STABLE origin keeps localStorage (tabs, library, workspace) across launches.
    const wanted = Number(process.env.APP_PORT || 51789);
    const listen = (port) => {
      const onError = (error) => {
        if (error.code === 'EADDRINUSE' && port !== 0) {
          server.removeListener('error', onError);
          console.warn(`[electron] app port ${port} busy, using a random port (state will not persist)`);
          listen(0);
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        staticServer = server;
        resolve(server.address().port);
      });
    };
    listen(wanted);
  });
}

async function writeSmokeResult(result) {
  const file = process.env.SMOKE_LOG || path.join(app.getPath('temp'), 'screener-v2-smoke.json');
  try {
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log('[smoke]', file, JSON.stringify(result));
  } catch (error) {
    console.error('[smoke] could not write result', error);
  }
}

async function runSmoke() {
  let rows = 0;
  let error = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      rows = await mainWindow.webContents.executeJavaScript(
        'document.querySelectorAll("tbody tr").length',
      );
      error = null;
    } catch (cause) {
      error = String(cause);
    }
    if (rows > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const result = {
    ok: rows > 0 && !error,
    rows,
    error,
    venues: [],
    titlebar: null,
    at: new Date().toISOString(),
  };
  try {
    result.titlebar = await mainWindow.webContents.executeJavaScript(`(() => {
      const header = document.querySelector('header');
      if (!header) return null;
      const style = getComputedStyle(header);
      return {
        bridge: Boolean(window.screenerWindow),
        header: header.className,
        paddingRight: style.paddingRight,
        appRegion: style.getPropertyValue('-webkit-app-region'),
      };
    })()`);
    if (!result.titlebar?.bridge) result.ok = false;
  } catch (cause) {
    error = String(cause);
    result.error = error;
    result.ok = false;
  }
  try {
    const health = await fetch(`http://127.0.0.1:${SIDECAR_PORT}/health`).then((res) =>
      res.json(),
    );
    result.venues = Array.isArray(health.venues) ? health.venues : [];
  } catch {
    /* the table check already covers a dead sidecar */
  }
  await writeSmokeResult(result);
  stopSidecar();
  app.exit(result.ok ? 0 : 1);
}

function registerWindowIpc() {
  ipcMain.on('screener:titlebar-theme', (event, theme) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (typeof mainWindow.setTitleBarOverlay !== 'function') return;
    const palette = theme === 'light' ? TITLEBAR_COLORS.light : TITLEBAR_COLORS.dark;
    mainWindow.setTitleBarOverlay({ ...palette, height: TITLEBAR_HEIGHT });
  });

  ipcMain.handle('screener:pick-script', async (event) => {
    if (event.sender !== mainWindow?.webContents || !mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Bring a script',
      properties: ['openFile'],
      filters: [
        { name: 'Pine Script', extensions: ['pine'] },
        { name: 'Text files', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > 5 * 1024 * 1024) {
        return { error: 'That script is larger than 5 MB.' };
      }
      return { name: path.basename(filePath), text: await fs.promises.readFile(filePath, 'utf8') };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on('screener:window', (event, action) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (!mainWindow) return;
    switch (action) {
      case 'minimize':
        mainWindow.minimize();
        break;
      case 'toggle-maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case 'close':
        mainWindow.close();
        break;
      case 'quit':
        app.quit();
        break;
      default:
        break;
    }
  });
}

async function createWindow() {
  const useTitleBarOverlay = process.platform === 'win32';
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
  const windowStateFile = path.join(app.getPath('userData'), 'window.json');
  const { maximized: restoreMaximized, ...restoreBounds } = fitBounds(
    readWindowState(windowStateFile),
    screen.getAllDisplays(),
  );
  mainWindow = new BrowserWindow({
    ...restoreBounds,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0f17',
    show: false,
    icon: fs.existsSync(windowIcon) ? windowIcon : undefined,
    ...(useTitleBarOverlay
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            ...TITLEBAR_COLORS.dark,
            height: TITLEBAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (restoreMaximized) mainWindow.maximize();
  if (!SMOKE) {
    let stateTimer = null;
    const persistWindow = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const state = captureWindowState(mainWindow);
      if (state) saveWindowState(windowStateFile, state);
    };
    const scheduleWindowSave = () => {
      if (stateTimer !== null) clearTimeout(stateTimer);
      stateTimer = setTimeout(() => {
        stateTimer = null;
        persistWindow();
      }, 400);
    };
    for (const event of ['resize', 'move', 'maximize', 'unmaximize']) {
      mainWindow.on(event, scheduleWindowSave);
    }
    mainWindow.on('close', () => {
      if (stateTimer !== null) clearTimeout(stateTimer);
      stateTimer = null;
      persistWindow();
    });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_START_URL || 'http://127.0.0.1:';
    if (!url.startsWith(allowed)) event.preventDefault();
  });
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log('[renderer]', message);
  });

  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    const port = await startStaticServer();
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  }

  if (SMOKE) await runSmoke();

  return mainWindow;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerWindowIpc();
    Menu.setApplicationMenu(null);
    // The only origin is the bundled UI; dictation needs the microphone.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'media');
    });
    if (!(await ensureSidecar())) {
      app.quit();
      return;
    }
    await createWindow();
  });

  app.on('before-quit', stopSidecar);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!mainWindow) void createWindow();
  });
  app.on('quit', () => {
    if (staticServer) staticServer.close();
  });
}
